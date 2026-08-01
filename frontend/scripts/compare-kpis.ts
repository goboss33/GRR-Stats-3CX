// Compare, file par file, les KPIs de l'ANCIENNE requête (avant le socle de
// classement) et de la NOUVELLE, sur exactement les mêmes données.
//
// But : présenter chaque écart et pouvoir l'expliquer par une règle métier
// précise, plutôt que de découvrir les changements en production.
//
// Usage : npx tsx scripts/compare-kpis.ts [début ISO] [fin ISO] [file...]
import { getPrismaCdr } from "@/lib/prisma-cdr";
import { buildDirectSegmentWhereClause } from "@/services/domain/call-aggregation";
import {
    DEFAULT_CLASSIFICATION_RULES,
    buildQueuePassagesCTE,
    buildCallQueueOutcomesCTE,
    buildDirectCallsCTE,
    buildQueueExclusionSQL,
} from "@/services/domain/call-classification";

const START = new Date(process.argv[2] ?? "2026-06-01T00:00:00.000Z");
const END = new Date(process.argv[3] ?? "2026-07-01T00:00:00.000Z");
const QUEUES = process.argv.slice(4);

const rules = DEFAULT_CLASSIFICATION_RULES;

/** Requête telle qu'elle existait avant le socle de classement. */
const LEGACY = `
    WITH all_queue_passages AS (
        SELECT c.call_history_id, c.cdr_id, c.originating_cdr_id, c.cdr_started_at
        FROM cdroutput c
        WHERE c.destination_dn_number = $1 AND c.destination_dn_type = 'queue'
          AND c.cdr_started_at >= $2 AND c.cdr_started_at <= $3
    ),
    unique_calls AS (
        SELECT DISTINCT ON (call_history_id) call_history_id, cdr_id, cdr_started_at
        FROM all_queue_passages ORDER BY call_history_id, cdr_started_at ASC
    ),
    passage_outcomes AS (
        SELECT aqp.call_history_id, aqp.cdr_id, aqp.cdr_started_at,
            bool_or(p.cdr_answered_at IS NOT NULL AND p.destination_dn_type = 'extension') as was_answered,
            bool_or(other_q.destination_dn_type = 'queue' AND other_q.destination_dn_number != $1
                    AND other_q.cdr_started_at > aqp.cdr_started_at) as overflowed
        FROM all_queue_passages aqp
        LEFT JOIN cdroutput p ON p.originating_cdr_id = aqp.cdr_id AND p.creation_forward_reason = 'polling'
        LEFT JOIN cdroutput other_q ON other_q.call_history_id = aqp.call_history_id
            AND other_q.destination_dn_type = 'queue' AND other_q.destination_dn_number != $1
            AND other_q.cdr_started_at > aqp.cdr_started_at
        GROUP BY aqp.call_history_id, aqp.cdr_id, aqp.cdr_started_at
    ),
    call_outcomes AS (
        SELECT call_history_id,
            CASE WHEN bool_or(was_answered) THEN 'answered'
                 WHEN bool_or(overflowed) AND NOT bool_or(was_answered) THEN 'overflow'
                 ELSE 'abandoned' END as outcome
        FROM passage_outcomes GROUP BY call_history_id
    ),
    queue_agents AS (
        SELECT DISTINCT child.destination_dn_number as extension
        FROM cdroutput child JOIN cdroutput parent ON child.originating_cdr_id = parent.cdr_id
        WHERE child.creation_method = 'route_to' AND child.creation_forward_reason = 'polling'
          AND parent.destination_dn_type = 'queue' AND parent.destination_dn_number = $1
          AND child.cdr_started_at >= $2 AND child.cdr_started_at <= $3
    ),
    direct_calls_stats AS (
        SELECT COUNT(DISTINCT c.call_history_id) as direct_received,
               COUNT(DISTINCT CASE WHEN c.cdr_answered_at IS NOT NULL THEN c.call_history_id END) as direct_answered
        FROM cdroutput c
        WHERE ${buildDirectSegmentWhereClause("c")}
          AND c.destination_dn_number IN (SELECT extension FROM queue_agents)
          AND c.cdr_started_at >= $2 AND c.cdr_started_at <= $3
          AND NOT EXISTS (SELECT 1 FROM all_queue_passages aqp WHERE aqp.call_history_id = c.call_history_id)
    )
    SELECT
        COUNT(DISTINCT uc.call_history_id) as recus,
        COUNT(DISTINCT CASE WHEN co.outcome='answered' THEN uc.call_history_id END) as repondus,
        COUNT(DISTINCT CASE WHEN co.outcome='abandoned' THEN uc.call_history_id END) as perdus,
        COUNT(DISTINCT CASE WHEN co.outcome='overflow' THEN uc.call_history_id END) as rediriges,
        0 as messagerie, 0 as abandons_courts,
        (SELECT direct_received FROM direct_calls_stats) as directs_recus,
        (SELECT direct_answered FROM direct_calls_stats) as directs_repondus
    FROM unique_calls uc JOIN call_outcomes co ON co.call_history_id = uc.call_history_id
`;

const CURRENT = `
    WITH
    ${buildQueuePassagesCTE(rules, { queueExpr: "$1", startExpr: "$2", endExpr: "$3" })},
    ${buildCallQueueOutcomesCTE(rules)},
    queue_agents AS (
        SELECT DISTINCT child.destination_dn_number as extension
        FROM cdroutput child JOIN cdroutput parent ON child.originating_cdr_id = parent.cdr_id
        WHERE child.creation_method = 'route_to' AND child.creation_forward_reason = 'polling'
          AND parent.destination_dn_type = 'queue' AND parent.destination_dn_number = $1
          AND child.cdr_started_at >= $2 AND child.cdr_started_at <= $3
    ),
    team_direct_segments AS (
        SELECT c.call_history_id, c.cdr_started_at, c.cdr_answered_at
        FROM cdroutput c
        WHERE ${buildDirectSegmentWhereClause("c")}
          AND c.destination_dn_number IN (SELECT extension FROM queue_agents)
          AND c.cdr_started_at >= $2 AND c.cdr_started_at <= $3
    ),
    queue_calls AS (
        SELECT cqo.* FROM call_queue_outcomes cqo
        WHERE ${buildQueueExclusionSQL(rules, "cqo.call_history_id", "cqo.cdr_started_at")}
    ),
    ${buildDirectCallsCTE(rules)}
    SELECT
        (SELECT COUNT(*) FROM queue_calls) as recus,
        (SELECT COUNT(*) FROM queue_calls WHERE outcome='answered') as repondus,
        (SELECT COUNT(*) FROM queue_calls WHERE outcome='abandoned') as perdus,
        (SELECT COUNT(*) FROM queue_calls WHERE outcome='overflow') as rediriges,
        (SELECT COUNT(*) FROM queue_calls WHERE outcome='voicemail') as messagerie,
        (SELECT COUNT(*) FROM queue_calls WHERE outcome='short_abandon') as abandons_courts,
        (SELECT COUNT(*) FROM direct_calls) as directs_recus,
        (SELECT COUNT(*) FROM direct_calls WHERE outcome = 'answered') as directs_repondus
`;

const CHAMPS = ["recus", "repondus", "perdus", "rediriges", "messagerie", "abandons_courts", "directs_recus", "directs_repondus"] as const;

async function main() {
    const prisma = getPrismaCdr("gerofinance");

    let queues = QUEUES;
    if (queues.length === 0) {
        const rows = await prisma.$queryRawUnsafe<{ q: string }[]>(
            `SELECT DISTINCT destination_dn_number as q FROM cdroutput
             WHERE destination_dn_type='queue' AND cdr_started_at >= $1 AND cdr_started_at < $2
             ORDER BY 1`,
            START, END,
        );
        queues = rows.map((r) => r.q);
    }

    console.log(`\nPériode ${START.toISOString().slice(0, 10)} → ${END.toISOString().slice(0, 10)}`);
    console.log(`Règles : ${JSON.stringify(rules)}\n`);
    console.log(
        "file".padEnd(8),
        ...CHAMPS.map((c) => c.slice(0, 9).padStart(10)),
    );

    const totaux: Record<string, { a: number; b: number }> = {};
    for (const c of CHAMPS) totaux[c] = { a: 0, b: 0 };

    for (const q of queues) {
        const [oldR, newR] = await Promise.all([
            prisma.$queryRawUnsafe<Record<string, bigint>[]>(LEGACY, q, START, END),
            prisma.$queryRawUnsafe<Record<string, bigint>[]>(CURRENT, q, START, END),
        ]);
        if (!oldR[0] || !newR[0]) continue;

        const ligne: string[] = [];
        let diff = false;
        for (const c of CHAMPS) {
            const a = Number(oldR[0][c] ?? 0);
            const b = Number(newR[0][c] ?? 0);
            totaux[c].a += a;
            totaux[c].b += b;
            if (a !== b) diff = true;
            ligne.push((a === b ? `${b}` : `${a}→${b}`).padStart(10));
        }
        console.log(q.padEnd(8), ...ligne, diff ? "" : " (inchangé)");
    }

    console.log("\n--- TOTAL ---");
    for (const c of CHAMPS) {
        const { a, b } = totaux[c];
        const ecart = b - a;
        console.log(
            `  ${c.padEnd(18)} ${String(a).padStart(7)} → ${String(b).padStart(7)}` +
            (ecart === 0 ? "   =" : `   ${ecart > 0 ? "+" : ""}${ecart}`),
        );
    }

    await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
