"use client";

import { formatDurationHuman as formatDuration } from "@/services/domain/call-aggregation";

import { AgentStats, QueueKPIs } from "@/types/statistics.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendPill } from "@/components/stats-v2/trend-arrow";
import { Users, ArrowUpDown, Info, Eye, EyeOff } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
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
    queueAnswered: "Contribution de l'agent aux appels d'équipe",
    directAnswered: "Appels directs répondus",
    transferred: "Appels transférés par l'agent à une autre équipe",
    totalAnswered: "La somme : appels directs + appels d'équipe + appels transférés",
    totalHandlingTimeSeconds: "Temps total en conversation",
    avgHandlingTimeSeconds: "Durée moyenne d'une conversation",
    participationRate: "Sa part des appels pris en charge par l'équipe",
};

// Préférence d'affichage des dénominateurs (mémorisée par navigateur).
const RATIOS_STORAGE_KEY = "agent-performance-show-ratios";

export function AgentPerformanceTableV2({
    agents,
    previousStats,
    totalQueueCallsAnswered,
    totalQueueCallsReceived,
    totalDirectCallsAnswered,
    totalDirectCallsReceived,
    handedOffInPerformance = "success",
}: AgentPerformanceTableV2Props) {
    const [sortField, setSortField] = useState<SortField>("totalAnswered");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
    // Un transfert accompli est une prise en charge (règle configurable) : la
    // colonne « Pris en charge » et la jauge suivent la même définition que la
    // barre de l'écran.
    const handedOffCounts = handedOffInPerformance === "success";

    // Les dénominateurs (reçus, sollicitations) parlent aux analystes mais
    // surchargent la lecture des managers : masqués par défaut.
    const [showRatios, setShowRatios] = useState(false);
    useEffect(() => {
        setShowRatios(localStorage.getItem(RATIOS_STORAGE_KEY) === "1");
    }, []);
    const toggleRatios = () => {
        const next = !showRatios;
        setShowRatios(next);
        localStorage.setItem(RATIOS_STORAGE_KEY, next ? "1" : "0");
    };

    // Total answered calls for participation rate
    const totalTeamAnswered = totalQueueCallsAnswered + totalDirectCallsAnswered;
    // Transferts accomplis de l'équipe : somme des crédits agents (sous la
    // règle « dernier décrocheur », elle égale la vignette Transférés).
    const totalTeamTransferred = agents.reduce(
        (acc, a) => acc + a.queueTransferred + a.directTransferred, 0,
    );

    // Compute participation rates for all agents — un transfert accompli est
    // une participation au même titre qu'une réponse (travail des réceptions).
    const teamHandled = totalTeamAnswered + totalTeamTransferred;

    const agentsWithMetrics = useMemo(() => {
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
    }, [agents, teamHandled, handedOffCounts]);

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


    // Largeur des segments de la barre « Taux de participation » : la piste
    // entière représente les 100 % de l'équipe.
    const shareOfTeam = (n: number) => (teamHandled > 0 ? (n / teamHandled) * 100 : 0);

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

    const SortHeader = ({ field, label, className, center }: { field: SortField; label: string; className?: string; center?: boolean }) => (
        <th
            className={"px-3 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 transition-colors " + (center ? "text-center " : "text-left ") + (className ?? "")}
            onClick={() => handleSort(field)}
        >
            <div className={`flex items-center gap-1 ${center ? "justify-center" : ""}`}>
                <span className="whitespace-pre-line leading-tight">{label}</span>
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
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    onClick={toggleRatios}
                                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${showRatios
                                        ? "border-blue-200 bg-blue-50 text-blue-700"
                                        : "border-slate-200 text-slate-500 hover:text-slate-700"}`}
                                >
                                    {showRatios ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                                    Ratios
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs">
                                Afficher le nombre d&apos;appels reçus derrière chaque chiffre (ex. 85/111)
                            </TooltipContent>
                        </Tooltip>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-y">
                                <tr>
                                    <SortHeader field="name" label="Agent" className="w-[22%]" />
                                    {/* Hiérarchie : les 3 composantes en petit et centrées, leur
                                        somme « Prise en charge totale » en gros sur colonne
                                        bleutée, sa décomposition en barre tricolore. */}
                                    <SortHeader field="directAnswered" label={"Appels\ndirects"} center className="w-[9%]" />
                                    <SortHeader field="queueAnswered" label={"Appels\nd'équipe"} center className="w-[9%]" />
                                    <SortHeader field="transferred" label={"Appels\ntransférés"} center className="w-[10%]" />
                                    <SortHeader field="totalAnswered" label={"Prise en charge\ntotale"} center className="w-[14%] bg-blue-100/70 text-blue-900" />
                                    <SortHeader field="participationRate" label={"Taux de\nparticipation"} center className="w-[14%] bg-blue-100/70 text-blue-900" />
                                    <SortHeader field="totalHandlingTimeSeconds" label={"Durée\ntotale"} center className="w-[11%]" />
                                    <SortHeader field="avgHandlingTimeSeconds" label={"Durée\nmoy."} center className="w-[11%]" />
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
                                        <td className="px-3 py-3 text-center">
                                            <span className="text-sm font-medium text-blue-700">{agent.directAnswered}</span>
                                            {showRatios && <span className="text-slate-400 text-xs">/{agent.directReceived}</span>}
                                        </td>
                                        <td className="px-3 py-3 text-center">
                                            <span className="text-sm font-medium text-violet-700">{agent.answered}</span>
                                            {showRatios && <span className="text-slate-400 text-xs">/{agent.callsReceived}</span>}
                                        </td>
                                        <td className="px-3 py-3 text-center">
                                            {/* Teal, pas ambre : l'ambre est la couleur des Débordements,
                                                or le transfert accompli compte dans les Répondus. */}
                                            <span className="text-sm font-medium text-teal-600">{agent.transferred}</span>
                                        </td>
                                        <td className="px-3 py-3 text-center bg-blue-50/70">
                                            <span className="text-lg font-bold text-slate-900">{agent.totalAnswered}</span>
                                            {showRatios && <span className="text-slate-400 text-sm">/{agent.callsReceived + agent.directReceived}</span>}
                                        </td>
                                        <td className="px-3 py-3 bg-blue-50/70">
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div className="flex cursor-help items-center gap-2">
                                                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/60">
                                                            <div className="flex h-full">
                                                                <div className="bg-blue-500" style={{ width: `${shareOfTeam(agent.directAnswered)}%` }} />
                                                                <div className="bg-violet-500" style={{ width: `${shareOfTeam(agent.answered)}%` }} />
                                                                <div className="bg-teal-500" style={{ width: `${shareOfTeam(agent.transferred)}%` }} />
                                                            </div>
                                                        </div>
                                                        <span className="w-9 text-right text-xs font-semibold text-slate-600">{agent.participationRate}%</span>
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent side="top" className="max-w-xs text-xs">
                                                    {agent.name} a pris en charge {agent.answered + agent.directAnswered + agent.transferred} des {teamHandled} appels
                                                    traités par l&apos;équipe, soit {agent.participationRate} %
                                                </TooltipContent>
                                            </Tooltip>
                                        </td>
                                        <td className="px-3 py-3 text-center text-slate-700">
                                            {formatDurationHMS(agent.totalHandlingTimeSeconds)}
                                        </td>
                                        <td className="px-3 py-3 text-center text-slate-700">
                                            {formatDuration(agent.avgHandlingTimeSeconds)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            {/* Ligne TOTAL */}
                            <tfoot className="bg-slate-100 border-t-2 border-slate-300">
                                <tr className="font-semibold">
                                    <td className="px-3 py-3 text-slate-800">TOTAL</td>
                                    <td className="px-3 py-3 text-center">
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <span className="text-sm text-blue-700 cursor-help">
                                                    {totalDirectCallsAnswered}
                                                    {showRatios && <span className="text-slate-400 text-xs">/{totalDirectCallsReceived}</span>}
                                                </span>
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="max-w-xs text-xs">
                                                Totaux dédupliqués au niveau équipe (un appel transféré entre agents compte une seule fois)
                                            </TooltipContent>
                                        </Tooltip>
                                    </td>
                                    <td className="px-3 py-3 text-center">
                                        <span className="text-sm text-violet-700">{totals.answered}</span>
                                        {showRatios && <span className="text-slate-400 text-xs">/{totalQueueCallsReceived}</span>}
                                    </td>
                                    <td className="px-3 py-3 text-center">
                                        <span className="text-sm text-teal-600">{totalTeamTransferred}</span>
                                    </td>
                                    <td className="px-3 py-3 text-center bg-blue-100/60">
                                        {/* Même définition que la barre « Prise en charge » du
                                            bilan : la ligne TOTAL retombe sur son pourcentage. */}
                                        <span className="text-lg font-bold text-slate-900">{totals.answered + totalDirectCallsAnswered + (handedOffCounts ? totalTeamTransferred : 0)}</span>
                                        {showRatios && <span className="text-slate-400 text-sm">/{totalQueueCallsReceived + totalDirectCallsReceived}</span>}
                                    </td>
                                    <td className="px-3 py-3 text-center bg-blue-100/60 text-slate-400">—</td>
                                    <td className="px-3 py-3 text-center text-slate-800">
                                        {formatDurationHMS(totals.totalHandlingTimeSeconds)}
                                    </td>
                                    <td className="px-3 py-3 text-center text-slate-800">
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
