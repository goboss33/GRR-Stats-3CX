// Test de fumée de la mesure d'impact : le même SQL que le service, joué avec
// deux jeux de règles, pour vérifier qu'il tourne et que l'écart est plausible.
import { getPrismaCdr } from "@/lib/prisma-cdr";
import {
    DEFAULT_CLASSIFICATION_RULES,
    buildTeamCTEChain,
    sumBucket,
    type ClassificationRules,
    type PassageOutcome,
} from "@/services/domain/call-classification";

const QUEUE = process.argv[2] ?? "900";
const END = new Date("2026-07-30T00:00:00.000Z");
const START = new Date(END.getTime() - 30 * 86_400_000);

async function compte(rules: ClassificationRules) {
    const prisma = getPrismaCdr("gerofinance");
    const rows = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(
        `WITH ${buildTeamCTEChain(rules, { queueExpr: "$1", startExpr: "$2", endExpr: "$3" })}
         SELECT
             (SELECT COUNT(*) FROM queue_calls WHERE outcome = 'answered')      AS answered,
             (SELECT COUNT(*) FROM queue_calls WHERE outcome = 'overflow')      AS overflow,
             (SELECT COUNT(*) FROM queue_calls WHERE outcome = 'voicemail')     AS voicemail,
             (SELECT COUNT(*) FROM queue_calls WHERE outcome = 'short_abandon') AS short_abandon,
             (SELECT COUNT(*) FROM queue_calls WHERE outcome = 'abandoned')     AS abandoned,
             (SELECT COUNT(*) FROM direct_calls)                                AS direct_total,
             (SELECT COUNT(*) FROM direct_calls WHERE answered)                 AS direct_answered,
             (SELECT COUNT(*) FROM (
                  SELECT call_history_id FROM queue_passages
                  GROUP BY call_history_id HAVING COUNT(*) > 1) m)              AS multi_passage`,
        QUEUE, START, END,
    );
    const r = rows[0];
    const counts: Partial<Record<PassageOutcome, number>> = {
        answered: Number(r.answered), overflow: Number(r.overflow), voicemail: Number(r.voicemail),
        short_abandon: Number(r.short_abandon), abandoned: Number(r.abandoned),
    };
    const dt = Number(r.direct_total), da = Number(r.direct_answered);
    return {
        received: sumBucket(counts, "received") + dt,
        answered: sumBucket(counts, "answered") + da,
        lost: sumBucket(counts, "lost") + (dt - da),
        overflow: sumBucket(counts, "overflow"),
        multi: Number(r.multi_passage),
    };
}

async function main() {
    const actuel = await compte(DEFAULT_CLASSIFICATION_RULES);
    // Règle envisagée : le débordement compté comme perdu pour la file d'origine.
    const envisage = await compte({ ...DEFAULT_CLASSIFICATION_RULES, overflow: "lost" });

    console.log(`\nFile ${QUEUE} — 30 derniers jours\n`);
    console.log("métrique".padEnd(14), "enregistré".padStart(11), "envisagé".padStart(10), "  écart");
    for (const k of ["received", "answered", "lost", "overflow"] as const) {
        const a = actuel[k], b = envisage[k];
        console.log(k.padEnd(14), String(a).padStart(11), String(b).padStart(10), a === b ? "  =" : `  ${b - a > 0 ? "+" : ""}${b - a}`);
    }
    console.log(`\nAppels repassant plusieurs fois : ${actuel.multi}\n`);
    process.exit(0);
}
main().catch((e) => { console.error("ÉCHEC :", e.message); process.exit(1); });
