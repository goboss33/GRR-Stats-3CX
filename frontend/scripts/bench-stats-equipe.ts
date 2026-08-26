// Chronomètre les SIX sous-requêtes de l'écran « Statistiques d'équipe » —
// celles que getQueueStatistics rassemble aujourd'hui dans un unique
// Promise.all, donc celles que l'utilisateur attend TOUTES avant de voir quoi
// que ce soit. Objectif : savoir s'il faut découper l'écran en tranches ou
// optimiser une requête qui écrase les autres. Lecture seule.
//
// Usage : npx tsx scripts/bench-stats-equipe.ts [file=904] [période=2026-07] [origin=external]
//   période : un mois « 2026-07 », ou une plage « 2026-05..2026-07 » (bornes
//   incluses) pour mesurer comment le coût grandit avec la fenêtre.
//
// PROTOCOLE : une passe À FROID (première visite de cette file sur ce mois,
// caches de Postgres vides pour ces données), puis la même passe À CHAUD.
// L'écart entre les deux explique le « la première fois c'est long, ensuite
// ça va » — et c'est la première visite qu'il faut soigner.
//
// ⚠️ Le serveur Next doit tourner : les KPI et les collaborateurs passent par
// l'API interne en HTTP (fetchApi), pas par la base en direct. Mesurer sans
// serveur ne mesurerait pas ce que l'écran vit.
//
// NB : les deux requêtes de période précédente (getQueuePreviousStats /
// getQueuePreviousTimeline) ne sont pas mesurables ici — ce sont des actions
// serveur qui lisent les en-têtes de la requête HTTP pour résoudre le
// périmètre, et un script n'en a pas. Dans l'écran elles tournent en tâche de
// fond, sans bloquer l'affichage.
import { getQueueName, getQueueDepartment } from "@/services/repositories/cdr.repository";
import { getQueueTimelineData, getQueueHeatmapData } from "@/services/dashboard.service";
import type { CallOrigin } from "@/services/domain/call-classification";

const SERVER = "gerofinance" as const;
const QUEUE = process.argv[2] ?? "904";
const MONTH = process.argv[3] ?? "2026-07";
const ORIGIN = (process.argv[4] ?? "external") as CallOrigin;

const API_URL = process.env.INTERNAL_API_URL || "http://localhost:3000";
const API_KEY = process.env.INTERNAL_API_KEY || "";

// Décalage suisse approché (UTC+2 l'été, UTC+1 l'hiver) : une heure
// d'approximation n'a aucune incidence sur un chronométrage.
const offsetH = (mois: number) => (mois >= 4 && mois <= 10 ? 2 : 1);
const [PREMIER, DERNIER] = MONTH.includes("..") ? MONTH.split("..") : [MONTH, MONTH];
const [Y1, M1] = PREMIER.split("-").map(Number);
const [Y2, M2] = DERNIER.split("-").map(Number);
const START = new Date(Date.UTC(Y1, M1 - 1, 1) - offsetH(M1) * 3600_000);
const END = new Date(Date.UTC(Y2, M2, 1) - offsetH(M2) * 3600_000 - 1);
const JOURS = Math.round((END.getTime() - START.getTime()) / 86_400_000);

/** Reproduit fetchApi du service : même route, même clé, mêmes paramètres. */
async function callInternalApi(endpoint: string) {
    const url = new URL(`${API_URL}${endpoint}`);
    url.searchParams.set("server", SERVER);
    url.searchParams.set("queueNumber", QUEUE);
    url.searchParams.set("start", START.toISOString());
    url.searchParams.set("end", END.toISOString());
    url.searchParams.set("origin", ORIGIN);
    const res = await fetch(url.toString(), { headers: { "X-API-Key": API_KEY } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
    return res.json();
}

type Mesure = { nom: string; ms: number; ok: boolean; detail?: string };

/** Les six, dans l'ordre du Promise.all de getQueueStatistics. */
const SOUS_REQUETES: { nom: string; run: () => Promise<unknown> }[] = [
    { nom: "Nom du groupe", run: () => getQueueName(SERVER, QUEUE) },
    { nom: "Département", run: () => getQueueDepartment(SERVER, QUEUE) },
    { nom: "KPI (API interne)", run: () => callInternalApi("/api/analytics/queue") },
    { nom: "Collaborateurs (API interne)", run: () => callInternalApi("/api/analytics/agents") },
    { nom: "Courbe d'évolution", run: () => getQueueTimelineData(SERVER, QUEUE, START, END, ORIGIN) },
    { nom: "Carte des affluences", run: () => getQueueHeatmapData(SERVER, QUEUE, START, END, ORIGIN) },
];

async function passe(): Promise<Mesure[]> {
    const out: Mesure[] = [];
    for (const { nom, run } of SOUS_REQUETES) {
        const t0 = Date.now();
        try {
            await run();
            out.push({ nom, ms: Date.now() - t0, ok: true });
        } catch (e) {
            out.push({ nom, ms: Date.now() - t0, ok: false, detail: (e as Error).message.slice(0, 90) });
        }
    }
    return out;
}

const secondes = (ms: number) => `${(ms / 1000).toFixed(2)} s`.padStart(8);

function barre(ms: number, max: number) {
    const n = max > 0 ? Math.round((ms / max) * 40) : 0;
    return "█".repeat(Math.max(n, ms > 0 ? 1 : 0));
}

async function main() {
    console.log(`\n  Écran « Statistiques d'équipe » — file ${QUEUE}, ${MONTH}, provenance « ${ORIGIN} »`);
    console.log(`  ${START.toISOString()} → ${END.toISOString()}  (${JOURS} jours)`);
    if (!API_KEY) console.log("  ⚠️  INTERNAL_API_KEY absente : les deux mesures d'API vont échouer.");

    console.log(`\n  --- Passe 1 : à FROID ---\n`);
    const froid = await passe();
    const cumulFroid = froid.reduce((somme, m) => somme + m.ms, 0);
    const max = Math.max(...froid.map((m) => m.ms));
    for (const m of froid) {
        const part = cumulFroid > 0 ? `${Math.round((m.ms / cumulFroid) * 100)} %`.padStart(5) : "";
        console.log(`  ${m.nom.padEnd(30)}${secondes(m.ms)}${part}  ${barre(m.ms, max)}`
            + `${m.ok ? "" : `  ÉCHEC : ${m.detail}`}`);
    }
    console.log(`  ${"".padEnd(30)}${"—".repeat(8)}`);
    console.log(`  ${"cumulé".padEnd(30)}${secondes(cumulFroid)}\n`);

    console.log(`  --- Passe 2 : à CHAUD (mêmes requêtes, caches remplis) ---\n`);
    const chaud = await passe();
    const cumulChaud = chaud.reduce((somme, m) => somme + m.ms, 0);
    for (let i = 0; i < chaud.length; i++) {
        const avant = froid[i].ms;
        const gain = avant > 0 ? `${Math.round((1 - chaud[i].ms / avant) * 100)} %`.padStart(5) : "".padStart(5);
        console.log(`  ${chaud[i].nom.padEnd(30)}${secondes(chaud[i].ms)}`
            + `   froid ${secondes(avant).trim()} → ${gain} plus rapide`);
    }
    console.log(`  ${"".padEnd(30)}${"—".repeat(8)}`);
    console.log(`  ${"cumulé".padEnd(30)}${secondes(cumulChaud)}\n`);

    // L'écran lance les six EN PARALLÈLE : l'attente vaut la plus lente, pas
    // le cumul. Découper n'a donc de sens que si le temps est RÉPARTI.
    const plusLente = froid.reduce((a, b) => (a.ms > b.ms ? a : b));
    const part = cumulFroid > 0 ? plusLente.ms / cumulFroid : 0;
    const reste = cumulFroid - plusLente.ms;

    console.log(`  --- Verdict ---\n`);
    console.log(`  À froid, l'écran attend la plus lente : ${secondes(plusLente.ms).trim()} (« ${plusLente.nom} »).`);
    console.log(`  Tout le reste réuni : ${secondes(reste).trim()}.`);
    console.log(`  À chaud, la même visite coûte ${secondes(Math.max(...chaud.map((m) => m.ms))).trim()}.\n`);
    if (part >= 0.6) {
        console.log(`  « ${plusLente.nom} » pèse ${Math.round(part * 100)} % du temps.`);
        console.log(`  Livrer en tranches montrerait vite l'accessoire, mais on attendrait toujours`);
        console.log(`  ${secondes(plusLente.ms).trim()} le chiffre principal : optimiser CETTE requête d'abord.\n`);
    } else {
        console.log(`  Le temps est réparti (la plus lente pèse ${Math.round(part * 100)} %).`);
        console.log(`  Livrer en tranches ferait apparaître les premiers chiffres bien avant la fin.\n`);
    }

    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
