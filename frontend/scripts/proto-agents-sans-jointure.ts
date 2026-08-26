// PROTOTYPE (aucun code de production touché) : mesure le gain d'une réécriture
// de la requête des collaborateurs, et PROUVE qu'elle rend les mêmes chiffres.
//
// Le défaut, lu dans le plan d'exécution (cf. scripts/explain-agents.ts) :
//
//     Nested Loop Left Join ... (actual time=230..19435 rows=16478)
//         Join Filter: (qp.call_history_id = queue_polling.call_history_id)
//         Rows Removed by Join Filter: 45022756
//
// `last_answered_agent` est un CTE rejoint à `queue_polling`. Postgres n'a
// aucune statistique sur un CTE : il estime « 1 ligne » là où il y en a 16 478,
// choisit une boucle imbriquée, et recalcule le CTE pour CHAQUE ligne — d'où
// 45 millions de comparaisons.
//
// La réécriture supprime la jointure : le rang du décroché se calcule en un
// seul passage, dans queue_polling, par fonction de fenêtrage. Le tri par
// cdr_id rend même le départage des ex æquo déterministe, ce que le
// DISTINCT ON d'origine ne garantissait pas.
//
// Usage : npx tsx scripts/proto-agents-sans-jointure.ts [file=958] [mois|plage=2026-07]
import { getPrismaCdr } from "@/lib/prisma-cdr";
import { getClassificationRules } from "@/lib/classification-rules";
import { buildTeamCTEChain, buildAgentCTEChain, type CallOrigin } from "@/services/domain/call-classification";
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

/** Applique la réécriture au SQL engendré, sans toucher au constructeur. */
function reecrire(sql: string): string {
    let out = sql;

    // 1) queue_polling calcule lui-même le rang du décroché dans l'appel.
    const ancre = `            p.cdr_answered_at,
            qc.outcome`;
    if (!out.includes(ancre)) throw new Error("ancre queue_polling introuvable");
    out = out.replace(ancre, `            p.cdr_answered_at,
            ROW_NUMBER() OVER (
                PARTITION BY p.call_history_id
                ORDER BY (p.cdr_answered_at IS NULL), p.cdr_answered_at DESC, p.cdr_id
            ) AS rang_decroche,
            qc.outcome`);

    // 2) « c'est lui le dernier décrocheur » se lit sur la ligne, sans jointure.
    const avantResolu = `la.last_agent = qp.agent_ext AND qp.outcome = 'answered'`;
    const avantTransfere = `la.last_agent = qp.agent_ext AND qp.outcome = 'handed_off'`;
    if (!out.includes(avantResolu) || !out.includes(avantTransfere)) {
        throw new Error("la règle de crédit n'est pas « dernier décrocheur » : rien à réécrire");
    }
    out = out.replace(avantResolu, `qp.rang_decroche = 1 AND qp.was_answered = 1 AND qp.outcome = 'answered'`);
    out = out.replace(avantTransfere, `qp.rang_decroche = 1 AND qp.was_answered = 1 AND qp.outcome = 'handed_off'`);

    // 3) La jointure coupable disparaît.
    const jointure = `        LEFT JOIN last_answered_agent la ON qp.call_history_id = la.call_history_id\n`;
    if (!out.includes(jointure)) throw new Error("jointure last_answered_agent introuvable");
    out = out.replace(jointure, "");

    return out;
}

type Ligne = Record<string, unknown>;

async function chrono(prisma: ReturnType<typeof getPrismaCdr>, sql: string) {
    const t0 = Date.now();
    const rows = await prisma.$queryRawUnsafe<Ligne[]>(sql, QUEUE, START, END);
    return { ms: Date.now() - t0, rows };
}

/** Comparaison stricte, colonne par colonne (les BigInt sont normalisés). */
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
    const rosterMembers = await resolveRosterForRules(rules, SERVER, QUEUE, START, END);
    const socle = buildTeamCTEChain(rules, { queueExpr: "$1", startExpr: "$2", endExpr: "$3", origin: ORIGIN, rosterMembers });
    const chaine = buildAgentCTEChain(rules);

    const actuel = `WITH ${socle},\n${chaine}\n${SELECTION}`;
    const propose = `WITH ${socle},\n${reecrire(chaine)}\n${SELECTION}`;

    console.log(`\n  Prototype — file ${QUEUE}, ${PERIODE}, provenance « ${ORIGIN} »`);
    console.log(`  ${START.toISOString()} → ${END.toISOString()}\n`);

    const a = await chrono(prisma, actuel);
    console.log(`  requête ACTUELLE   ${`${(a.ms / 1000).toFixed(2)} s`.padStart(9)}   ${a.rows.length} collaborateurs`);
    const b = await chrono(prisma, propose);
    console.log(`  requête RÉÉCRITE   ${`${(b.ms / 1000).toFixed(2)} s`.padStart(9)}   ${b.rows.length} collaborateurs`);

    const gain = a.ms > 0 ? (a.ms / Math.max(b.ms, 1)) : 0;
    console.log(`\n  → ${gain.toFixed(1)} fois plus rapide (${((a.ms - b.ms) / 1000).toFixed(2)} s de moins)\n`);

    const ecarts = comparer(a.rows, b.rows);
    if (ecarts.length === 0) {
        console.log(`  ✔ CHIFFRES IDENTIQUES sur les ${a.rows.length} lignes et toutes leurs colonnes.\n`);
    } else {
        console.log(`  ✘ ${ecarts.length} écart(s) — la réécriture CHANGE les chiffres :`);
        for (const e of ecarts.slice(0, 20)) console.log(`      ${e}`);
        console.log("");
    }

    process.exit(ecarts.length === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(String(e).slice(0, 600));
    process.exit(1);
});
