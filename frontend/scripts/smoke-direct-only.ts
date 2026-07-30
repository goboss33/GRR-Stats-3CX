// Vérifie que le filtre « Directs de l'équipe » seul (aucun statut de file
// coché) produit un SQL valide : la liste de statuts est alors vide, ce qui
// donnerait un `IN ()` invalide sans garde-fou. Lecture seule, période courte.
import { getPrismaCdr } from "@/lib/prisma-cdr";
import { DEFAULT_CLASSIFICATION_RULES as rules, buildQueueOutcomeSubquery } from "@/services/domain/call-classification";

const QUEUE = process.argv[2] ?? "972";
const START = new Date("2026-07-29T00:00:00.000Z");
const END = new Date("2026-07-30T00:00:00.000Z");

async function main() {
    const prisma = getPrismaCdr("gerofinance");
    const cas: Array<{ nom: string; outcomes: never[] | ("answered")[]; direct: boolean }> = [
        { nom: "Directs seuls", outcomes: [], direct: true },
        { nom: "Répondus file seuls", outcomes: ["answered"], direct: false },
        { nom: "Répondus + directs", outcomes: ["answered"], direct: true },
    ];

    for (const c of cas) {
        const sub = buildQueueOutcomeSubquery(rules, {
            queueExpr: "$1", startExpr: "$2", endExpr: "$3",
            outcomes: c.outcomes, includeTeamDirect: c.direct,
        });
        const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT COUNT(*) AS n FROM ${sub} AS x`, QUEUE, START, END,
        );
        console.log(`  ${c.nom.padEnd(22)} ${String(Number(rows[0].n)).padStart(6)} appels`);
    }
    await prisma.$disconnect();
}
main().catch((e) => { console.error("ÉCHEC :", e.message); process.exit(1); });
