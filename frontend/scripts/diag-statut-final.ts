// Compare les DEUX definitions du statut final qui coexistent :
//   A. celle du tableau de bord (SQL propre a getGlobalMetricsRaw)
//   B. celle des journaux (FINAL_STATUS_RULES, call-aggregation.ts)
// Lecture seule.
import { getPrismaCdr } from "@/lib/prisma-cdr";
import { SQL_SYSTEM_DEST_TYPES, SQL_SYSTEM_ENTITY_TYPES } from "@/services/domain/call-aggregation";

const START = new Date(process.argv[2] ?? "2026-07-01T00:00:00.000Z");
const END = new Date(process.argv[3] ?? "2026-08-01T00:00:00.000Z");

const BASE = `
    call_aggregates AS (
        SELECT call_history_id FROM cdroutput
        WHERE cdr_started_at >= $1 AND cdr_started_at <= $2 GROUP BY call_history_id
    ),
    last_segments AS (
        SELECT DISTINCT ON (call_history_id) call_history_id,
            destination_dn_type AS lt, destination_entity_type AS le,
            cdr_answered_at AS la, cdr_started_at AS ls, cdr_ended_at AS lend,
            termination_reason_details AS tr
        FROM cdroutput WHERE cdr_started_at >= $1 AND cdr_started_at <= $2
        ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
    ),
    last_human AS (
        SELECT DISTINCT ON (call_history_id) call_history_id,
            cdr_answered_at AS ha, cdr_started_at AS hs, cdr_ended_at AS hend
        FROM cdroutput
        WHERE cdr_started_at >= $1 AND cdr_started_at <= $2
          AND destination_dn_type = 'extension' AND COALESCE(destination_entity_type,'') != 'voicemail'
        ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
    ),
    answered_seg AS (
        SELECT DISTINCT ON (call_history_id) call_history_id, cdr_answered_at AS aa
        FROM cdroutput WHERE cdr_answered_at IS NOT NULL AND destination_dn_type = 'extension'
          AND cdr_started_at >= $1 AND cdr_started_at <= $2
        ORDER BY call_history_id, cdr_answered_at ASC, cdr_id ASC
    )`;

async function main() {
    const prisma = getPrismaCdr("gerofinance");
    const rows = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(
        `WITH ${BASE},
         verdicts AS (
             SELECT ca.call_history_id,
                 -- A : tableau de bord (dernier segment, + condition types systeme)
                 (ls.la IS NOT NULL
                  AND EXTRACT(EPOCH FROM (ls.lend - ls.ls)) > 1
                  AND ((ls.lt IN (${SQL_SYSTEM_DEST_TYPES}) OR ls.le IN (${SQL_SYSTEM_ENTITY_TYPES})) AND ans.aa IS NOT NULL
                       OR (ls.lt NOT IN (${SQL_SYSTEM_DEST_TYPES}) AND ls.le NOT IN (${SQL_SYSTEM_ENTITY_TYPES})))
                 ) AS a_repondu,
                 -- B : journaux (dernier segment HUMAIN, priorite messagerie/occupe)
                 (NOT (COALESCE(ls.lt,'') IN ('vmail_console','voicemail') OR COALESCE(ls.le,'') = 'voicemail')
                  AND NOT (COALESCE(ls.tr,'') ILIKE '%busy%')
                  AND lh.ha IS NOT NULL
                  AND EXTRACT(EPOCH FROM (lh.hend - lh.hs)) > 1
                 ) AS b_repondu
             FROM call_aggregates ca
             JOIN last_segments ls ON ls.call_history_id = ca.call_history_id
             LEFT JOIN last_human lh ON lh.call_history_id = ca.call_history_id
             LEFT JOIN answered_seg ans ON ans.call_history_id = ca.call_history_id
         )
         SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE a_repondu) AS a_repondus,
                COUNT(*) FILTER (WHERE b_repondu) AS b_repondus,
                COUNT(*) FILTER (WHERE a_repondu AND NOT b_repondu) AS a_seul,
                COUNT(*) FILTER (WHERE b_repondu AND NOT a_repondu) AS b_seul
         FROM verdicts`,
        START, END,
    );
    const r = rows[0];
    const n = (k: string) => Number(r[k]);
    console.log(`\nPériode ${START.toISOString().slice(0,10)} → ${END.toISOString().slice(0,10)}\n`);
    console.log(`  appels                          : ${n("total")}`);
    console.log(`  « répondus » tableau de bord (A): ${n("a_repondus")}`);
    console.log(`  « répondus » journaux (B)       : ${n("b_repondus")}`);
    console.log(`  repondus pour A seulement       : ${n("a_seul")}`);
    console.log(`  repondus pour B seulement       : ${n("b_seul")}`);
    const ecart = n("a_seul") + n("b_seul");
    console.log(`\n  => ${ecart} appel(s) classés différemment (${(ecart / n("total") * 100).toFixed(2)} %)\n`);
    process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
