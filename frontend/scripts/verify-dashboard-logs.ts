// Invariant : sur une même période, le tableau de bord et les journaux
// doivent compter la MÊME population — par construction, pas par vigilance.
//
// Deux sections :
//   1. Statuts finaux : la requête réelle du tableau de bord contre la règle
//      des journaux, appliquée comme le fait la liste.
//   2. Toggle Externe / Interne / Les deux : la population du tableau de bord
//      (sens ∈ ORIGIN_SENS[origin]) contre les filtres EXACTS que pose un
//      lien de vignette (provenance + sens) — tous construits par les MÊMES
//      fragments SQL du domaine. C'est un prédicat réécrit à la main qui
//      avait fait diverger les deux écrans de 94 appels en juillet 2026.
//
// Lecture seule. Usage : npx tsx scripts/verify-dashboard-logs.ts [start] [end]
import { getGlobalMetricsRaw } from "@/services/repositories/cdr.repository";
import { getStatsExclusions, buildExclusionFilter } from "@/lib/stats-exclusions";
import { Prisma } from "@prisma/cdr-client";
import { getPrismaCdr } from "@/lib/prisma-cdr";
import { getClassificationRules } from "@/lib/classification-rules";
import { cdrTable, type CallOrigin } from "@/services/domain/call-classification";
import {
    SQL_REAL_PARTY_DEST_TYPES,
    buildFinalStatusCaseSQL,
    buildSensFilterSQL,
    buildProvenanceFilterSQL,
    ORIGIN_SENS,
} from "@/services/domain/call-aggregation";

const START = new Date(process.argv[2] ?? "2026-07-01T00:00:00.000Z");
const END = new Date(process.argv[3] ?? "2026-08-01T00:00:00.000Z");
const ORIGINS: CallOrigin[] = ["external", "internal", "both"];

(async () => {
    const prisma = getPrismaCdr("gerofinance");
    const rules = await getClassificationRules();
    const cdr = cdrTable(rules);
    // Les exclusions (clients hébergés) s'appliquent aux DEUX écrans : la
    // réplique doit exclure exactement ce que le tableau de bord exclut.
    const cdrSql = Prisma.raw(cdr);
    const exclusion = buildExclusionFilter(await getStatsExclusions("gerofinance"), cdrSql, START, END);
    let ko = 0;

    console.log(`\nPériode ${START.toISOString().slice(0, 10)} → ${END.toISOString().slice(0, 10)} (table : ${cdr})\n`);

    // ---- 1. Statuts finaux --------------------------------------------------
    const dash = await getGlobalMetricsRaw("gerofinance", START, END);
    const logs: Array<Record<string, bigint>> = await prisma.$queryRaw(Prisma.sql`
        WITH ca AS (SELECT call_history_id FROM ${cdrSql}
                    WHERE cdr_started_at >= ${START} AND cdr_started_at <= ${END} ${exclusion}
                    GROUP BY call_history_id),
        ls AS (SELECT DISTINCT ON (call_history_id) call_history_id,
                  destination_dn_type ls_last_dest_type, destination_entity_type ls_last_dest_entity_type,
                  termination_reason_details ls_termination_reason_details
               FROM ${cdrSql} WHERE cdr_started_at >= ${START} AND cdr_started_at <= ${END}
               ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC),
        lh AS (SELECT DISTINCT ON (call_history_id) call_history_id,
                  cdr_answered_at lh_answered_at, cdr_started_at lh_started_at, cdr_ended_at lh_ended_at
               FROM ${cdrSql} WHERE cdr_started_at >= ${START} AND cdr_started_at <= ${END}
                 AND destination_dn_type IN (${Prisma.raw(SQL_REAL_PARTY_DEST_TYPES)})
                 AND COALESCE(destination_entity_type,'') != 'voicemail'
               ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC)
        SELECT COUNT(*) total,
               COUNT(*) FILTER (WHERE statut = 'answered') repondus,
               COUNT(*) FILTER (WHERE statut = 'voicemail') messagerie,
               COUNT(*) FILTER (WHERE statut IN ('missed','busy')) perdus
        FROM (SELECT ${Prisma.raw(buildFinalStatusCaseSQL())} AS statut
              FROM ca JOIN ls USING (call_history_id) LEFT JOIN lh USING (call_history_id)) v`);
    const l = logs[0];
    const paires: [string, number, number][] = [
        ["Total", Number(dash.total_calls), Number(l.total)],
        ["Répondus", Number(dash.answered_calls), Number(l.repondus)],
        ["Messagerie", Number(dash.voicemail_calls), Number(l.messagerie)],
        ["Perdus", Number(dash.missed_calls) + Number(dash.busy_calls), Number(l.perdus)],
    ];
    console.log("statut".padEnd(12), "tableau de bord".padStart(16), "journaux".padStart(10), "  verdict");
    for (const [nom, a, b] of paires) {
        if (a !== b) ko++;
        console.log(nom.padEnd(12), String(a).padStart(16), String(b).padStart(10), a === b ? "  ✓" : `  ✗ écart de ${a - b}`);
    }

    // ---- 2. Toggle Externe / Interne / Les deux -----------------------------
    // Le côté « tableau de bord » est le sens (la classe des requêtes
    // groupées) ; le côté « journaux » est le couple de filtres que pose un
    // lien de vignette. Les deux sortent des mêmes constructeurs du domaine.
    const exprs = { sourceTypeExpr: "fs.src", firstDestTypeExpr: "fs.fdst" };
    console.log("\ntoggle".padEnd(11), "tableau de bord".padStart(16), "journaux".padStart(10), "  verdict");
    for (const origin of ORIGINS) {
        const dashCond = buildSensFilterSQL(ORIGIN_SENS[origin], exprs) || "TRUE";
        const logsCond = [
            buildSensFilterSQL(ORIGIN_SENS[origin], exprs),
            buildProvenanceFilterSQL(origin, exprs.sourceTypeExpr),
        ].filter(Boolean).join(" AND ") || "TRUE";
        const res: Array<{ dash: bigint; journaux: bigint }> = await prisma.$queryRaw(Prisma.sql`
            WITH firsts AS (
                SELECT DISTINCT ON (call_history_id) call_history_id,
                       source_dn_type AS src, destination_dn_type AS fdst
                FROM ${cdrSql}
                WHERE cdr_started_at >= ${START} AND cdr_started_at <= ${END} ${exclusion}
                ORDER BY call_history_id, cdr_started_at ASC, cdr_id ASC
            )
            SELECT COUNT(*) FILTER (WHERE ${Prisma.raw(dashCond)}) AS dash,
                   COUNT(*) FILTER (WHERE ${Prisma.raw(logsCond)}) AS journaux
            FROM firsts fs`);
        const a = Number(res[0].dash);
        const b = Number(res[0].journaux);
        if (a !== b) ko++;
        console.log(origin.padEnd(11), String(a).padStart(16), String(b).padStart(10), a === b ? "  ✓" : `  ✗ écart de ${a - b}`);
    }

    console.log(ko === 0
        ? "\n=> Tableau de bord et journaux comptent identiquement.\n"
        : `\n=> ${ko} métrique(s) en écart : les définitions ont divergé.\n`);
    process.exit(ko === 0 ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(1); });
