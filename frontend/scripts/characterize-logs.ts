// Caractérisation E2 : fige les résultats de la vraie requête "logs agrégés" de
// l'app sur plusieurs scénarios (filtres + tri), pour garantir zéro régression
// après refactor du SQL (notamment la requête de comptage).
import crypto from "node:crypto";
import { getAggregatedCallLogs } from "@/services/logs.service";
import type { AggregatedCallLog, LogsFilters, LogsSort } from "@/services/domain/call.types";

// Journée passée et complète => résultat stable.
const START = new Date("2026-07-10T00:00:00.000Z");
const END = new Date("2026-07-11T00:00:00.000Z");

const emptyFilters = (): LogsFilters => ({ directions: [], statuses: [], entityTypes: [] });

const scenarios: { label: string; filters: LogsFilters; sort: LogsSort }[] = [
    { label: "plain", filters: emptyFilters(), sort: { field: "startedAt", direction: "desc" } },
    { label: "status=answered", filters: { ...emptyFilters(), statuses: ["answered"] }, sort: { field: "startedAt", direction: "desc" } },
    { label: "direction=inbound", filters: { ...emptyFilters(), directions: ["inbound"] }, sort: { field: "startedAt", direction: "desc" } },
    { label: "durationMin=60", filters: { ...emptyFilters(), durationMin: 60 }, sort: { field: "startedAt", direction: "desc" } },
    { label: "sort=duration-desc", filters: emptyFilters(), sort: { field: "duration", direction: "desc" } },
];

async function fetchAll(filters: LogsFilters, sort: LogsSort): Promise<{ logs: AggregatedCallLog[]; totalCount: number }> {
    const logs: AggregatedCallLog[] = [];
    let totalCount = 0;
    for (let page = 1; page <= 10000; page++) {
        const res = await getAggregatedCallLogs("gerofinance", START, END, filters, { page, pageSize: 100 }, sort);
        totalCount = res.totalCount;
        logs.push(...res.logs);
        if (res.logs.length < 100 || logs.length >= totalCount) break;
    }
    return { logs, totalCount };
}

async function main() {
    const results = [];
    for (const s of scenarios) {
        const { logs, totalCount } = await fetchAll(s.filters, s.sort);
        const sorted = [...logs].sort((a, b) => a.callHistoryId.localeCompare(b.callHistoryId));
        const checksum = crypto.createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
        results.push({ label: s.label, totalCount, rowsFetched: logs.length, checksum });
    }
    console.log(JSON.stringify({ window: { start: START.toISOString(), end: END.toISOString() }, results }, null, 2));
}

main().catch((e) => {
    console.error("ECHEC:", e);
    process.exit(1);
});
