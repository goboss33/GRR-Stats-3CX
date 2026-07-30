// DIAGNOSTIC (LECTURE SEULE — que des SELECT).
//
// Deux questions posées par l'utilisateur :
//   1. Peut-on distinguer les appels tombés en messagerie HORS HEURES
//      (renvoi automatique) de ceux envoyés INTENTIONNELLEMENT par un agent ?
//   2. Les statistiques actuelles comptabilisent-elles les appels hors heures ?
import { getPrismaCdr } from "@/lib/prisma-cdr";

const QUEUE = "900";
const START = new Date("2026-06-01T00:00:00.000Z");
const END = new Date("2026-07-01T00:00:00.000Z");

async function main() {
    const prisma = getPrismaCdr("gerofinance");
    const q = <T>(sql: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...p);

    console.log(`\n=== File ${QUEUE} — juin 2026 ===\n`);

    // 1. Les segments messagerie : d'où viennent-ils ?
    console.log("--- Segments messagerie : motif de renvoi x type de source ---");
    const reasons = await q<Record<string, unknown>>(
        `SELECT COALESCE(c.creation_forward_reason,'(aucun)') AS motif,
                COALESCE(src.destination_dn_type,'(racine)') AS segment_precedent,
                COUNT(*) AS n
         FROM cdroutput c
         LEFT JOIN cdroutput src ON src.cdr_id = c.originating_cdr_id
         WHERE c.destination_entity_type = 'voicemail'
           AND c.cdr_started_at >= $1 AND c.cdr_started_at < $2
         GROUP BY 1,2 ORDER BY n DESC LIMIT 15`,
        START, END,
    );
    for (const r of reasons) {
        console.log(`  ${String(r.motif).padEnd(22)} <- ${String(r.segment_precedent).padEnd(12)} ${String(r.n).padStart(6)}`);
    }

    // 2. Répartition horaire des messageries (heure locale Europe/Zurich).
    console.log("\n--- Messageries par heure locale (Europe/Zurich) ---");
    const hours = await q<Record<string, unknown>>(
        `SELECT EXTRACT(HOUR FROM c.cdr_started_at AT TIME ZONE 'Europe/Zurich')::int AS heure,
                COUNT(*) AS n
         FROM cdroutput c
         WHERE c.destination_entity_type = 'voicemail'
           AND c.cdr_started_at >= $1 AND c.cdr_started_at < $2
         GROUP BY 1 ORDER BY 1`,
        START, END,
    );
    const maxN = Math.max(...hours.map((h) => Number(h.n)));
    for (const h of hours) {
        const n = Number(h.n);
        console.log(`  ${String(h.heure).padStart(2, "0")}h ${String(n).padStart(5)} ${"#".repeat(Math.round((n / maxN) * 40))}`);
    }

    // 3. Les appels de la file 900 classés « abandonnés » : combien finissent
    //    en messagerie, et à quelle heure ? (= perdus gonflés par le hors-heures)
    console.log("\n--- Appels file 900 classés ABANDONNÉS : part avec messagerie ---");
    const ab = await q<Record<string, unknown>>(
        `WITH passages AS (
             SELECT c.call_history_id, c.cdr_id, c.cdr_started_at,
                 EXISTS (SELECT 1 FROM cdroutput p WHERE p.originating_cdr_id = c.cdr_id
                          AND p.creation_forward_reason='polling' AND p.cdr_answered_at IS NOT NULL) AS answered,
                 EXISTS (SELECT 1 FROM cdroutput c2 WHERE c2.call_history_id = c.call_history_id
                          AND c2.destination_dn_type='queue' AND c2.destination_dn_number != c.destination_dn_number
                          AND c2.cdr_started_at > c.cdr_started_at) AS later_other_queue
             FROM cdroutput c
             WHERE c.destination_dn_number = $1 AND c.destination_dn_type='queue'
               AND c.cdr_started_at >= $2 AND c.cdr_started_at < $3
         ),
         per_call AS (
             SELECT call_history_id, MIN(cdr_started_at) AS t,
                 CASE WHEN bool_or(answered) THEN 'repondu'
                      WHEN bool_or(later_other_queue) THEN 'redirige'
                      ELSE 'abandonne' END AS outcome
             FROM passages GROUP BY call_history_id
         )
         SELECT
             COUNT(*) FILTER (WHERE outcome='abandonne') AS abandonnes,
             COUNT(*) FILTER (WHERE outcome='abandonne' AND EXISTS (
                 SELECT 1 FROM cdroutput v WHERE v.call_history_id = per_call.call_history_id
                   AND v.destination_entity_type='voicemail')) AS dont_messagerie,
             COUNT(*) FILTER (WHERE outcome='abandonne' AND (
                 EXTRACT(HOUR FROM t AT TIME ZONE 'Europe/Zurich') < 8
                 OR EXTRACT(HOUR FROM t AT TIME ZONE 'Europe/Zurich') >= 18
                 OR EXTRACT(ISODOW FROM t AT TIME ZONE 'Europe/Zurich') > 5)) AS dont_hors_heures
         FROM per_call`,
        QUEUE, START, END,
    );
    const a = ab[0];
    console.log(`  abandonnés               : ${Number(a.abandonnes)}`);
    console.log(`  dont avec messagerie     : ${Number(a.dont_messagerie)}`);
    console.log(`  dont hors 08h-18h/we     : ${Number(a.dont_hors_heures)}`);

    // 4. Les appels hors heures entrent-ils seulement dans la file ?
    console.log("\n--- Passages en file 900, dans/hors heures ouvrées ---");
    const inout = await q<Record<string, unknown>>(
        `SELECT
             COUNT(DISTINCT call_history_id) FILTER (WHERE h >= 8 AND h < 18 AND d <= 5) AS heures_ouvrees,
             COUNT(DISTINCT call_history_id) FILTER (WHERE NOT (h >= 8 AND h < 18 AND d <= 5)) AS hors_heures
         FROM (
             SELECT call_history_id,
                 EXTRACT(HOUR FROM cdr_started_at AT TIME ZONE 'Europe/Zurich')::int AS h,
                 EXTRACT(ISODOW FROM cdr_started_at AT TIME ZONE 'Europe/Zurich')::int AS d
             FROM cdroutput
             WHERE destination_dn_number = $1 AND destination_dn_type='queue'
               AND cdr_started_at >= $2 AND cdr_started_at < $3
         ) x`,
        QUEUE, START, END,
    );
    console.log(`  appels en heures ouvrées : ${Number(inout[0].heures_ouvrees)}`);
    console.log(`  appels hors heures       : ${Number(inout[0].hors_heures)}`);

    await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
