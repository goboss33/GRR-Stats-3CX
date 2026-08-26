// Lit le PLAN D'EXÉCUTION de la requête des collaborateurs — celle qui coûte
// 6 s sur un mois et 43 s sur trois (cf. bench-agents-fenetre). Reconstruit
// exactement la requête de /api/analytics/agents, puis l'exécute sous
// EXPLAIN (ANALYZE, BUFFERS) pour voir où Postgres passe son temps.
// Lecture seule (la requête ne fait que des SELECT).
//
// Usage : npx tsx scripts/explain-agents.ts [file=958] [mois|plage=2026-07] [origin=external]
//   plage : « 2026-05..2026-07 » pour observer la dégradation.
//
// Lecture du résultat : chercher les nœuds dont « actual time » explose, les
// « rows removed by filter » massifs, et les écarts entre lignes estimées et
// lignes réelles (une estimation fausse = un mauvais plan choisi).
import { getPrismaCdr } from "@/lib/prisma-cdr";
import { getClassificationRules } from "@/lib/classification-rules";
import { buildTeamCTEChain, buildAgentCTEChain, type CallOrigin } from "@/services/domain/call-classification";
import { resolveRosterForRules } from "@/services/xapi-journal.service";

const SERVER = "gerofinance" as const;
const QUEUE = process.argv[2] ?? "958";
const PERIODE = process.argv[3] ?? "2026-07";
const ORIGIN = (process.argv[4] ?? "external") as CallOrigin;

const offsetH = (mois: number) => (mois >= 4 && mois <= 10 ? 2 : 1);
const [PREMIER, DERNIER] = PERIODE.includes("..") ? PERIODE.split("..") : [PERIODE, PERIODE];
const [Y1, M1] = PREMIER.split("-").map(Number);
const [Y2, M2] = DERNIER.split("-").map(Number);
const START = new Date(Date.UTC(Y1, M1 - 1, 1) - offsetH(M1) * 3600_000);
const END = new Date(Date.UTC(Y2, M2, 1) - offsetH(M2) * 3600_000 - 1);

async function main() {
    const prisma = getPrismaCdr(SERVER);
    const rules = await getClassificationRules();
    const rosterMembers = await resolveRosterForRules(rules, SERVER, QUEUE, START, END);

    // Reconstruction À L'IDENTIQUE de app/api/analytics/agents/route.ts.
    const query = `
        WITH ${buildTeamCTEChain(rules, { queueExpr: "$1", startExpr: "$2", endExpr: "$3", origin: ORIGIN, rosterMembers })},
        ${buildAgentCTEChain(rules)}
        SELECT
            ar.extension,
            ar.name,
            COALESCE(aqs.calls_received, 0) as calls_received,
            COALESCE(aqs.resolved, 0) as resolved,
            COALESCE(aqs.transferred, 0) as transferred,
            COALESCE(aqs.queue_talk_time, 0) as queue_talk_time,
            COALESCE(ad.direct_received, 0) as direct_received,
            COALESCE(ad.direct_answered, 0) as direct_answered,
            COALESCE(ad.direct_transferred, 0) as direct_transferred,
            COALESCE(ad.direct_talk_time, 0) as direct_talk_time
        FROM agent_roster ar
        LEFT JOIN agent_queue_stats aqs ON ar.extension = aqs.extension AND ar.name = aqs.name
        LEFT JOIN agent_direct ad ON ar.extension = ad.extension AND ar.name = ad.name
        ORDER BY ar.extension, ar.name
    `;

    console.log(`\n  Plan d'exécution — file ${QUEUE}, ${PERIODE}, provenance « ${ORIGIN} »`);
    console.log(`  ${START.toISOString()} → ${END.toISOString()}`);
    console.log(`  roster fermé : ${rosterMembers ? `${rosterMembers.length} membres (journal)` : "non (déduit de l'activité)"}\n`);

    const t0 = Date.now();
    const plan = await prisma.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
        `EXPLAIN (ANALYZE, BUFFERS, VERBOSE false) ${query}`,
        QUEUE, START, END,
    );
    console.log(`  (EXPLAIN ANALYZE terminé en ${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);
    for (const ligne of plan) console.log(ligne["QUERY PLAN"]);
    console.log("");
    process.exit(0);
}

main().catch((e) => {
    console.error(String(e).slice(0, 600));
    process.exit(1);
});
