"use client";

import { AgentStats } from "@/types/statistics.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ArrowUpDown, Info } from "lucide-react";
import { useState, useMemo } from "react";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface AgentPerformanceTableV2Props {
    agents: AgentStats[];
    totalQueueCallsAnswered: number;
    totalQueueCallsReceived: number;
    totalDirectCallsAnswered: number;
    totalDirectCallsReceived: number;
}

type SortField = "name" | "queueAnswered" | "directAnswered" | "totalAnswered" | "totalHandlingTimeSeconds" | "avgHandlingTimeSeconds" | "participationRate";
type SortDirection = "asc" | "desc";

const columnTooltips: Record<string, string> = {
    name: "Nom de l'agent, extension, et jauge de charge visuelle (vert = file, bleu = directs)",
    queueAnswered: "Appels résolus via la file d'attente (résolveur final = dernier à décrocher) / appels où l'agent a été sollicité",
    directAnswered: "Appels directs répondus / appels directs reçus",
    totalAnswered: "Total appels répondus (file + directs) / total reçus",
    totalHandlingTimeSeconds: "Durée totale cumulée en conversation (file + directs)",
    avgHandlingTimeSeconds: "Durée moyenne de conversation par appel répondu (file + directs)",
    participationRate: "% de participation = (appels répondus de l'agent / appels répondus totaux de l'équipe) × 100",
};

function getParticipationColor(rate: number): string {
    if (rate >= 20) return "text-blue-700 bg-blue-50 border-blue-200";
    if (rate >= 10) return "text-slate-700 bg-slate-50 border-slate-200";
    return "text-slate-500 bg-slate-50 border-slate-200";
}

export function AgentPerformanceTableV2({
    agents,
    totalQueueCallsAnswered,
    totalQueueCallsReceived,
    totalDirectCallsAnswered,
    totalDirectCallsReceived,
}: AgentPerformanceTableV2Props) {
    const [sortField, setSortField] = useState<SortField>("participationRate");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

    // Total answered calls for participation rate
    const totalTeamAnswered = totalQueueCallsAnswered + totalDirectCallsAnswered;

    // Compute participation rates for all agents
    const agentsWithMetrics = useMemo(() => {
        return agents.map(agent => ({
            ...agent,
            participationRate: totalTeamAnswered > 0
                ? Math.round(((agent.answered + agent.directAnswered) / totalTeamAnswered) * 100)
                : 0,
            // Champs dérivés servant uniquement de clés de tri (cf. type SortField)
            queueAnswered: agent.answered,
            totalAnswered: agent.answered + agent.directAnswered,
        }));
    }, [agents, totalTeamAnswered]);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
        } else {
            setSortField(field);
            setSortDirection("desc");
        }
    };

    const sortedAgents = [...agentsWithMetrics].sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];

        if (typeof aVal === "string" && typeof bVal === "string") {
            return sortDirection === "asc"
                ? aVal.localeCompare(bVal)
                : bVal.localeCompare(aVal);
        }

        return sortDirection === "asc"
            ? (aVal as number) - (bVal as number)
            : (bVal as number) - (aVal as number);
    });

    const formatDuration = (seconds: number): string => {
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    };

    const formatDurationHMS = (seconds: number): string => {
        if (seconds < 60) return `${seconds}s`;
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        if (hours > 0) {
            return `${hours}h ${mins}m`;
        }
        const secs = seconds % 60;
        return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    };

    // Max total calls across all agents (for relative bar width)
    const maxTotalCalls = Math.max(
        ...agents.map(a => a.answered + a.directAnswered),
        1
    );

    // Compute totals
    // Note: direct totals use team-level deduplicated counts from props, not per-agent sums
    // This avoids double-counting calls transferred between agents
    const totals = agents.reduce(
        (acc, agent) => ({
            answered: acc.answered + agent.answered,
            directAnswered: acc.directAnswered + agent.directAnswered,
            directReceived: acc.directReceived + agent.directReceived,
            totalHandlingTimeSeconds: acc.totalHandlingTimeSeconds + agent.totalHandlingTimeSeconds,
        }),
        { answered: 0, directAnswered: 0, directReceived: 0, totalHandlingTimeSeconds: 0 }
    );
    const totalAvgHandling = (totals.answered + totalDirectCallsAnswered) > 0
        ? Math.round((totals.totalHandlingTimeSeconds) / (totals.answered + totalDirectCallsAnswered))
        : 0;

    // Workload bar component
    const WorkloadBar = ({ agent }: { agent: AgentStats }) => {
        const totalCalls = agent.answered + agent.directAnswered;
        const barWidth = maxTotalCalls > 0 ? (totalCalls / maxTotalCalls) * 100 : 0;
        const queuePct = totalCalls > 0 ? (agent.answered / totalCalls) * 100 : 0;
        const directPct = totalCalls > 0 ? (agent.directAnswered / totalCalls) * 100 : 0;

        return (
            <div className="mt-1.5 flex items-center gap-2">
                <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden" style={{ maxWidth: "120px" }}>
                    <div className="h-full flex" style={{ width: `${barWidth}%` }}>
                        <div
                            className="h-full bg-violet-500 transition-all"
                            style={{ width: `${queuePct}%` }}
                            title={`File: ${agent.answered}`}
                        />
                        <div
                            className="h-full bg-blue-500 transition-all"
                            style={{ width: `${directPct}%` }}
                            title={`Direct: ${agent.directAnswered}`}
                        />
                    </div>
                </div>
                <span className="text-[10px] text-slate-400 whitespace-nowrap">{totalCalls} appels</span>
            </div>
        );
    };

    const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
        <th
            className="px-3 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
            onClick={() => handleSort(field)}
        >
            <div className="flex items-center gap-1">
                {label}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Info className="h-3 w-3 text-slate-400 hover:text-slate-600 flex-shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                        {columnTooltips[field]}
                    </TooltipContent>
                </Tooltip>
                <ArrowUpDown className={`h-3 w-3 ${sortField === field ? "text-blue-600" : "text-slate-300"} flex-shrink-0`} />
            </div>
        </th>
    );

    if (agents.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-blue-600" />
                        Performance des Agents
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-center py-8 text-slate-500">
                        Aucune donnée agent disponible pour cette période
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <TooltipProvider>
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                            <Users className="h-5 w-5 text-blue-600" />
                            Performance des Agents
                            <span className="text-sm font-normal text-slate-500">
                                ({agents.length} agent{agents.length > 1 ? "s" : ""})
                            </span>
                        </CardTitle>
                        {/* Légende de la jauge */}
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                            <div className="flex items-center gap-1">
                                <div className="w-3 h-2.5 rounded-sm bg-violet-500" />
                                File
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-3 h-2.5 rounded-sm bg-blue-500" />
                                Directs
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-y">
                                <tr>
                                    <SortHeader field="name" label="Agent" />
                                    <SortHeader field="queueAnswered" label="File (résolu)" />
                                    <SortHeader field="directAnswered" label="Directs" />
                                    <SortHeader field="totalAnswered" label="Total" />
                                    <SortHeader field="totalHandlingTimeSeconds" label="Durée totale" />
                                    <SortHeader field="avgHandlingTimeSeconds" label="Durée moy." />
                                    <SortHeader field="participationRate" label="%" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {sortedAgents.map((agent, index) => (
                                    <tr key={`${agent.extension}-${agent.name}-${index}`} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-3 py-3">
                                            <div>
                                                <p className="font-medium text-slate-900">{agent.name}</p>
                                                <p className="text-xs text-slate-500">Ext. {agent.extension}</p>
                                                <WorkloadBar agent={agent} />
                                            </div>
                                        </td>
                                        <td className="px-3 py-3">
                                            <span className="font-semibold text-violet-700">{agent.answered}</span>
                                            <span className="text-slate-400 text-sm">/{agent.callsReceived}</span>
                                        </td>
                                        <td className="px-3 py-3">
                                            <span className="font-semibold text-blue-700">{agent.directAnswered}</span>
                                            <span className="text-slate-400 text-sm">/{agent.directReceived}</span>
                                        </td>
                                        <td className="px-3 py-3">
                                            <span className="font-semibold text-slate-900">{agent.answered + agent.directAnswered}</span>
                                            <span className="text-slate-400 text-sm">/{agent.callsReceived + agent.directReceived}</span>
                                        </td>
                                        <td className="px-3 py-3 text-slate-700">
                                            {formatDurationHMS(agent.totalHandlingTimeSeconds)}
                                        </td>
                                        <td className="px-3 py-3 text-slate-700">
                                            {formatDuration(agent.avgHandlingTimeSeconds)}
                                        </td>
                                        <td className="px-3 py-3">
                                            <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-sm font-bold border ${getParticipationColor(agent.participationRate)}`}>
                                                {agent.participationRate}%
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            {/* Ligne TOTAL */}
                            <tfoot className="bg-slate-100 border-t-2 border-slate-300">
                                <tr className="font-semibold">
                                    <td className="px-3 py-3 text-slate-800">TOTAL</td>
                                    <td className="px-3 py-3">
                                        <span className="text-violet-700">{totals.answered}</span>
                                        <span className="text-slate-400 text-sm">/{totalQueueCallsReceived}</span>
                                    </td>
                                    <td className="px-3 py-3">
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <span className="text-blue-700 cursor-help">
                                                    {totalDirectCallsAnswered}
                                                    <span className="text-slate-400 text-sm">/{totalDirectCallsReceived}</span>
                                                </span>
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="max-w-xs text-xs">
                                                Totaux dédupliqués au niveau équipe (un appel transféré entre agents compte une seule fois)
                                            </TooltipContent>
                                        </Tooltip>
                                    </td>
                                    <td className="px-3 py-3">
                                        <span className="text-slate-900">{totals.answered + totalDirectCallsAnswered}</span>
                                        <span className="text-slate-400 text-sm">/{totalQueueCallsReceived + totalDirectCallsReceived}</span>
                                    </td>
                                    <td className="px-3 py-3 text-slate-800">
                                        {formatDurationHMS(totals.totalHandlingTimeSeconds)}
                                    </td>
                                    <td className="px-3 py-3 text-slate-800">
                                        {formatDuration(totalAvgHandling)}
                                    </td>
                                    <td className="px-3 py-3 text-slate-400">—</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </TooltipProvider>
    );
}
