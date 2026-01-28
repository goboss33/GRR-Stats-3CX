"use client";

import { AgentStats } from "@/types/statistics.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ArrowUpDown } from "lucide-react";
import { useState } from "react";

interface AgentPerformanceTableProps {
    agents: AgentStats[];
}

type SortField = "name" | "callsFromQueue" | "callsDirect" | "callsIntercepted" | "totalAnswered" | "answerRate" | "avgHandlingTimeSeconds";
type SortDirection = "asc" | "desc";

export function AgentPerformanceTable({ agents }: AgentPerformanceTableProps) {
    const [sortField, setSortField] = useState<SortField>("totalAnswered");
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
        return `${mins}m ${secs}s`;
    };

    const getAnswerRateColor = (rate: number): string => {
        if (rate >= 80) return "text-emerald-600 bg-emerald-50";
        if (rate >= 60) return "text-amber-600 bg-amber-50";
        return "text-red-600 bg-red-50";
    };

    const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
        <th
            className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors"
            onClick={() => handleSort(field)}
        >
            <div className="flex items-center gap-1">
                {label}
                <ArrowUpDown className={`h-3 w-3 ${sortField === field ? "text-blue-600" : "text-slate-300"}`} />
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
                                <SortHeader field="callsFromQueue" label="Via Queue" />
                                <SortHeader field="callsDirect" label="Direct" />
                                <SortHeader field="callsIntercepted" label="Interceptés" />
                                <SortHeader field="totalAnswered" label="Total" />
                                <SortHeader field="answerRate" label="Taux" />
                                <SortHeader field="avgHandlingTimeSeconds" label="Durée moy." />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {sortedAgents.map((agent, index) => (
                                <tr key={`${agent.extension}-${agent.name}-${index}`} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-4 py-3">
                                        <div>
                                            <p className="font-medium text-slate-900">{agent.name}</p>
                                            <p className="text-xs text-slate-500">Ext. {agent.extension}</p>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-slate-700">{agent.callsFromQueue}</td>
                                    <td className="px-4 py-3 text-slate-700">{agent.callsDirect}</td>
                                    <td className="px-4 py-3">
                                        {agent.callsIntercepted > 0 ? (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700">
                                                {agent.callsIntercepted}
                                            </span>
                                        ) : (
                                            <span className="text-slate-400">0</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 font-semibold text-slate-900">{agent.totalAnswered}</td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getAnswerRateColor(agent.answerRate)}`}>
                                            {agent.answerRate}%
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-slate-700">
                                        {formatDuration(agent.avgHandlingTimeSeconds)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </CardContent>
        </Card>
    );
}
