// GARDE-FOU D'ÉQUIVALENCE — la requête des collaborateurs, forme actuelle
// contre forme historique, sur des données réelles.
//
// Le 26 août 2026, deux tables intermédiaires jointes ont été supprimées de
// la chaîne des collaborateurs :
//
//   - « last_answered_agent » (file)    LEFT JOIN sur call_history_id
//   - « direct_last_answer »  (directs) LEFT JOIN sur call_history_id
//
// PostgreSQL n'a aucune statistique sur une table intermédiaire : il estimait
// UNE ligne là où il y en a des milliers, choisissait une boucle imbriquée et
// recalculait la table entière pour chaque ligne. Le plan affichait
// « Rows Removed by Join Filter: 45022756 ». Coût mesuré sur trois mois :
// 65 s pour le groupe 958, 141 s pour le 901.
//
// Les deux rangs se calculent désormais en un passage (ROW_NUMBER) dans la
// table qui porte déjà les lignes. Ce script reconstruit la forme historique
// à partir du SQL engendré aujourd'hui, exécute les deux, et compare les
// résultats colonne par colonne. Lecture seule.
//
// Usage : npx tsx scripts/proto-agents-sans-jointure.ts [file=958] [mois|plage=2026-07] [origin=external]
import { getPrismaCdr } from "@/lib/prisma-cdr";
import { getClassificationRules } from "@/lib/classification-rules";
import {
    buildTeamCTEChain,
    buildAgentCTEChain,
    buildDirectExclusionSQL,
    type CallOrigin,
} from "@/services/domain/call-classification";
import { resolveRosterForRules } from "@/services/xapi-journal.service";

const SERVER = "gerofinance" as const;
const QUEUE = process.argv[2] ?? "958";
const PERIODE = process.argv[3] ?? "2026-07";
const ORIGIN = (process.argv[4] ?? "external") as CallOrigin;

const offsetH = (m: number) => (m >= 4 && m <= 10 ? 2 : 1);
const [P1, P2] = PERIODE.includes("..") ? PERIODE.split("..") : [PERIODE, PERIODE];
const [Y1, M1] = P1.split("-").map(Number);
const [Y2, M2] = P2.split("-").map(Number);
const START = new Date(Date.UTC(Y1, M1 - 1, 1) - offsetH(M1) * 3600_000);
const END = new Date(Date.UTC(Y2, M2, 1) - offsetH(M2) * 3600_000 - 1);

const SELECTION = `
    SELECT
        ar.extension, ar.name,
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
    ORDER BY ar.extension, ar.name`;

/**
 * Reconstruit la forme HISTORIQUE (avec les deux jointures) à partir du SQL
 * engendré aujourd'hui. Chaque étape est assertée : si la chaîne évolue au
 * point que l'ancre disparaît, le script échoue au lieu de comparer deux
 * requêtes identiques et de conclure à tort à l'équivalence.
 */
function formeHistorique(sql: string, exclusionDirecte: string): string {
    let out = sql;
    const exigence = (condition: boolean, quoi: string) => {
        if (!condition) throw new Error(`ancre introuvable : ${quoi}`);
    };

    // --- File : le rang redevient une table intermédiaire jointe -----------
    const blocRang = /\n\s*-- Rang du décroché DANS l'appel[\s\S]*?\) AS rang_decroche,/;
    exigence(blocRang.test(out), "colonne rang_decroche");
    out = out.replace(blocRang, "");

    exigence(out.includes("    agent_queue_stats AS ("), "CTE agent_queue_stats");
    out = out.replace("    agent_queue_stats AS (", `    last_answered_agent AS (
        SELECT DISTINCT ON (call_history_id)
            call_history_id,
            agent_ext AS last_agent
        FROM queue_polling
        WHERE was_answered = 1
        ORDER BY call_history_id, cdr_answered_at DESC
    ),
    agent_queue_stats AS (`);

    exigence(out.includes("        FROM queue_polling qp\n        WHERE qp.agent_ext IN"), "FROM queue_polling");
    out = out.replace("        FROM queue_polling qp\n        WHERE qp.agent_ext IN",
        "        FROM queue_polling qp\n        LEFT JOIN last_answered_agent la ON qp.call_history_id = la.call_history_id\n        WHERE qp.agent_ext IN");

    for (const sort of ["answered", "handed_off"]) {
        const neuf = `qp.rang_decroche = 1 AND qp.was_answered = 1 AND qp.outcome = '${sort}'`;
        exigence(out.includes(neuf), `prédicat file « ${sort} »`);
        out = out.replace(neuf, `la.last_agent = qp.agent_ext AND qp.outcome = '${sort}'`);
    }

    // --- Directs : idem ----------------------------------------------------
    const blocDirect = /    direct_segments_ranked AS \([\s\S]*?\n    \),/;
    exigence(blocDirect.test(out), "CTE direct_segments_ranked");
    out = out.replace(blocDirect, `    direct_last_answer AS (
        SELECT DISTINCT ON (d.call_history_id)
            d.call_history_id,
            d.extension AS last_ext
        FROM team_direct_segments d
        WHERE ${exclusionDirecte}
          AND d.cdr_answered_at IS NOT NULL
        ORDER BY d.call_history_id, d.cdr_answered_at DESC, d.cdr_ended_at DESC
    ),`);

    exigence(out.includes("        FROM direct_segments_ranked d"), "FROM direct_segments_ranked");
    out = out.replace("        FROM direct_segments_ranked d", "        FROM team_direct_segments d");

    exigence(out.includes("        JOIN direct_calls dc ON dc.call_history_id = d.call_history_id\n        GROUP BY d.extension"), "JOIN direct_calls");
    out = out.replace("        JOIN direct_calls dc ON dc.call_history_id = d.call_history_id\n        GROUP BY d.extension",
        `        JOIN direct_calls dc ON dc.call_history_id = d.call_history_id
        LEFT JOIN direct_last_answer dla ON dla.call_history_id = d.call_history_id
        WHERE ${exclusionDirecte}
        GROUP BY d.extension`);

    for (const sort of ["answered", "handed_off"]) {
        const neuf = `d.rang_direct = 1 AND d.cdr_answered_at IS NOT NULL AND dc.outcome = '${sort}'`;
        exigence(out.includes(neuf), `prédicat direct « ${sort} »`);
        out = out.replace(neuf, `dla.last_ext = d.extension AND dc.outcome = '${sort}'`);
    }

    return out;
}

type Ligne = Record<string, unknown>;

/** Comparaison stricte, colonne par colonne (BigInt et dates normalisés). */
function comparer(a: Ligne[], b: Ligne[]): string[] {
    const ecarts: string[] = [];
    if (a.length !== b.length) ecarts.push(`nombre de lignes : ${a.length} vs ${b.length}`);
    const norm = (v: unknown) => (typeof v === "bigint" ? Number(v) : v instanceof Date ? v.toISOString() : v);
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        for (const cle of Object.keys(a[i])) {
            const x = norm(a[i][cle]), y = norm(b[i][cle]);
            if (String(x) !== String(y)) ecarts.push(`ligne ${i + 1} (${a[i].extension}) · ${cle} : ${x} vs ${y}`);
        }
    }
    return ecarts;
}

async function main() {
    const prisma = getPrismaCdr(SERVER);
    const rules = await getClassificationRules();
    if (rules.agentCredit !== "lastAnswer") {
        console.log(`\n  Règle de crédit « ${rules.agentCredit} » : aucune jointure de ce type n'est engendrée, rien à comparer.\n`);
        process.exit(0);
    }
    const rosterMembers = await resolveRosterForRules(rules, SERVER, QUEUE, START, END);
    const socle = buildTeamCTEChain(rules, { queueExpr: "$1", startExpr: "$2", endExpr: "$3", origin: ORIGIN, rosterMembers });
    const chaine = buildAgentCTEChain(rules);

    const actuelle = `WITH ${socle},\n${chaine}\n${SELECTION}`;
    const historique = `WITH ${socle},\n${formeHistorique(chaine, buildDirectExclusionSQL(rules, "d"))}\n${SELECTION}`;

    console.log(`\n  Équivalence — file ${QUEUE}, ${PERIODE}, provenance « ${ORIGIN} »`);
    console.log(`  ${START.toISOString()} → ${END.toISOString()}\n`);

    const chrono = async (sql: string) => {
        const t0 = Date.now();
        const rows = await prisma.$queryRawUnsafe<Ligne[]>(sql, QUEUE, START, END);
        return { ms: Date.now() - t0, rows };
    };

    const neuf = await chrono(actuelle);
    console.log(`  forme ACTUELLE     ${`${(neuf.ms / 1000).toFixed(2)} s`.padStart(9)}   ${neuf.rows.length} collaborateurs`);
    const vieux = await chrono(historique);
    console.log(`  forme HISTORIQUE   ${`${(vieux.ms / 1000).toFixed(2)} s`.padStart(9)}   ${vieux.rows.length} collaborateurs`);
    console.log(`\n  → ${(vieux.ms / Math.max(neuf.ms, 1)).toFixed(1)} fois plus rapide (${((vieux.ms - neuf.ms) / 1000).toFixed(2)} s de moins)\n`);

    const ecarts = comparer(vieux.rows, neuf.rows);
    if (ecarts.length === 0) {
        console.log(`  ✔ CHIFFRES IDENTIQUES sur les ${neuf.rows.length} lignes et toutes leurs colonnes.\n`);
    } else {
        console.log(`  ✘ ${ecarts.length} écart(s) — la forme actuelle CHANGE les chiffres :`);
        for (const e of ecarts.slice(0, 20)) console.log(`      ${e}`);
        console.log("");
    }

    process.exit(ecarts.length === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(String(e).slice(0, 600));
    process.exit(1);
});
