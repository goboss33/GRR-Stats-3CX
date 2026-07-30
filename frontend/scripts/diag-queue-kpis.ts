// DIAGNOSTIC (lecture seule) : compare l'ancienne forme de la requête KPI de file
// (dates et numéro en littéraux) avec la nouvelle (paramètres liés), sur les mêmes
// données, pour déterminer si le passage aux paramètres a modifié les résultats.
import { getPrismaCdr } from "@/lib/prisma-cdr";

const QUEUE = process.argv[2] ?? "900";
const START = new Date("2026-07-01T00:00:00.000Z");
const END = new Date("2026-07-29T00:00:00.000Z");

/** Corps de requête commun ; les emplacements varient selon la forme testée. */
function buildQuery(qn: string, startExpr: string, endExpr: string) {
    return `
        WITH all_queue_passages AS (
            SELECT c.call_history_id, c.cdr_id, c.originating_cdr_id, c.cdr_started_at
            FROM cdroutput c
            WHERE c.destination_dn_number = ${qn}
              AND c.destination_dn_type = 'queue'
              AND c.cdr_started_at >= ${startExpr}
              AND c.cdr_started_at <= ${endExpr}
        ),
        unique_calls AS (
            SELECT DISTINCT ON (call_history_id) call_history_id, cdr_id, cdr_started_at
            FROM all_queue_passages ORDER BY call_history_id, cdr_started_at ASC
        ),
        passage_outcomes AS (
            SELECT aqp.call_history_id, aqp.cdr_id, aqp.cdr_started_at,
                bool_or(p.cdr_answered_at IS NOT NULL AND p.destination_dn_type = 'extension') as was_answered,
                bool_or(other_q.destination_dn_type = 'queue'
                        AND other_q.destination_dn_number != ${qn}
                        AND other_q.cdr_started_at > aqp.cdr_started_at) as overflowed
            FROM all_queue_passages aqp
            LEFT JOIN cdroutput p ON p.originating_cdr_id = aqp.cdr_id AND p.creation_forward_reason = 'polling'
            LEFT JOIN cdroutput other_q ON other_q.call_history_id = aqp.call_history_id
                AND other_q.destination_dn_type = 'queue'
                AND other_q.destination_dn_number != ${qn}
                AND other_q.cdr_started_at > aqp.cdr_started_at
            GROUP BY aqp.call_history_id, aqp.cdr_id, aqp.cdr_started_at
        ),
        call_outcomes AS (
            SELECT call_history_id,
                CASE WHEN bool_or(was_answered) THEN 'answered'
                     WHEN bool_or(overflowed) AND NOT bool_or(was_answered) THEN 'overflow'
                     ELSE 'abandoned' END as outcome
            FROM passage_outcomes GROUP BY call_history_id
        )
        SELECT
            COUNT(DISTINCT uc.call_history_id) as unique_calls,
            COUNT(DISTINCT CASE WHEN co.outcome = 'answered' THEN uc.call_history_id END) as answered,
            COUNT(DISTINCT CASE WHEN co.outcome = 'abandoned' THEN uc.call_history_id END) as abandoned,
            COUNT(DISTINCT CASE WHEN co.outcome = 'overflow' THEN uc.call_history_id END) as overflow,
            (SELECT COUNT(*) FROM all_queue_passages) as total_passages
        FROM unique_calls uc
        JOIN call_outcomes co ON co.call_history_id = uc.call_history_id
    `;
}

async function main() {
    const prisma = getPrismaCdr("gerofinance");
    console.log(`\nFile ${QUEUE} — du ${START.toISOString()} au ${END.toISOString()}\n`);

    // Forme ANCIENNE : tout en littéraux dans le SQL.
    const oldRows = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(
        buildQuery(`'${QUEUE}'`, `'${START.toISOString()}'`, `'${END.toISOString()}'`),
    );

    // Forme ACTUELLE : paramètres liés.
    const newRows = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(
        buildQuery("$1", "$2", "$3"),
        QUEUE, START, END,
    );

    const keys = ["unique_calls", "answered", "abandoned", "overflow", "total_passages"];
    console.log("métrique".padEnd(16), "ancien".padStart(10), "actuel".padStart(10), "  écart");
    let diffs = 0;
    for (const k of keys) {
        const a = Number(oldRows[0][k]);
        const b = Number(newRows[0][k]);
        if (a !== b) diffs++;
        console.log(k.padEnd(16), String(a).padStart(10), String(b).padStart(10), a === b ? "  =" : `  ≠ (${b - a})`);
    }

    console.log(
        diffs === 0
            ? "\n=> Les deux formes donnent EXACTEMENT les mêmes chiffres.\n   Le passage aux paramètres n'explique pas l'écart constaté.\n"
            : `\n=> ${diffs} métrique(s) divergente(s) : le passage aux paramètres a bien modifié les résultats.\n`,
    );

    // Fuseau de la session : une différence d'interprétation des bornes se verrait ici.
    const tz = await prisma.$queryRaw<{ tz: string }[]>`SHOW timezone`;
    console.log(`Fuseau de session PostgreSQL : ${tz[0].tz}`);

    await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
