// Vérifie l'invariant central du socle de classement : pour chaque carte de
// KPI, le chiffre affiché doit être EXACTEMENT le nombre de lignes que ramène
// le clic vers les logs.
//
// C'est le test de non-régression du problème d'origine (juin 2026, file 900 :
// 228 perdus annoncés contre 250 lignes listées).
//
// Usage : npx tsx scripts/verify-kpi-logs-match.ts [file] [début ISO] [fin ISO]
import { getPrismaCdr } from "@/lib/prisma-cdr";
import { getClassificationRules } from "@/lib/classification-rules";
import { getStatsExclusions } from "@/lib/stats-exclusions";
import {
    buildTeamCTEChain,
    buildAgentCTEChain,
    TEAM_CALLS_UNION_SQL,
    buildQueueOutcomeSubquery,
    outcomesForBucket,
    cdrTable,
    type PassageOutcome,
} from "@/services/domain/call-classification";

const QUEUE = process.argv[2] ?? "900";
const START = new Date(process.argv[3] ?? "2026-06-01T00:00:00.000Z");
const END = new Date(process.argv[4] ?? "2026-07-01T00:00:00.000Z");



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
    // Règles VIVANTES et exclusions réelles : le script vérifiait longtemps
    // les règles par défaut — un angle mort qui a caché l'écart 616/586 de
    // juillet 2026 (exclusions absentes des vignettes).
    const rules = await getClassificationRules();
    const exclusions = await getStatsExclusions("gerofinance");
    const P = { queueExpr: "$1", startExpr: "$2", endExpr: "$3", exclusions };

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
                    ? "+ (SELECT COUNT(*) FROM direct_calls WHERE outcome = 'answered')"
                    : carte.outcomes.includes("abandoned")
                        ? "+ (SELECT COUNT(*) FROM direct_calls WHERE outcome = 'abandoned')"
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
             FROM ${cdrTable(rules)}
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
            ? "\n=> Chaque KPI correspond exactement au nombre de lignes listées."
            : `\n=> ${ko} carte(s) en écart : l'invariant est rompu.`,
    );

    // Second invariant : le tableau par agent doit se refermer sur la vignette.
    // Chaque appel répondu par la file a exactement un agent « résolveur », donc
    // la somme des agents ne peut ni dépasser ni manquer le chiffre de la carte.
    const agentRows = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(
        `WITH ${buildTeamCTEChain(rules, P)},
         ${buildAgentCTEChain(rules)}
         SELECT
             (SELECT COALESCE(SUM(resolved), 0) FROM agent_queue_stats) AS resolus,
             (SELECT COUNT(*) FROM queue_calls WHERE outcome = 'answered') AS repondus,
             (SELECT COUNT(*) FROM agent_queue_stats) AS agents,
             (SELECT COALESCE(SUM(direct_received), 0) FROM agent_direct) AS directs_agents,
             (SELECT COUNT(*) FROM direct_calls) AS directs_vignette`,
        QUEUE, START, END,
    );

    const resolus = Number(agentRows[0].resolus);
    const repondus = Number(agentRows[0].repondus);
    const nbAgents = Number(agentRows[0].agents);
    const agentOk = resolus === repondus;
    if (!agentOk) ko++;

    console.log(`\nTableau par agent (${nbAgents} agents)`);
    console.log(
        `  somme des « répondus » agents : ${resolus}   vignette Répondus (part file) : ${repondus}` +
        (agentOk ? "   ✓" : `   ✗ écart de ${resolus - repondus}`),
    );

    // Signalé sans faire échouer : un appel direct sonnant successivement chez
    // plusieurs agents produit une ligne par agent, mais reste un seul appel
    // dans la vignette. En pratique le cas est rare ; tant qu'il ne survient
    // pas, les deux totaux coïncident. Le jour où cet écart apparaît, il faudra
    // trancher qui « possède » l'appel (règle à ajouter au socle).
    const directsAgents = Number(agentRows[0].directs_agents);
    const directsVignette = Number(agentRows[0].directs_vignette);
    console.log(
        `  somme des « directs » agents   : ${directsAgents}   vignette Directs : ${directsVignette}` +
        (directsAgents === directsVignette
            ? "   ✓"
            : `   ⚠ ${directsAgents - directsVignette} appel(s) sonnant chez plusieurs agents`),
    );

    // Troisième invariant : les graphiques temporels doivent porter sur la même
    // population que les vignettes. Ils comptaient auparavant les appels ayant
    // touché la file, sans la partition ni les appels directs.
    const graphRows = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(
        `WITH ${buildTeamCTEChain(rules, P)},
         team_calls AS (${TEAM_CALLS_UNION_SQL})
         SELECT
             (SELECT COUNT(*) FROM team_calls) AS courbe,
             (SELECT COUNT(*) FROM queue_calls) + (SELECT COUNT(*) FROM direct_calls) AS vignette`,
        QUEUE, START, END,
    );
    const courbe = Number(graphRows[0].courbe);
    const vignette = Number(graphRows[0].vignette);
    if (courbe !== vignette) ko++;

    console.log("\nGraphiques temporels");
    console.log(
        `  somme de la courbe : ${courbe}   vignette Total reçus : ${vignette}` +
        (courbe === vignette ? "   ✓" : `   ✗ écart de ${courbe - vignette}`),
    );

    await prisma.$disconnect();
    process.exit(ko === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
