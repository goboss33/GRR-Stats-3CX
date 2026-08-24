// Smoke SQL : exécute TOUTES les requêtes du dashboard / des files contre la base,
// pour attraper les erreurs de composition SQL que ni le typecheck ni le build ne
// voient (ex. fragment Prisma.sql lié comme valeur -> "syntax error at or near $3").
//
// Usage : DATABASE_URL_GEROFINANCE=... npx tsx scripts/smoke-sql.ts
import {
    getTimelineData,
    getHeatmapData,
    getQueueTimelineData,
    getQueueHeatmapData,
    getConcurrentCallsChartData,
} from "@/services/dashboard.service";
import {
    getQueueMembersRaw,
    getQueueName,
    getCallSegments,
} from "@/services/repositories/cdr.repository";
import { getPrismaCdr } from "@/lib/prisma-cdr";

const SERVER = "gerofinance" as const;
const END = new Date();
const START = new Date(END.getTime() - 7 * 24 * 60 * 60 * 1000);

let failures = 0;

async function check(label: string, fn: () => Promise<unknown>) {
    try {
        const res = await fn();
        const n = Array.isArray(res) ? `${res.length} lignes` : "ok";
        console.log(`  ✅ ${label} — ${n}`);
    } catch (e) {
        failures++;
        console.log(`  ❌ ${label} — ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
}

async function main() {
    const prisma = getPrismaCdr(SERVER);

    // Une file et un appel réels pour les tests paramétrés.
    const q = await prisma.$queryRaw<{ n: string }[]>`
        SELECT destination_dn_number AS n FROM cdroutput
        WHERE destination_dn_type = 'queue' GROUP BY destination_dn_number
        ORDER BY COUNT(*) DESC LIMIT 1`;
    const queue = q[0]?.n ?? "993";
    const c = await prisma.$queryRaw<{ id: string }[]>`
        SELECT call_history_id AS id FROM cdroutput
        WHERE call_history_id IS NOT NULL LIMIT 1`;
    const callId = c[0]?.id ?? "";

    console.log(`\nPériode : ${START.toISOString().slice(0, 10)} -> ${END.toISOString().slice(0, 10)} | file ${queue}\n`);

    console.log("Dashboard :");
    await check("getTimelineData (global)", () => getTimelineData(SERVER, START, END));
    await check("getHeatmapData (global)", () => getHeatmapData(SERVER, START, END));
    await check("getConcurrentCallsChartData", () => getConcurrentCallsChartData(SERVER, START, END));

    console.log("\nStatistiques de file :");
    await check("getQueueTimelineData", () => getQueueTimelineData(SERVER, queue, START, END));
    await check("getQueueHeatmapData", () => getQueueHeatmapData(SERVER, queue, START, END));
    await check("getQueueName", () => getQueueName(SERVER, queue));
    await check("getQueueMembersRaw", () => getQueueMembersRaw(SERVER));

    console.log("\nLogs :");
    await check("getCallSegments (chaîne d'appel)", () => getCallSegments(SERVER, callId));

    console.log(`\n${failures === 0 ? "✅ TOUT PASSE" : `❌ ${failures} ECHEC(S)`}\n`);
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ECHEC GLOBAL:", e); process.exit(1); });
