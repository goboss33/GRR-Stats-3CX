// Compare la population des graphiques (timeline / heatmap) avec celle des
// vignettes, pour une file et une journee. Lecture seule.
import { getPrismaCdr } from "@/lib/prisma-cdr";
import { DEFAULT_CLASSIFICATION_RULES as rules, buildTeamCTEChain } from "@/services/domain/call-classification";

const QUEUE = process.argv[2] ?? "906";
const START = new Date(process.argv[3] ?? "2026-07-24T00:00:00.000Z");
const END = new Date(process.argv[4] ?? "2026-07-25T00:00:00.000Z");

async function main() {
    const prisma = getPrismaCdr("gerofinance");

    // Ce que comptent la timeline et la heatmap : tout appel ayant touche la file.
    const brut = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(DISTINCT call_history_id) AS n FROM cdroutput
         WHERE destination_dn_number = $1 AND destination_dn_type = 'queue'
           AND cdr_started_at >= $2 AND cdr_started_at <= $3`,
        QUEUE, START, END,
    );

    // Ce que comptent les vignettes : la partition du socle.
    const socle = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(
        `WITH ${buildTeamCTEChain(rules, { queueExpr: "$1", startExpr: "$2", endExpr: "$3" })}
         SELECT (SELECT COUNT(*) FROM queue_calls)   AS file,
                (SELECT COUNT(*) FROM direct_calls)  AS directs`,
        QUEUE, START, END,
    );

    const b = Number(brut[0].n);
    const f = Number(socle[0].file);
    const d = Number(socle[0].directs);

    console.log(`\nFile ${QUEUE} — ${START.toISOString().slice(0, 10)}\n`);
    console.log(`  Graphiques (appels ayant touche la file) : ${b}`);
    console.log(`  Vignette « File »                        : ${f}`);
    console.log(`  Vignette « Directs »                     : ${d}`);
    console.log(`  Vignette « Total recus »                 : ${f + d}`);
    console.log(`\n  => ${b - f} appel(s) ont touche la file mais sont comptes en Directs`);
    console.log(`     (regle du premier contact), et ${f + d - b} appel(s) direct(s) purs.\n`);
    await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
