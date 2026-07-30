// Test de fumée de la « vue file » des logs : valide la syntaxe des CTE
// ajoutés et vérifie que le statut dans la file et la file ayant répondu
// remontent bien. Lecture seule.
import { getPrismaCdr } from "@/lib/prisma-cdr";
import {
    DEFAULT_CLASSIFICATION_RULES as rules,
    buildQueuePassagesCTE,
    buildCallQueueOutcomesCTE,
} from "@/services/domain/call-classification";

const QUEUE = process.argv[2] ?? "900";
const START = new Date("2026-06-01T00:00:00.000Z");
const END = new Date("2026-07-01T00:00:00.000Z");

async function main() {
    const prisma = getPrismaCdr("gerofinance");

    const sql = `
        WITH call_aggregates AS (
            SELECT call_history_id, MIN(cdr_started_at) AS first_started_at
            FROM cdroutput
            WHERE cdr_started_at >= $2 AND cdr_started_at <= $3
            GROUP BY call_history_id
        ),
        ${buildQueuePassagesCTE(rules, { queueExpr: "$1", startExpr: "$2", endExpr: "$3" })},
        ${buildCallQueueOutcomesCTE(rules)},
        answering_queue AS (
            SELECT DISTINCT ON (c.call_history_id)
                c.call_history_id,
                c.destination_dn_number AS queue_number,
                COALESCE(c.destination_dn_name, c.destination_dn_number) AS queue_name
            FROM cdroutput c
            WHERE c.destination_dn_type = 'queue'
              AND c.destination_dn_number <> $1
              AND c.cdr_started_at >= $2 AND c.cdr_started_at <= $3
              AND EXISTS (
                  SELECT 1 FROM cdroutput p
                  WHERE p.originating_cdr_id = c.cdr_id
                    AND p.creation_forward_reason = 'polling'
                    AND p.cdr_answered_at IS NOT NULL
                    AND p.destination_dn_type = 'extension'
              )
            ORDER BY c.call_history_id, c.cdr_started_at DESC
        )
        SELECT
            qv.outcome AS queue_view_status,
            aq.queue_number AS answering_queue_number,
            aq.queue_name AS answering_queue_name,
            COUNT(*) AS n
        FROM call_aggregates ca
        LEFT JOIN call_queue_outcomes qv ON qv.call_history_id = ca.call_history_id
        LEFT JOIN answering_queue aq ON aq.call_history_id = ca.call_history_id
        WHERE qv.outcome IS NOT NULL
        GROUP BY 1, 2, 3
        ORDER BY n DESC
        LIMIT 12`;

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, QUEUE, START, END);

    console.log(`\nFile ${QUEUE} — juin 2026 : statut dans la file × file ayant répondu\n`);
    for (const r of rows) {
        const ailleurs = r.answering_queue_number
            ? `répondu par ${r.answering_queue_number} – ${r.answering_queue_name}`
            : "—";
        console.log(`  ${String(r.queue_view_status).padEnd(15)} ${ailleurs.padEnd(45)} ${String(r.n).padStart(6)}`);
    }
    await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
