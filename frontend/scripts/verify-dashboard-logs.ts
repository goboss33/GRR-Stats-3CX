// Invariant : sur une meme periode, les statuts du tableau de bord et ceux des
// journaux doivent concorder. Lecture seule.
import { getGlobalMetricsRaw } from "@/services/repositories/cdr.repository";
import { getPrismaCdr } from "@/lib/prisma-cdr";
import { SQL_REAL_PARTY_DEST_TYPES, buildFinalStatusCaseSQL } from "@/services/domain/call-aggregation";

const START = new Date(process.argv[2] ?? "2026-07-01T00:00:00.000Z");
const END = new Date(process.argv[3] ?? "2026-08-01T00:00:00.000Z");

(async () => {
    const prisma = getPrismaCdr("gerofinance");

    // Cote tableau de bord : la requete reelle.
    const dash = await getGlobalMetricsRaw("gerofinance", START, END);

    // Cote journaux : la meme regle, appliquee comme le fait la liste.
    const logs: any = await prisma.$queryRawUnsafe(`
        WITH ca AS (SELECT call_history_id FROM cdroutput
                    WHERE cdr_started_at >= $1 AND cdr_started_at <= $2 GROUP BY call_history_id),
        ls AS (SELECT DISTINCT ON (call_history_id) call_history_id,
                  destination_dn_type ls_last_dest_type, destination_entity_type ls_last_dest_entity_type,
                  termination_reason_details ls_termination_reason_details
               FROM cdroutput WHERE cdr_started_at >= $1 AND cdr_started_at <= $2
               ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC),
        lh AS (SELECT DISTINCT ON (call_history_id) call_history_id,
                  cdr_answered_at lh_answered_at, cdr_started_at lh_started_at, cdr_ended_at lh_ended_at
               FROM cdroutput WHERE cdr_started_at >= $1 AND cdr_started_at <= $2
                 AND destination_dn_type IN (${SQL_REAL_PARTY_DEST_TYPES})
                 AND COALESCE(destination_entity_type,'') != 'voicemail'
               ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC),
        v AS (SELECT ${buildFinalStatusCaseSQL()} AS statut
              FROM ca JOIN ls USING (call_history_id) LEFT JOIN lh USING (call_history_id))
        SELECT COUNT(*) total,
               COUNT(*) FILTER (WHERE statut = 'answered') repondus,
               COUNT(*) FILTER (WHERE statut = 'voicemail') messagerie,
               COUNT(*) FILTER (WHERE statut IN ('missed','busy')) perdus
        FROM v`, START, END);

    const l = logs[0];
    const paires: [string, number, number][] = [
        ["Total", Number(dash.total_calls), Number(l.total)],
        ["Répondus", Number(dash.answered_calls), Number(l.repondus)],
        ["Messagerie", Number(dash.voicemail_calls), Number(l.messagerie)],
        ["Perdus", Number(dash.missed_calls) + Number(dash.busy_calls), Number(l.perdus)],
    ];

    console.log(`\nPériode ${START.toISOString().slice(0,10)} → ${END.toISOString().slice(0,10)}\n`);
    console.log("métrique".padEnd(14), "tableau de bord".padStart(16), "journaux".padStart(10), "  verdict");
    let ko = 0;
    for (const [nom, a, b] of paires) {
        if (a !== b) ko++;
        console.log(nom.padEnd(14), String(a).padStart(16), String(b).padStart(10), a === b ? "  ✓" : `  ✗ écart de ${a - b}`);
    }
    console.log(ko === 0 ? "\n=> Les deux écrans comptent identiquement.\n" : `\n=> ${ko} métrique(s) en écart.\n`);
    process.exit(ko === 0 ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(1); });
