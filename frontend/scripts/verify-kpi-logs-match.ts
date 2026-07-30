// Vérifie l'invariant central du socle de classement : pour chaque carte de
// KPI, le chiffre affiché doit être EXACTEMENT le nombre de lignes que ramène
// le clic vers les logs.
//
// C'est le test de non-régression du problème d'origine (juin 2026, file 900 :
// 228 perdus annoncés contre 250 lignes listées).
//
// Usage : npx tsx scripts/verify-kpi-logs-match.ts [file] [début ISO] [fin ISO]
import { getPrismaCdr } from "@/lib/prisma-cdr";
import {
    DEFAULT_CLASSIFICATION_RULES as rules,
    buildTeamCTEChain,
    buildQueueOutcomeSubquery,
    outcomesForBucket,
    type PassageOutcome,
} from "@/services/domain/call-classification";

const QUEUE = process.argv[2] ?? "900";
const START = new Date(process.argv[3] ?? "2026-06-01T00:00:00.000Z");
const END = new Date(process.argv[4] ?? "2026-07-01T00:00:00.000Z");

const P = { queueExpr: "$1", startExpr: "$2", endExpr: "$3" };

/**
 * Les quatre vignettes du bilan d'équipe. Les statuts agrégés viennent de la
 * même table de regroupement que l'écran : si le regroupement change, ce test
 * suit automatiquement.
 */
const CARTES: Array<{ nom: string; outcomes: PassageOutcome[]; team: boolean }> = [
    { nom: "Total reçus", outcomes: outcomesForBucket("received"), team: true },
    { nom: "Répondus", outcomes: outcomesForBucket("answered"), team: true },
    { nom: "Perdus", outcomes: outcomesForBucket("lost"), team: true },
    { nom: "Redirigés", outcomes: outcomesForBucket("overflow"), team: false },
];

async function main() {
    const prisma = getPrismaCdr("gerofinance");

    console.log(`\nFile ${QUEUE} — ${START.toISOString().slice(0, 10)} → ${END.toISOString().slice(0, 10)}\n`);

    console.log("carte".padEnd(18), "KPI".padStart(8), "logs".padStart(8), "  verdict");
    let ko = 0;

    for (const carte of CARTES) {
        // Côté KPI : agrégation de la couche `queue_calls` (+ `direct_calls`).
        const outcomeList = carte.outcomes.map((o) => `'${o}'`).join(", ");
        const directPart = carte.team
            ? carte.outcomes.includes("answered") && carte.outcomes.includes("abandoned")
                ? "+ (SELECT COUNT(*) FROM direct_calls)"
                : carte.outcomes.includes("answered")
                    ? "+ (SELECT COUNT(*) FROM direct_calls WHERE answered)"
                    : carte.outcomes.includes("abandoned")
                        ? "+ (SELECT COUNT(*) FROM direct_calls WHERE NOT answered)"
                        : ""
            : "";

        const kpiRows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
            `WITH ${buildTeamCTEChain(rules, P)}
             SELECT (SELECT COUNT(*) FROM queue_calls WHERE outcome IN (${outcomeList})) ${directPart} AS n`,
            QUEUE, START, END,
        );

        // Côté logs : le filtre réellement posé par le lien de la carte.
        const subquery = buildQueueOutcomeSubquery(rules, {
            ...P,
            outcomes: carte.outcomes,
            includeTeamDirect: carte.team,
        });
        const logRows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT COUNT(DISTINCT call_history_id) AS n
             FROM cdroutput
             WHERE cdr_started_at >= $2 AND cdr_started_at <= $3
               AND call_history_id IN ${subquery}`,
            QUEUE, START, END,
        );

        const a = Number(kpiRows[0].n);
        const b = Number(logRows[0].n);
        if (a !== b) ko++;
        console.log(
            carte.nom.padEnd(18),
            String(a).padStart(8),
            String(b).padStart(8),
            a === b ? "  ✓" : `  ✗ écart de ${b - a}`,
        );
    }

    console.log(
        ko === 0
            ? "\n=> Chaque KPI correspond exactement au nombre de lignes listées.\n"
            : `\n=> ${ko} carte(s) en écart : l'invariant est rompu.\n`,
    );

    await prisma.$disconnect();
    process.exit(ko === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
