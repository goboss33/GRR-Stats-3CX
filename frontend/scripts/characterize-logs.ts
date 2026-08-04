// Caractérisation E2/B9 : fige les résultats de la vraie requête "logs agrégés"
// sur de nombreux scénarios (filtres + tri + recherches + créneaux), pour garantir
// zéro régression après refactor du SQL (paramétrisation).
//
// Rapide : une seule page par scénario (totalCount = requête de comptage complète ;
// checksum de la 1re page = requête de données). Toute déviation avant/après se voit.
import crypto from "node:crypto";
import { getAggregatedCallLogs } from "@/services/logs.service";
import type { LogsFilters, LogsSort } from "@/services/domain/call.types";

// Journée passée et complète => résultat stable.
const START = new Date("2026-07-10T00:00:00.000Z");
const END = new Date("2026-07-11T00:00:00.000Z");

const base = (): LogsFilters => ({ sens: [], statuses: [], entityTypes: [] });
const byStarted: LogsSort = { field: "startedAt", direction: "desc" };

const scenarios: { label: string; filters: LogsFilters; sort: LogsSort }[] = [
    { label: "plain", filters: base(), sort: byStarted },
    { label: "status=answered", filters: { ...base(), statuses: ["answered"] }, sort: byStarted },
    { label: "sens=inbound", filters: { ...base(), sens: ["inbound"] }, sort: byStarted },
    { label: "durationMin=60", filters: { ...base(), durationMin: 60 }, sort: byStarted },
    { label: "sort=duration", filters: base(), sort: { field: "duration", direction: "desc" } },
    { label: "callerSearch=*100*", filters: { ...base(), callerSearch: "*100*" }, sort: byStarted },
    { label: "calleeSearch=*20*", filters: { ...base(), calleeSearch: "*20*" }, sort: byStarted },
    { label: "idSearch=*5*", filters: { ...base(), idSearch: "*5*" }, sort: byStarted },
    { label: "handledBySearch=106", filters: { ...base(), handledBySearch: "106" }, sort: byStarted },
    { label: "queueSearch=958", filters: { ...base(), queueSearch: "958" }, sort: byStarted },
    { label: "timeSlot=09-12", filters: { ...base(), timeSlots: [{ start: "09:00", end: "12:00" }] }, sort: byStarted },
];

async function main() {
    const results = [];
    for (const s of scenarios) {
        const { logs, totalCount } = await getAggregatedCallLogs("gerofinance", START, END, s.filters, { page: 1, pageSize: 100 }, s.sort);
        const sorted = [...logs].sort((a, b) => a.callHistoryId.localeCompare(b.callHistoryId));
        const checksum = crypto.createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 16);
        results.push({ label: s.label, totalCount, page1Rows: logs.length, page1Checksum: checksum });
    }
    console.log(JSON.stringify({ window: { start: START.toISOString(), end: END.toISOString() }, results }, null, 2));
}

main().catch((e) => {
    console.error("ECHEC:", e);
    process.exit(1);
});
