// Chronomètre chacune des requêtes du tableau de bord, pour savoir où va le
// temps avant d'optimiser quoi que ce soit. Lecture seule.
import {
    getGlobalMetricsRaw,
    getTimelineDataRaw,
    getHeatmapDataRaw,
    getConcurrentCallsData,
} from "@/services/repositories/cdr.repository";

const START = new Date(process.argv[2] ?? "2026-01-01T00:00:00.000Z");
const END = new Date(process.argv[3] ?? "2026-08-01T00:00:00.000Z");

async function chrono(nom: string, fn: () => Promise<unknown>) {
    const t0 = Date.now();
    try {
        await fn();
        console.log(`  ${nom.padEnd(26)} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    } catch (e) {
        console.log(`  ${nom.padEnd(26)} ÉCHEC : ${(e as Error).message.slice(0, 60)}`);
    }
    return Date.now() - t0;
}

async function main() {
    console.log(`\nTableau de bord — ${START.toISOString().slice(0, 10)} → ${END.toISOString().slice(0, 10)}\n`);
    let total = 0;
    total += await chrono("Métriques (vignettes)", () => getGlobalMetricsRaw("gerofinance", START, END));
    total += await chrono("Courbe de volume", () => getTimelineDataRaw("gerofinance", START, END));
    total += await chrono("Carte des affluences", () => getHeatmapDataRaw("gerofinance", START, END));
    total += await chrono("Appels simultanés", () => getConcurrentCallsData("gerofinance", START, END));
    console.log(`\n  ${"cumulé (séquentiel)".padEnd(26)} ${(total / 1000).toFixed(1)} s\n`);
    // Les quatre requêtes lancées ensemble : ce que coûterait UNE action serveur
    // qui les parallélise côté serveur, au lieu de quatre actions que Next.js
    // exécute l'une après l'autre.
    const t0 = Date.now();
    await Promise.all([
        getGlobalMetricsRaw("gerofinance", START, END),
        getTimelineDataRaw("gerofinance", START, END),
        getHeatmapDataRaw("gerofinance", START, END),
        getConcurrentCallsData("gerofinance", START, END),
    ]);
    console.log(`  ${"en parallèle".padEnd(26)} ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);

    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
