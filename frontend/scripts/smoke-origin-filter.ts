// Vérifie que le filtre d'origine partitionne bien la population de l'équipe :
// File + Direct doit redonner le total de la vue file. Lecture seule.
import { getPrismaCdr } from "@/lib/prisma-cdr";
import { DEFAULT_CLASSIFICATION_RULES as rules, buildQueueOutcomeSubquery, type PassageOutcome } from "@/services/domain/call-classification";

const QUEUE = process.argv[2] ?? "972";
const START = new Date("2026-07-01T00:00:00.000Z");
const END = new Date("2026-08-01T00:00:00.000Z");
const ALL: PassageOutcome[] = ["answered", "overflow", "voicemail", "short_abandon", "abandoned"];

async function main() {
    const prisma = getPrismaCdr("gerofinance");
    const compte = async (outcomes: PassageOutcome[], direct: boolean) => {
        const sub = buildQueueOutcomeSubquery(rules, {
            queueExpr: "$1", startExpr: "$2", endExpr: "$3", outcomes, includeTeamDirect: direct,
        });
        const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM ${sub} AS x`, QUEUE, START, END);
        return Number(r[0].n);
    };

    const total = await compte(ALL, true);
    const file = await compte(ALL, false);
    const direct = await compte([], true);

    console.log(`\nFile ${QUEUE} — juillet 2026\n`);
    console.log(`  Origine « File »   : ${String(file).padStart(6)}`);
    console.log(`  Origine « Direct » : ${String(direct).padStart(6)}`);
    console.log(`  Total vue file     : ${String(total).padStart(6)}`);
    console.log(file + direct === total
        ? "\n=> Les deux origines forment bien une partition.\n"
        : `\n=> Partition rompue : ${file + direct} ≠ ${total}\n`);
    await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
