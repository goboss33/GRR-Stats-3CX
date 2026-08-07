// Vérifie que la vue file des logs rend exactement les populations des
// vignettes : sans filtre, puis pour chaque statut coché. Lecture seule.
import { getPrismaCdr } from "@/lib/prisma-cdr";
import {
    DEFAULT_CLASSIFICATION_RULES as rules,
    buildQueueOutcomeSubquery,
    outcomesForBucket,
    type PassageOutcome,
} from "@/services/domain/call-classification";

const QUEUE = process.argv[2] ?? "972";
const START = new Date(process.argv[3] ?? "2026-07-01T00:00:00.000Z");
const END = new Date(process.argv[4] ?? "2026-08-01T00:00:00.000Z");
const ALL: PassageOutcome[] = ["answered", "handed_off", "overflow", "voicemail", "short_abandon", "abandoned"];

async function main() {
    const prisma = getPrismaCdr("gerofinance");
    // Attendus rebaselinés le 7 août 2026 (base locale resynchronisée + le
    // filtre « Répondu » couvre désormais les transferts accomplis).
    const cas: Array<{ nom: string; outcomes: PassageOutcome[]; attendu: number }> = [
        { nom: "Vue file, aucun filtre", outcomes: ALL, attendu: 1267 },
        { nom: "Filtre « Répondu » (+ transférés)", outcomes: outcomesForBucket("answered"), attendu: 680 },
        { nom: "Filtre « Perdus » (3 statuts)", outcomes: outcomesForBucket("lost"), attendu: 567 },
        { nom: "Filtre « Débordé »", outcomes: outcomesForBucket("overflow"), attendu: 20 },
    ];

    console.log(`\nFile ${QUEUE} — ${START.toISOString().slice(0, 10)} → ${END.toISOString().slice(0, 10)}\n`);
    for (const c of cas) {
        const sub = buildQueueOutcomeSubquery(rules, {
            queueExpr: "$1", startExpr: "$2", endExpr: "$3",
            outcomes: c.outcomes, includeTeamDirect: true,
        });
        const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT COUNT(*) AS n FROM ${sub} AS x`, QUEUE, START, END,
        );
        const n = Number(rows[0].n);
        console.log(`  ${c.nom.padEnd(32)} ${String(n).padStart(6)}   vignette ${String(c.attendu).padStart(6)}   ${n === c.attendu ? "✓" : "✗"}`);
    }
    await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
