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
}

type SortField = "name" | "callsReceived" | "attempts" | "answered" | "transferred" | "answerRate" | "availabilityRate" | "avgHandlingTimeSeconds" | "totalHandlingTimeSeconds";
type SortDirection = "asc" | "desc";

// Tooltips for each column header
const columnTooltips: Record<string, string> = {
    name: "Nom de l'agent et numéro d'extension",
    callsReceived: "Nombre d'appels uniques de la queue pour lesquels le téléphone de l'agent a sonné",
    attempts: "Nombre total de sollicitations (sonneries). Un même appel peut faire sonner un agent plusieurs fois si re-polled",
    answered: "Nombre d'appels de la queue auxquels l'agent a effectivement répondu",
    transferred: "Appels répondus par l'agent puis transférés activement vers un autre agent ou une autre queue",
    answerRate: "Taux de réponse : Répondus / Appels reçus. Indique l'efficacité de l'agent à décrocher quand sollicité",
    availabilityRate: "Taux de disponibilité : Appels reçus / Total appels queue. Indique pour quel pourcentage des appels l'agent était disponible (pas en ligne, pas en pause)",
    avgHandlingTimeSeconds: "Durée moyenne de conversation par appel répondu",
    totalHandlingTimeSeconds: "Durée totale cumulée passée en conversation sur la période",
};

export function AgentPerformanceTable({ agents }: AgentPerformanceTableProps) {
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
        if (rate >= 80) return "text-emerald-600 bg-emerald-50";
        if (rate >= 60) return "text-amber-600 bg-amber-50";
        return "text-red-600 bg-red-50";
    };

    const getAvailabilityColor = (rate: number): string => {
        if (rate >= 60) return "text-blue-600 bg-blue-50";
        if (rate >= 30) return "text-slate-600 bg-slate-50";
        return "text-slate-400 bg-slate-50";
    };

    // Compute totals
    const totals = agents.reduce(
        (acc, agent) => ({
            callsReceived: acc.callsReceived + agent.callsReceived,
            attempts: acc.attempts + agent.attempts,
            answered: acc.answered + agent.answered,
            transferred: acc.transferred + agent.transferred,
            totalHandlingTimeSeconds: acc.totalHandlingTimeSeconds + agent.totalHandlingTimeSeconds,
        }),
        { callsReceived: 0, attempts: 0, answered: 0, transferred: 0, totalHandlingTimeSeconds: 0 }
    );
    const totalAnswerRate = totals.callsReceived > 0 ? Math.round((totals.answered / totals.callsReceived) * 100) : 0;
    const totalAvgHandling = totals.answered > 0 ? Math.round(totals.totalHandlingTimeSeconds / totals.answered) : 0;

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
                    <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-blue-600" />
                        Performance des Agents
                        <span className="text-sm font-normal text-slate-500">
                            ({agents.length} agent{agents.length > 1 ? "s" : ""})
                        </span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-y">
                                <tr>
                                    <SortHeader field="name" label="Agent" />
                                    <SortHeader field="callsReceived" label="Appels reçus" />
                                    <SortHeader field="attempts" label="Sollicitations" />
                                    <SortHeader field="answered" label="Répondus" />
                                    <SortHeader field="transferred" label="Transférés" />
                                    <SortHeader field="answerRate" label="Taux rép." />
                                    <SortHeader field="availabilityRate" label="Taux dispo." />
                                    <SortHeader field="avgHandlingTimeSeconds" label="Durée moy." />
                                    <SortHeader field="totalHandlingTimeSeconds" label="Durée totale" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {sortedAgents.map((agent, index) => (
                                    <tr key={`${agent.extension}-${agent.name}-${index}`} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-3 py-3">
                                            <div>
                                                <p className="font-medium text-slate-900">{agent.name}</p>
                                                <p className="text-xs text-slate-500">Ext. {agent.extension}</p>
                                            </div>
                                        </td>
                                        <td className="px-3 py-3 text-slate-700">{agent.callsReceived}</td>
                                        <td className="px-3 py-3 text-slate-500 text-sm">{agent.attempts}</td>
                                        <td className="px-3 py-3 font-semibold text-slate-900">{agent.answered}</td>
                                        <td className="px-3 py-3">
                                            {agent.transferred > 0 ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700">
                                                    {agent.transferred}
                                                </span>
                                            ) : (
                                                <span className="text-slate-400">0</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-3">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getAnswerRateColor(agent.answerRate)}`}>
                                                {agent.answerRate}%
                                            </span>
                                        </td>
                                        <td className="px-3 py-3">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getAvailabilityColor(agent.availabilityRate)}`}>
                                                {agent.availabilityRate}%
                                            </span>
                                        </td>
                                        <td className="px-3 py-3 text-slate-700">
                                            {formatDuration(agent.avgHandlingTimeSeconds)}
                                        </td>
                                        <td className="px-3 py-3 text-slate-700">
                                            {formatDurationHMS(agent.totalHandlingTimeSeconds)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            {/* Ligne TOTAL */}
                            <tfoot className="bg-slate-100 border-t-2 border-slate-300">
                                <tr className="font-semibold">
                                    <td className="px-3 py-3 text-slate-800">TOTAL</td>
                                    <td className="px-3 py-3 text-slate-800">{totals.callsReceived}</td>
                                    <td className="px-3 py-3 text-slate-600 text-sm">{totals.attempts}</td>
                                    <td className="px-3 py-3 text-slate-900">{totals.answered}</td>
                                    <td className="px-3 py-3 text-slate-800">{totals.transferred}</td>
                                    <td className="px-3 py-3">
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getAnswerRateColor(totalAnswerRate)}`}>
                                            {totalAnswerRate}%
                                        </span>
                                    </td>
                                    <td className="px-3 py-3 text-slate-400">—</td>
                                    <td className="px-3 py-3 text-slate-800">
                                        {formatDuration(totalAvgHandling)}
                                    </td>
                                    <td className="px-3 py-3 text-slate-800">
                                        {formatDurationHMS(totals.totalHandlingTimeSeconds)}
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
