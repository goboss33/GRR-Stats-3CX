// Isole les appels sur lesquels le tableau de bord et les journaux divergent,
// et montre le parcours de quelques-uns. Lecture seule.
import { getPrismaCdr } from "@/lib/prisma-cdr";
import { SQL_SYSTEM_DEST_TYPES, SQL_SYSTEM_ENTITY_TYPES } from "@/services/domain/call-aggregation";

const START = new Date("2026-07-01T00:00:00.000Z");
const END = new Date("2026-08-01T00:00:00.000Z");

const CTE = `
    ca AS (SELECT call_history_id FROM cdroutput
           WHERE cdr_started_at >= $1 AND cdr_started_at <= $2 GROUP BY call_history_id),
    ls AS (SELECT DISTINCT ON (call_history_id) call_history_id,
              destination_dn_type dt, destination_entity_type de, cdr_answered_at la,
              cdr_started_at lst, cdr_ended_at len, termination_reason_details tr
           FROM cdroutput WHERE cdr_started_at >= $1 AND cdr_started_at <= $2
           ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC),
    lh AS (SELECT DISTINCT ON (call_history_id) call_history_id,
              cdr_answered_at ha, cdr_started_at hs, cdr_ended_at hen
           FROM cdroutput WHERE cdr_started_at >= $1 AND cdr_started_at <= $2
             AND (destination_dn_type = 'extension' OR destination_dn_type IN ('provider','external_line'))
             AND COALESCE(destination_entity_type,'') != 'voicemail'
           ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC),
    ans AS (SELECT DISTINCT ON (call_history_id) call_history_id, cdr_answered_at aa
            FROM cdroutput WHERE cdr_answered_at IS NOT NULL AND destination_dn_type = 'extension'
              AND cdr_started_at >= $1 AND cdr_started_at <= $2
            ORDER BY call_history_id, cdr_answered_at ASC, cdr_id ASC),
    verdicts AS (
        SELECT ca.call_history_id, ls.dt, ls.de,
            (ls.la IS NOT NULL AND EXTRACT(EPOCH FROM (ls.len - ls.lst)) > 1
             AND ((ls.dt IN (${SQL_SYSTEM_DEST_TYPES}) OR ls.de IN (${SQL_SYSTEM_ENTITY_TYPES})) AND ans.aa IS NOT NULL
                  OR (ls.dt NOT IN (${SQL_SYSTEM_DEST_TYPES}) AND ls.de NOT IN (${SQL_SYSTEM_ENTITY_TYPES})))) AS dash,
            (lh.ha IS NOT NULL AND EXTRACT(EPOCH FROM (lh.hen - lh.hs)) > 1) AS logs
        FROM ca
        JOIN ls ON ls.call_history_id = ca.call_history_id
        LEFT JOIN lh ON lh.call_history_id = ca.call_history_id
        LEFT JOIN ans ON ans.call_history_id = ca.call_history_id
        WHERE NOT (COALESCE(ls.dt,'') IN ('vmail_console','voicemail') OR COALESCE(ls.de,'') = 'voicemail')
          AND NOT (COALESCE(ls.tr,'') ILIKE '%busy%')
    )`;

(async () => {
    const prisma = getPrismaCdr("gerofinance");

    const profil: any = await prisma.$queryRawUnsafe(
        `WITH ${CTE} SELECT dt AS dernier_type, COUNT(*) AS n
         FROM verdicts WHERE dash AND NOT logs GROUP BY dt ORDER BY n DESC LIMIT 8`, START, END);
    console.log("\nAppels « répondus » pour le tableau de bord, « perdus » pour les journaux");
    console.log("répartis par TYPE du dernier segment :\n");
    let total = 0;
    for (const r of profil) { total += Number(r.n); console.log(`  ${String(r.dernier_type ?? "(nul)").padEnd(18)} ${String(Number(r.n)).padStart(6)}`); }
    console.log(`  ${"TOTAL".padEnd(18)} ${String(total).padStart(6)}`);

    const exemples: any = await prisma.$queryRawUnsafe(
        `WITH ${CTE} SELECT call_history_id FROM verdicts WHERE dash AND NOT logs LIMIT 3`, START, END);
    for (const e of exemples) {
        console.log(`\n── appel ${e.call_history_id}`);
        const segs: any = await prisma.$queryRawUnsafe(
            `SELECT cdr_started_at, source_dn_number sn, destination_dn_number dn,
                    destination_dn_type dt, cdr_answered_at aa,
                    ROUND(EXTRACT(EPOCH FROM (cdr_ended_at - cdr_started_at))) dur
             FROM cdroutput WHERE call_history_id = $1::uuid ORDER BY cdr_started_at, cdr_id`, e.call_history_id);
        for (const s of segs) {
            console.log(`   ${String(s.sn ?? "?").padEnd(14)} -> ${String(s.dn ?? "?").padEnd(14)} ${String(s.dt ?? "").padEnd(12)} ${s.aa ? "DECROCHE" : "non repondu"}  ${Number(s.dur)}s`);
        }
    }
    process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
