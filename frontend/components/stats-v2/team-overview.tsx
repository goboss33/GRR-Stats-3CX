"use client";

import { formatDurationHuman as formatDuration } from "@/services/domain/call-aggregation";

import { QueueKPIs } from "@/types/statistics.types";
import { Card, CardContent } from "@/components/ui/card";
import { Phone, PhoneIncoming, PhoneMissed, ArrowRightLeft, Users, Clock, ExternalLink, TrendingUp } from "lucide-react";
import { outcomesForBucket, sumBucket, type CallOrigin } from "@/services/domain/call-classification";
import { OriginToggle } from "@/components/stats-v2/origin-toggle";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import Link from "next/link";

interface TeamOverviewProps {
    kpis: QueueKPIs;
    queueName: string;
    queueNumber: string;
    startDate: string;
    endDate: string;
    /** Provenance affichée (toggle Externe / Interne / Les deux). */
    origin: CallOrigin;
    onOriginChange: (origin: CallOrigin) => void;
    /** Variantes déjà en cache ; les autres apparaissent grisées avec un spinner. */
    loadedOrigins?: CallOrigin[];
    /** Conserve pour l'appelant : plus utilise ici depuis le socle de classement. */
    agentExtensions?: string[];
}

const COLORS = {
    direct: "#3b82f6",
    directUnanswered: "#93c5fd",
    queue: "#8b5cf6",
    queueUnanswered: "#c4b5fd",
    answered: "#10b981",
    abandoned: "#ef4444",
    overflow: "#f59e0b",
};

export function TeamOverview({ kpis, queueName, queueNumber, startDate, endDate, origin, onOriginChange, loadedOrigins }: TeamOverviewProps) {
    const totalReceived = kpis.callsReceived + kpis.teamDirectReceived;
    const totalAnswered = kpis.callsAnswered + kpis.teamDirectAnswered;
    // L'ecran reste a quatre chiffres : messagerie et abandons courts sont
    // regroupes dans « Perdus ». Le detail n'est pas perdu pour autant, le clic
    // ouvre les logs de la population exacte. La table DEFAULT_OUTCOME_GROUPING
    // sert a la fois a additionner et a construire le lien, donc les deux ne
    // peuvent pas diverger.
    const totalLost = sumBucket(kpis.outcomeCounts, "lost") + kpis.directLost;
    // Redirigés = file ET directs : un appel direct répondu ici mais servi hors
    // du groupe (règle answeredThenTransferred) est lui aussi reparti ailleurs.
    const totalOverflow = kpis.callsOverflow + kpis.directOverflow;
    const performanceRate = totalReceived > 0
        ? Math.round((totalAnswered / totalReceived) * 100)
        : 0;

    const directRate = kpis.teamDirectReceived > 0
        ? Math.round((kpis.teamDirectAnswered / kpis.teamDirectReceived) * 100)
        : 0;
    const queueRate = kpis.callsReceived > 0
        ? Math.round((kpis.callsAnswered / kpis.callsReceived) * 100)
        : 0;

    const directUnanswered = kpis.teamDirectReceived - kpis.teamDirectAnswered;
    const queueUnanswered = kpis.callsReceived - kpis.callsAnswered;


    // Lien vers les logs filtres par le SOCLE de classement : la population
    // listee est exactement celle agregee par le KPI, donc le nombre de lignes
    // egale le chiffre affiche. L'ancien `journeyFilter` testait la presence
    // d'un segment de resultat donne, critere non exclusif : un appel repasse
    // dans la file pouvait apparaitre a la fois dans « Repondus » et « Perdus ».
    // `team` demande d'inclure les appels directs de l'equipe, exactement comme
    // les cartes qui additionnent « File » et « Directs ».
    // La provenance choisie voyage avec le lien : la liste des logs décrit
    // alors exactement la population du chiffre cliqué.
    const originParam = origin !== "both" ? `&origin=${origin}` : "";
    const outcomeLink = (outcomes: readonly string[], team = true) =>
        `/admin/logs?start=${startDate}&end=${endDate}&queueOutcome=${queueNumber}:${outcomes.join(",")}${team ? ":team" : ""}${originParam}`;

    // Anneau externe : KPIs (Répondus, Perdus, Redirigés)
    const outcomeData = [
        { name: "Répondus", value: totalAnswered, color: COLORS.answered },
        { name: "Perdus", value: totalLost, color: COLORS.abandoned },
        { name: "Redirigés", value: totalOverflow, color: COLORS.overflow },
    ].filter(d => d.value > 0);

    const directTotal = kpis.teamDirectReceived;
    const queueTotal = kpis.callsReceived;
    const innerTotal = directTotal + queueTotal;
    const gapAngle = 12;
    const availableAngle = 360 - 2 * gapAngle;
    const gapValue = innerTotal > 0 ? (gapAngle / 360) * innerTotal : 0;

    const innerData = [
        { name: "Directs (répondus)", value: kpis.teamDirectAnswered, color: COLORS.direct, hatched: false },
        { name: "Directs (non répondus)", value: directUnanswered, color: COLORS.directUnanswered, hatched: true },
        { name: "Gap", value: gapValue, color: "transparent", hatched: false },
        { name: "File (répondus)", value: kpis.callsAnswered, color: COLORS.queue, hatched: false },
        { name: "File (non répondus)", value: queueUnanswered, color: COLORS.queueUnanswered, hatched: true },
        { name: "Gap", value: gapValue, color: "transparent", hatched: false },
    ].filter(d => d.value > 0);

    return (
        <Card>
            <CardContent className="py-6 px-6">
                {/* Header : titre, provenance et attente moyenne sur UNE ligne.
                    Même grille 4/8 que le contenu : le toggle partage ainsi le
                    bord gauche de la vignette « Total reçus ». Le filtre de
                    provenance agit sur tout l'écran et voyage avec les liens
                    des cartes. */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center mb-6">
                    <div className="lg:col-span-4 flex items-center gap-2 text-sm font-medium text-slate-500">
                        <Users className="h-4 w-4" />
                        <span>Bilan du groupe · {queueName}</span>
                    </div>
                    <div className="lg:col-span-8 flex flex-wrap items-center justify-between gap-3">
                        <OriginToggle value={origin} onChange={onOriginChange} loadedOrigins={loadedOrigins} />
                        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                            <Clock className="h-4 w-4 text-slate-500" />
                            <span className="text-sm font-medium text-slate-700">
                                Attente moy: <span className="text-slate-900">{formatDuration(kpis.avgWaitTimeSeconds)}</span>
                            </span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Colonne gauche : Donut double anneau */}
                    <div className="lg:col-span-4 flex items-center justify-center">
                        <div className="relative w-56 h-56">
                            {/* SVG Patterns pour hachures */}
                            <svg width="0" height="0" className="absolute">
                                <defs>
                                    <pattern id="hatch-blue" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
                                        <line x1="0" y1="0" x2="0" y2="4" stroke={COLORS.direct} strokeWidth="1.5" />
                                    </pattern>
                                    <pattern id="hatch-violet" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
                                        <line x1="0" y1="0" x2="0" y2="4" stroke={COLORS.queue} strokeWidth="1.5" />
                                    </pattern>
                                </defs>
                            </svg>
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    {/* Anneau externe : KPIs (Répondus, Perdus, Redirigés) */}
                                    <Pie
                                        data={outcomeData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={70}
                                        outerRadius={95}
                                        paddingAngle={2}
                                        dataKey="value"
                                        stroke="none"
                                    >
                                        {outcomeData.map((entry, index) => (
                                            <Cell key={`outer-${index}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    {/* Anneau interne : Directs vs File avec hachuré et gaps */}
                                    <Pie
                                        data={innerData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={45}
                                        outerRadius={65}
                                        paddingAngle={0}
                                        dataKey="value"
                                        stroke="none"
                                        startAngle={-90}
                                    >
                                        {innerData.map((entry, index) => (
                                            <Cell
                                                key={`inner-${index}`}
                                                fill={entry.color === "transparent" ? "transparent" : (entry.hatched ? (entry.color === COLORS.directUnanswered ? "url(#hatch-blue)" : "url(#hatch-violet)") : entry.color)}
                                            />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip
                                        formatter={(value, name) => [`${value} appels`, name]}
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                            {/* Centre du Donut */}
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="text-center">
                                    <div className="text-3xl font-bold text-slate-900">{totalReceived}</div>
                                    <div className="text-xs text-slate-500">Total</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Colonne droite : KPIs + Détails */}
                    <div className="lg:col-span-8 space-y-4">
                        {/* KPI Cards Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {/* Total Reçus */}
                            <Link
                                href={outcomeLink(outcomesForBucket("received"))}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group p-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1.5">
                                        <PhoneIncoming className="h-4 w-4 text-blue-600" />
                                        <span className="text-xs font-medium text-slate-600">Total reçus</span>
                                    </div>
                                    <ExternalLink className="h-3 w-3 text-slate-400 group-hover:text-blue-600 transition-colors" />
                                </div>
                                <div className="text-2xl font-bold text-slate-900">{totalReceived}</div>
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                    File: {kpis.callsReceived} · Directs: {kpis.teamDirectReceived}
                                </div>
                            </Link>

                            {/* Répondus */}
                            <Link
                                href={outcomeLink(outcomesForBucket("answered"))}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group p-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-emerald-300 hover:shadow-md transition-all cursor-pointer"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1.5">
                                        <Phone className="h-4 w-4 text-emerald-600" />
                                        <span className="text-xs font-medium text-slate-600">Répondus</span>
                                    </div>
                                    <ExternalLink className="h-3 w-3 text-slate-400 group-hover:text-emerald-600 transition-colors" />
                                </div>
                                <div className="text-2xl font-bold text-emerald-700">{totalAnswered}</div>
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                    File: {kpis.callsAnswered} · Directs: {kpis.teamDirectAnswered}
                                </div>
                            </Link>

                            {/* Perdus */}
                            <Link
                                href={outcomeLink(outcomesForBucket("lost"))}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group p-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-red-300 hover:shadow-md transition-all cursor-pointer"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1.5">
                                        <PhoneMissed className="h-4 w-4 text-red-600" />
                                        <span className="text-xs font-medium text-slate-600">Perdus</span>
                                    </div>
                                    <ExternalLink className="h-3 w-3 text-slate-400 group-hover:text-red-600 transition-colors" />
                                </div>
                                <div className="text-2xl font-bold text-red-700">{totalLost}</div>
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                    File: {sumBucket(kpis.outcomeCounts, "lost")} · Directs: {kpis.directLost}
                                </div>
                            </Link>

                            {/* Redirigés — file + directs : le lien inclut les
                                directs (team) pour lister la même population. */}
                            <Link
                                href={outcomeLink(outcomesForBucket("overflow"))}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group p-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-amber-300 hover:shadow-md transition-all cursor-pointer"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1.5">
                                        <ArrowRightLeft className="h-4 w-4 text-amber-600" />
                                        <span className="text-xs font-medium text-slate-600">Redirigés</span>
                                    </div>
                                    <ExternalLink className="h-3 w-3 text-slate-400 group-hover:text-amber-600 transition-colors" />
                                </div>
                                <div className="text-2xl font-bold text-amber-700">{totalOverflow}</div>
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                    File: {kpis.callsOverflow} · Directs: {kpis.directOverflow}
                                </div>
                            </Link>

                        </div>

                        {/* Performance Bar */}
                        <div className="pt-3 border-t border-slate-200">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <TrendingUp className="h-4 w-4 text-slate-500" />
                                    <span className="text-sm font-medium text-slate-600">Performance globale</span>
                                    <span className={`text-sm font-bold ${performanceRate >= 80 ? 'text-emerald-700' : performanceRate >= 60 ? 'text-amber-700' : 'text-red-700'}`}>
                                        {performanceRate}%
                                    </span>
                                </div>
                                <div className="text-xs text-slate-500">
                                    {totalAnswered} répondus / {totalReceived} reçus
                                </div>
                            </div>
                            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all ${performanceRate >= 80 ? 'bg-emerald-500' : performanceRate >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                                    style={{ width: `${Math.min(performanceRate, 100)}%` }}
                                />
                            </div>
                        </div>

                        {/* Détails Directs vs File (compact) */}
                        <div className="space-y-2">
                            {/* Directs */}
                            <div className="flex items-center justify-between p-2.5 rounded-lg bg-blue-50/50 border border-blue-100">
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                                    <span className="text-sm font-medium text-blue-900">Appels Directs</span>
                                    <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                                        {totalReceived > 0 ? Math.round((kpis.teamDirectReceived / totalReceived) * 100) : 0}%
                                    </span>
                                </div>
                                <div className="flex items-center gap-6 text-sm">
                                    <div className="text-center">
                                        <div className="font-bold text-blue-700">{kpis.teamDirectReceived}</div>
                                        <div className="text-[10px] text-blue-600">Reçus</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="font-bold text-blue-700">{kpis.teamDirectAnswered}</div>
                                        <div className="text-[10px] text-blue-600">Répondus</div>
                                    </div>
                                    <div className="text-center">
                                        <div className={`font-bold ${directRate >= 80 ? 'text-emerald-700' : directRate >= 60 ? 'text-amber-700' : 'text-red-700'}`}>
                                            {directRate}%
                                        </div>
                                        <div className="text-[10px] text-blue-600">Taux</div>
                                    </div>
                                </div>
                            </div>

                            {/* File */}
                            <div className="flex items-center justify-between p-2.5 rounded-lg bg-violet-50/50 border border-violet-100">
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                                    <span className="text-sm font-medium text-violet-900">File d'attente ({queueNumber})</span>
                                    <span className="text-xs font-semibold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">
                                        {totalReceived > 0 ? Math.round((kpis.callsReceived / totalReceived) * 100) : 0}%
                                    </span>
                                </div>
                                <div className="flex items-center gap-6 text-sm">
                                    <div className="text-center">
                                        <div className="font-bold text-violet-700">{kpis.callsReceived}</div>
                                        <div className="text-[10px] text-violet-600">Reçus</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="font-bold text-violet-700">{kpis.callsAnswered}</div>
                                        <div className="text-[10px] text-violet-600">Répondus</div>
                                    </div>
                                    <div className="text-center">
                                        <div className={`font-bold ${queueRate >= 80 ? 'text-emerald-700' : queueRate >= 60 ? 'text-amber-700' : 'text-red-700'}`}>
                                            {queueRate}%
                                        </div>
                                        <div className="text-[10px] text-violet-600">Taux</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
