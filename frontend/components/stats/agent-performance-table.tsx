"use client";

import { AgentStats } from "@/types/statistics.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ArrowUpDown, Info } from "lucide-react";
import { useState } from "react";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface AgentPerformanceTableProps {
    agents: AgentStats[];
    totalQueueCalls: number;
}

type SortField = "name" | "answered" | "directAnswered" | "answerRate" | "transferred" | "totalHandlingTimeSeconds" | "avgHandlingTimeSeconds";
type SortDirection = "asc" | "desc";

const columnTooltips: Record<string, string> = {
    name: "Nom de l'agent, extension, et jauge de charge visuelle (vert = queue, bleu = directs)",
    answered: "Appels répondus via la queue / total d'appels entrés dans la queue",
    directAnswered: "Appels directs répondus / appels directs reçus par l'agent",
    answerRate: "Taux de réponse global : (répondus queue + répondus directs) / (reçus queue + reçus directs)",
    transferred: "Appels répondus puis transférés vers quelqu'un en dehors de cette queue",
    totalHandlingTimeSeconds: "Durée totale cumulée en conversation (queue + directs)",
    avgHandlingTimeSeconds: "Durée moyenne de conversation par appel répondu (queue + directs)",
};

export function AgentPerformanceTable({ agents, totalQueueCalls }: AgentPerformanceTableProps) {
    const [sortField, setSortField] = useState<SortField>("answered");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
        } else {
            setSortField(field);
            setSortDirection("desc");
        }
    };

    const sortedAgents = [...agents].sort((a, b) => {
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
        const secs = seconds % 60;
        if (hours > 0) {
            return `${hours}h ${mins}m`;
        }
        return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    };

    const getAnswerRateColor = (rate: number): string => {
        if (rate >= 70) return "text-emerald-600 bg-emerald-50";
        if (rate >= 40) return "text-amber-600 bg-amber-50";
        return "text-red-600 bg-red-50";
    };

    // Max total calls across all agents (for relative bar width)
    const maxTotalCalls = Math.max(
        ...agents.map(a => a.answered + a.directAnswered),
        1 // avoid division by 0
    );

    // Compute totals
    const totals = agents.reduce(
        (acc, agent) => ({
            answered: acc.answered + agent.answered,
            directAnswered: acc.directAnswered + agent.directAnswered,
            directReceived: acc.directReceived + agent.directReceived,
            transferred: acc.transferred + agent.transferred,
            totalHandlingTimeSeconds: acc.totalHandlingTimeSeconds + agent.totalHandlingTimeSeconds,
            callsReceived: acc.callsReceived + agent.callsReceived,
        }),
        { answered: 0, directAnswered: 0, directReceived: 0, transferred: 0, totalHandlingTimeSeconds: 0, callsReceived: 0 }
    );
    const totalGlobalRate = (totals.callsReceived + totals.directReceived) > 0
        ? Math.round(((totals.answered + totals.directAnswered) / (totals.callsReceived + totals.directReceived)) * 100)
        : 0;
    const totalAvgHandling = (totals.answered + totals.directAnswered) > 0
        ? Math.round(totals.totalHandlingTimeSeconds / (totals.answered + totals.directAnswered))
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
                            className="h-full bg-emerald-500 transition-all"
                            style={{ width: `${queuePct}%` }}
                            title={`Queue: ${agent.answered}`}
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
                                <div className="w-3 h-2.5 rounded-sm bg-emerald-500" />
                                Queue
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
                                    <SortHeader field="answered" label="Queue" />
                                    <SortHeader field="directAnswered" label="Directs" />
                                    <SortHeader field="answerRate" label="Taux rép." />
                                    <SortHeader field="transferred" label="Transférés" />
                                    <SortHeader field="totalHandlingTimeSeconds" label="Durée totale" />
                                    <SortHeader field="avgHandlingTimeSeconds" label="Durée moy." />
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
                                            <span className="font-semibold text-emerald-700">{agent.answered}</span>
                                            <span className="text-slate-400 text-sm">/{totalQueueCalls}</span>
                                        </td>
                                        <td className="px-3 py-3">
                                            <span className="font-semibold text-blue-700">{agent.directAnswered}</span>
                                            <span className="text-slate-400 text-sm">/{agent.directReceived}</span>
                                        </td>
                                        <td className="px-3 py-3">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getAnswerRateColor(agent.answerRate)}`}>
                                                {agent.answerRate}%
                                            </span>
                                        </td>
                                        <td className="px-3 py-3">
                                            {agent.transferred > 0 ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700">
                                                    {agent.transferred}
                                                </span>
                                            ) : (
                                                <span className="text-slate-400">0</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-3 text-slate-700">
                                            {formatDurationHMS(agent.totalHandlingTimeSeconds)}
                                        </td>
                                        <td className="px-3 py-3 text-slate-700">
                                            {formatDuration(agent.avgHandlingTimeSeconds)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            {/* Ligne TOTAL */}
                            <tfoot className="bg-slate-100 border-t-2 border-slate-300">
                                <tr className="font-semibold">
                                    <td className="px-3 py-3 text-slate-800">TOTAL</td>
                                    <td className="px-3 py-3">
                                        <span className="text-emerald-700">{totals.answered}</span>
                                        <span className="text-slate-400 text-sm">/{totalQueueCalls}</span>
                                    </td>
                                    <td className="px-3 py-3">
                                        <span className="text-blue-700">{totals.directAnswered}</span>
                                        <span className="text-slate-400 text-sm">/{totals.directReceived}</span>
                                    </td>
                                    <td className="px-3 py-3">
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getAnswerRateColor(totalGlobalRate)}`}>
                                            {totalGlobalRate}%
                                        </span>
                                    </td>
                                    <td className="px-3 py-3 text-slate-800">{totals.transferred}</td>
                                    <td className="px-3 py-3 text-slate-800">
                                        {formatDurationHMS(totals.totalHandlingTimeSeconds)}
                                    </td>
                                    <td className="px-3 py-3 text-slate-800">
                                        {formatDuration(totalAvgHandling)}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </TooltipProvider>
    );
}
