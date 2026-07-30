// DIAGNOSTIC (LECTURE SEULE — aucune écriture, aucun code applicatif modifié).
//
// Compare, pour une file donnée, les deux façons de compter qui coexistent
// dans l'application :
//
//   A. KPI « statistiques de file » (app/api/analytics/queue/route.ts)
//      → classement PAR APPEL : bool_or sur tous les passages, avec priorité
//        répondu > débordement > abandonné. Chaque appel compte UNE fois et
//        dans UNE seule catégorie.
//
//   B. Filtre de parcours des logs (buildSingleConditionSQL)
//      → EXISTS(un segment du parcours avec result = X) : classement PAR
//        SEGMENT. Un appel passé plusieurs fois dans la file peut satisfaire
//        PLUSIEURS catégories à la fois.
//
// Le script mesure aussi la troncature du parcours à 15 segments
// (all_steps.step_num <= 15), qui retire des appels du filtre logs sans les
// retirer des KPIs.
import { getPrismaCdr } from "@/lib/prisma-cdr";

const QUEUE = process.argv[2] ?? "900";
const START = new Date(process.argv[3] ?? "2026-07-01T00:00:00.000Z");
const END = new Date(process.argv[4] ?? "2026-07-29T00:00:00.000Z");

/**
 * Classement de chaque passage en file, repris à l'identique de la logique
 * `queue_outcome` / `queue_overflow` du CTE `call_journey`.
 */
const PASSAGES = `
    passages AS (
        SELECT
            c.call_history_id,
            c.cdr_id,
            c.cdr_started_at,
            EXISTS (
                SELECT 1 FROM cdroutput p
                WHERE p.originating_cdr_id = c.cdr_id
                  AND p.creation_forward_reason = 'polling'
                  AND p.cdr_answered_at IS NOT NULL
            ) AS answered,
            EXISTS (
                SELECT 1 FROM cdroutput c2
                WHERE c2.call_history_id = c.call_history_id
                  AND c2.destination_dn_type = 'queue'
                  AND c2.destination_dn_number != c.destination_dn_number
                  AND c2.cdr_started_at > c.cdr_started_at
            ) AS has_later_other_queue
        FROM cdroutput c
        WHERE c.destination_dn_number = $1
          AND c.destination_dn_type = 'queue'
          AND c.cdr_started_at >= $2
          AND c.cdr_started_at <= $3
    ),
    classified AS (
        SELECT
            call_history_id,
            answered,
            (NOT answered AND has_later_other_queue) AS overflow,
            (NOT answered AND NOT has_later_other_queue) AS abandoned
        FROM passages
    )
`;

async function main() {
    const prisma = getPrismaCdr("gerofinance");
    console.log(`\nFile ${QUEUE} — ${START.toISOString()} → ${END.toISOString()}\n`);

    // A. Classement PAR APPEL (KPIs).
    const statsRows = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(
        `WITH ${PASSAGES},
         per_call AS (
             SELECT call_history_id,
                 CASE WHEN bool_or(answered) THEN 'answered'
                      WHEN bool_or(overflow) THEN 'overflow'
                      ELSE 'abandoned' END AS outcome
             FROM classified GROUP BY call_history_id
         )
         SELECT
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE outcome = 'answered')  AS answered,
             COUNT(*) FILTER (WHERE outcome = 'abandoned') AS abandoned,
             COUNT(*) FILTER (WHERE outcome = 'overflow')  AS overflow
         FROM per_call`,
        QUEUE, START, END,
    );

    // B. Classement PAR SEGMENT (filtre de parcours des logs).
    const logsRows = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(
        `WITH ${PASSAGES}
         SELECT
             COUNT(DISTINCT call_history_id) AS total,
             COUNT(DISTINCT call_history_id) FILTER (WHERE answered)  AS answered,
             COUNT(DISTINCT call_history_id) FILTER (WHERE abandoned) AS abandoned,
             COUNT(DISTINCT call_history_id) FILTER (WHERE overflow)  AS overflow
         FROM classified`,
        QUEUE, START, END,
    );

    const s = statsRows[0], l = logsRows[0];
    const keys = ["total", "answered", "abandoned", "overflow"] as const;
    const label: Record<string, string> = {
        total: "Total appels", answered: "Répondus", abandoned: "Perdus", overflow: "Redirigés",
    };

    console.log("KPI (par appel) vs LOGS (par segment) — mêmes données, même période\n");
    console.log("catégorie".padEnd(16), "KPI".padStart(8), "logs".padStart(8), "  écart");
    for (const k of keys) {
        const a = Number(s[k]), b = Number(l[k]);
        console.log(label[k].padEnd(16), String(a).padStart(8), String(b).padStart(8),
            a === b ? "  =" : `  ≠  ${b - a > 0 ? "+" : ""}${b - a} ligne(s) de plus dans les logs`);
    }

    // Appels satisfaisant plusieurs catégories à la fois : la cause de l'écart.
    const multi = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(
        `WITH ${PASSAGES},
         per_call AS (
             SELECT call_history_id,
                 bool_or(answered) AS a, bool_or(abandoned) AS ab, bool_or(overflow) AS o,
                 COUNT(*) AS passages
             FROM classified GROUP BY call_history_id
         )
         SELECT
             COUNT(*) FILTER (WHERE passages > 1) AS calls_multi_passage,
             COUNT(*) FILTER (WHERE a AND ab) AS answered_and_abandoned,
             COUNT(*) FILTER (WHERE a AND o)  AS answered_and_overflow,
             COUNT(*) FILTER (WHERE ab AND o) AS abandoned_and_overflow
         FROM per_call`,
        QUEUE, START, END,
    );
    const m = multi[0];
    console.log("\nAppels repassant plusieurs fois dans la file :", Number(m.calls_multi_passage));
    console.log("  répondu ET abandonné    :", Number(m.answered_and_abandoned));
    console.log("  répondu ET redirigé     :", Number(m.answered_and_overflow));
    console.log("  abandonné ET redirigé   :", Number(m.abandoned_and_overflow));

    // Troncature du parcours à 15 segments.
    const trunc = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(
        `WITH steps AS (
             SELECT c.call_history_id, c.destination_dn_number, c.destination_dn_type,
                 ROW_NUMBER() OVER (PARTITION BY c.call_history_id ORDER BY c.cdr_started_at) AS step_num
             FROM cdroutput c
             WHERE c.call_history_id IN (
                 SELECT call_history_id FROM cdroutput
                 WHERE destination_dn_number = $1 AND destination_dn_type = 'queue'
                   AND cdr_started_at >= $2 AND cdr_started_at <= $3
             )
         )
         SELECT COUNT(DISTINCT call_history_id) AS calls_tronques
         FROM steps
         WHERE destination_dn_number = $1 AND destination_dn_type = 'queue' AND step_num > 15`,
        QUEUE, START, END,
    );
    console.log("\nAppels dont le passage en file tombe au-delà du 15e segment");
    console.log("(invisibles au filtre logs, comptés par les KPIs) :", Number(trunc[0].calls_tronques));

    await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
