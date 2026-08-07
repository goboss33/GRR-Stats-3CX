"use client";

import { formatDurationHuman as formatDuration } from "@/services/domain/call-aggregation";

import { AgentStats, QueueKPIs } from "@/types/statistics.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendPill } from "@/components/stats-v2/trend-arrow";
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
    /**
     * Stats N-1 (KPI + agents) pour la pastille d'évolution à côté du nom —
     * « loading » = squelettes, « unavailable » = pas de pastille du tout.
     */
    previousStats: { kpis: QueueKPIs; agents: AgentStats[] } | "loading" | "unavailable";
    totalQueueCallsAnswered: number;
    totalQueueCallsReceived: number;
    totalDirectCallsAnswered: number;
    totalDirectCallsReceived: number;
    /** Le transfert accompli compte-t-il dans la prise en charge ? (règle) */
    handedOffInPerformance?: "success" | "neutral";
}

type SortField = "name" | "queueAnswered" | "directAnswered" | "transferred" | "totalAnswered" | "totalHandlingTimeSeconds" | "avgHandlingTimeSeconds" | "participationRate";
type SortDirection = "asc" | "desc";

const columnTooltips: Record<string, string> = {
    name: "La pastille compare ses appels pris en charge à la période précédente",
    queueAnswered: "Appels de la file résolus par l'agent / appels où il a sonné",
    directAnswered: "Appels directs répondus / reçus",
    transferred: "A décroché puis transféré l'appel ailleurs",
    totalAnswered: "La somme : Directs + File + Transférés",
    totalHandlingTimeSeconds: "Temps total en conversation",
    avgHandlingTimeSeconds: "Durée moyenne d'une conversation",
    participationRate: "Sa part des appels pris en charge par l'équipe",
};

function getParticipationColor(rate: number): string {
    if (rate >= 20) return "text-blue-700 bg-blue-50 border-blue-200";
    if (rate >= 10) return "text-slate-700 bg-slate-50 border-slate-200";
    return "text-slate-500 bg-slate-50 border-slate-200";
}

export function AgentPerformanceTableV2({
    agents,
    previousStats,
    totalQueueCallsAnswered,
    totalQueueCallsReceived,
    totalDirectCallsAnswered,
    totalDirectCallsReceived,
    handedOffInPerformance = "success",
}: AgentPerformanceTableV2Props) {
    const [sortField, setSortField] = useState<SortField>("participationRate");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
    // Un transfert accompli est une prise en charge (règle configurable) : la
    // colonne « Pris en charge » et la jauge suivent la même définition que la
    // barre de l'écran.
    const handedOffCounts = handedOffInPerformance === "success";

    // Total answered calls for participation rate
    const totalTeamAnswered = totalQueueCallsAnswered + totalDirectCallsAnswered;
    // Transferts accomplis de l'équipe : somme des crédits agents (sous la
    // règle « dernier décrocheur », elle égale la vignette Transférés).
    const totalTeamTransferred = agents.reduce(
        (acc, a) => acc + a.queueTransferred + a.directTransferred, 0,
    );

    // Compute participation rates for all agents — un transfert accompli est
    // une participation au même titre qu'une réponse (travail des réceptions).
    const agentsWithMetrics = useMemo(() => {
        const teamHandled = totalTeamAnswered + totalTeamTransferred;
        return agents.map(agent => {
            const transferred = agent.queueTransferred + agent.directTransferred;
            return {
                ...agent,
                participationRate: teamHandled > 0
                    ? Math.round(((agent.answered + agent.directAnswered + transferred) / teamHandled) * 100)
                    : 0,
                // Champs dérivés servant uniquement de clés de tri (cf. type SortField)
                queueAnswered: agent.answered,
                transferred,
                // « Pris en charge » : répondus + transferts accomplis quand la
                // règle les compte — même définition que la barre de l'écran.
                totalAnswered: agent.answered + agent.directAnswered + (handedOffCounts ? transferred : 0),
            };
        });
    }, [agents, totalTeamAnswered, totalTeamTransferred, handedOffCounts]);

    // Évolution N-1 par agent : la pastille à côté du nom compare LE chiffre
    // affiché juste dessous (« N appels » de la jauge = répondus + directs +
    // transferts accomplis). Appariement par (extension, nom) : les lignes
    // sont ventilées par titulaire de l'époque, donc un poste réattribué ne
    // compare que le MÊME titulaire d'une année sur l'autre — un nouveau
    // collaborateur n'a pas de pastille au lieu d'hériter de l'historique de
    // son prédécesseur ; une période N-1 sans prise en charge ne compare rien.
    const prevAgentMap = useMemo(() => {
        const map = new Map<string, { calls: number; participation: number }>();
        if (typeof previousStats !== "object") return map;
        const { kpis: prevKpis, agents: prevAgents } = previousStats;
        const prevTeamTransferred = prevAgents.reduce(
            (acc, a) => acc + a.queueTransferred + a.directTransferred, 0,
        );
        const prevTeamHandled = prevKpis.callsAnswered + prevKpis.teamDirectAnswered + prevTeamTransferred;
        if (prevTeamHandled <= 0) return map;
        for (const a of prevAgents) {
            const calls = a.answered + a.directAnswered + a.queueTransferred + a.directTransferred;
            map.set(`${a.extension}|${a.name}`, {
                calls,
                participation: Math.round((calls / prevTeamHandled) * 100),
            });
        }
        return map;
    }, [previousStats]);

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

    const SortHeader = ({ field, label, className }: { field: SortField; label: string; className?: string }) => (
        <th
            className={"px-3 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors " + (className ?? "")}
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
        <TooltipProvider delayDuration={0}>
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
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-y">
                                <tr>
                                    <SortHeader field="name" label="Agent" />
                                    {/* Directs + File + Transférés (teinte commune) = Pris en
                                        charge (teinte bleue) : l'addition se lit de gauche à droite. */}
                                    <SortHeader field="directAnswered" label="Directs" className="bg-slate-100/80" />
                                    <SortHeader field="queueAnswered" label="File (résolu)" className="bg-slate-100/80" />
                                    <SortHeader field="transferred" label="Transférés" className="bg-slate-100/80" />
                                    <SortHeader field="totalAnswered" label="Pris en charge" className="bg-blue-100/70 text-blue-900" />
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
                                                <p className="flex items-center gap-1.5 font-medium text-slate-900">
                                                    {agent.name}
                                                    <TrendPill
                                                        current={agent.answered + agent.directAnswered + agent.transferred}
                                                        previous={previousStats === "loading" ? "loading"
                                                            : prevAgentMap.get(`${agent.extension}|${agent.name}`)?.calls ?? "unavailable"}
                                                        sense="higher-better"
                                                        detail={prevAgentMap.has(`${agent.extension}|${agent.name}`)
                                                            ? `— participation : ${prevAgentMap.get(`${agent.extension}|${agent.name}`)!.participation} % → ${agent.participationRate} %`
                                                            : undefined}
                                                    />
                                                </p>
                                                <p className="text-xs text-slate-500">Ext. {agent.extension}</p>
                                            </div>
                                        </td>
                                        <td className="px-3 py-3 bg-slate-50/60">
                                            <span className="font-semibold text-blue-700">{agent.directAnswered}</span>
                                            <span className="text-slate-400 text-sm">/{agent.directReceived}</span>
                                        </td>
                                        <td className="px-3 py-3 bg-slate-50/60">
                                            <span className="font-semibold text-violet-700">{agent.answered}</span>
                                            <span className="text-slate-400 text-sm">/{agent.callsReceived}</span>
                                        </td>
                                        <td className="px-3 py-3 bg-slate-50/60">
                                            <span className="font-semibold text-amber-700">{agent.transferred}</span>
                                        </td>
                                        <td className="px-3 py-3 bg-blue-50/70">
                                            <span className="font-semibold text-slate-900">{agent.totalAnswered}</span>
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
                                    <td className="px-3 py-3 bg-slate-200/40">
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
                                    <td className="px-3 py-3 bg-slate-200/40">
                                        <span className="text-violet-700">{totals.answered}</span>
                                        <span className="text-slate-400 text-sm">/{totalQueueCallsReceived}</span>
                                    </td>
                                    <td className="px-3 py-3 bg-slate-200/40">
                                        <span className="text-amber-700">{totalTeamTransferred}</span>
                                    </td>
                                    <td className="px-3 py-3 bg-blue-100/60">
                                        {/* Même définition que la barre « Prise en charge » du
                                            bilan : la ligne TOTAL retombe sur son pourcentage. */}
                                        <span className="text-slate-900">{totals.answered + totalDirectCallsAnswered + (handedOffCounts ? totalTeamTransferred : 0)}</span>
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
