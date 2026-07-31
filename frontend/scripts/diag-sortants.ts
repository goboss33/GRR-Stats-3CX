// Les appels classes « non repondus » par la regle des journaux sont-ils
// majoritairement des appels SORTANTS reellement decroches ? Lecture seule.
import { getPrismaCdr } from "@/lib/prisma-cdr";
const START = new Date("2026-07-01T00:00:00.000Z");
const END = new Date("2026-08-01T00:00:00.000Z");
(async () => {
    const prisma = getPrismaCdr("gerofinance");
    const r: any = await prisma.$queryRawUnsafe(`
        WITH ca AS (
            SELECT call_history_id, MIN(cdr_started_at) AS t FROM cdroutput
            WHERE cdr_started_at >= $1 AND cdr_started_at <= $2 GROUP BY call_history_id
        ),
        premier AS (
            SELECT DISTINCT ON (call_history_id) call_history_id,
                source_dn_type AS st, destination_dn_type AS dt
            FROM cdroutput WHERE cdr_started_at >= $1 AND cdr_started_at <= $2
            ORDER BY call_history_id, cdr_started_at ASC, cdr_id ASC
        ),
        humain AS (
            SELECT DISTINCT ON (call_history_id) call_history_id, cdr_answered_at AS ha
            FROM cdroutput WHERE cdr_started_at >= $1 AND cdr_started_at <= $2
              AND (destination_dn_type = 'extension' OR destination_dn_type IN ('provider','external_line'))
              AND COALESCE(destination_entity_type,'') != 'voicemail'
            ORDER BY call_history_id, cdr_ended_at DESC, cdr_id DESC
        ),
        decroche_quelconque AS (
            SELECT DISTINCT call_history_id FROM cdroutput
            WHERE cdr_started_at >= $1 AND cdr_started_at <= $2 AND cdr_answered_at IS NOT NULL
        )
        SELECT
            COUNT(*) FILTER (WHERE h.ha IS NULL) AS non_repondus_regle_logs,
            COUNT(*) FILTER (WHERE h.ha IS NULL AND p.st = 'extension' AND p.dt <> 'extension') AS dont_sortants,
            COUNT(*) FILTER (WHERE h.ha IS NULL AND p.st = 'extension' AND p.dt <> 'extension'
                             AND d.call_history_id IS NOT NULL) AS sortants_pourtant_decroches
        FROM ca
        JOIN premier p ON p.call_history_id = ca.call_history_id
        LEFT JOIN humain h ON h.call_history_id = ca.call_history_id
        LEFT JOIN decroche_quelconque d ON d.call_history_id = ca.call_history_id`,
        START, END);
    const x = r[0];
    console.log(`\nJuillet 2026 — appels « non repondus » selon la regle des journaux\n`);
    console.log(`  total                                : ${Number(x.non_repondus_regle_logs)}`);
    console.log(`  dont appels SORTANTS                 : ${Number(x.dont_sortants)}`);
    console.log(`  sortants pourtant decroches          : ${Number(x.sortants_pourtant_decroches)}`);
    process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
