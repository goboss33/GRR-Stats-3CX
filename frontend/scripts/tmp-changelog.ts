import { getQueueChangeLog } from "@/services/queue-changelog.service";
async function main() {
    const t0 = Date.now();
    const c = await getQueueChangeLog("gerofinance");
    console.log(`\n  ${c.length} changement(s) en ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
    const parType = new Map<string, number>();
    for (const x of c) parType.set(x.type, (parType.get(x.type) ?? 0) + 1);
    for (const [t, n] of parType) console.log(`    ${t.padEnd(12)} ${n}`);
    console.log(`\n  Les 12 plus récents :\n`);
    for (const x of c.slice(0, 12)) {
        const quoi = x.type === "renommage" ? `« ${x.avant} » → « ${x.apres} »`
            : x.type === "departement" ? `département ${x.avant ?? "aucun"} → ${x.apres ?? "aucun"}`
            : x.type === "statut" ? `${x.avant} → ${x.apres}${x.par ? ` (par ${x.par})` : ""}`
            : `apparition « ${x.apres} »`;
        console.log(`    ${x.date.slice(0, 10)}  [${x.source}]  file ${x.queueNumber.padEnd(4)} ${x.type.padEnd(11)} ${quoi}`);
    }
    console.log("");
    process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
