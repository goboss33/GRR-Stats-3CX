"use client";

import { formatDurationHuman as formatDuration } from "@/services/domain/call-aggregation";

import { QueueKPIs } from "@/types/statistics.types";
import { Card, CardContent } from "@/components/ui/card";
import { Tip } from "@/components/ui/tooltip";
import { TrendPill } from "@/components/stats-v2/trend-arrow";
import { Phone, PhoneIncoming, PhoneMissed, ArrowRightLeft, Users, Clock, AlertTriangle } from "lucide-react";
import { outcomesForBucket, sumBucket, type CallOrigin } from "@/services/domain/call-classification";
import { computeTeamTotals, lossVerdict, type TeamTotals } from "@/services/domain/team-totals";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import Link from "next/link";

interface TeamOverviewProps {
    kpis: QueueKPIs;
    /** KPI de la période N-1 pour les pastilles de tendance des vignettes. */
    previousKpis: QueueKPIs | "loading" | "unavailable";
    /** Droit « Voir les logs » : sans lui, les vignettes perdent leurs liens. */
    logsEnabled: boolean;
    queueName: string;
    queueNumber: string;
    /** Département 3CX (déduit des CDR) — affiché quand on le connaît, rien sinon. */
    queueDepartment?: string | null;
    startDate: string;
    endDate: string;
    /** Provenance affichée (contexte global, réglée dans le header de l'app). */
    origin: CallOrigin;
    /** Conservé pour l'appelant : plus utilisé ici depuis le socle de classement. */
    agentExtensions?: string[];
}

// Grammaire de l'anneau intérieur : la TEINTE dit le canal (bleu = directs,
// violet = file), l'INTENSITÉ et la TEXTURE disent le sort — plein foncé =
// répondu ici, plein clair = transféré (pris en charge, remis à quelqu'un),
// hachuré = non abouti. L'ambre reste réservé à l'anneau extérieur et à la
// vignette Débordements : l'introduire ici casserait la lecture par canal.
const COLORS = {
    direct: "#3b82f6",
    directTransferred: "#93c5fd",
    directUnanswered: "#93c5fd",
    queue: "#8b5cf6",
    queueTransferred: "#c4b5fd",
    queueUnanswered: "#c4b5fd",
    answered: "#10b981",
    abandoned: "#ef4444",
    overflow: "#f59e0b",
};

export function TeamOverview({ kpis, previousKpis, logsEnabled, queueName, queueNumber, queueDepartment, startDate, endDate, origin }: TeamOverviewProps) {
    // Les totaux des vignettes viennent du helper PARTAGÉ avec les cartes de
    // l'aperçu des groupes (services/domain/team-totals) : les deux écrans ne
    // peuvent pas diverger. Le détail fin (regroupements, liens) reste ici.
    const {
        totalReceived, totalAnswered, totalLost, totalHandedOff,
        totalRedirected: totalOverflow, lossRate,
    } = computeTeamTotals(kpis);
    const handedOffCounts = kpis.handedOffInPerformance === "success";

    // Pastilles N-1 : mêmes formules et mêmes règles que les cartes de
    // l'aperçu — une période précédente sans aucun appel ne compare rien.
    const prevTotals = typeof previousKpis === "object" ? computeTeamTotals(previousKpis) : null;
    const prevState: TeamTotals | "loading" | "unavailable" =
        previousKpis === "loading" ? "loading"
            : prevTotals && prevTotals.totalReceived > 0 ? prevTotals
                : "unavailable";
    const prevOf = (pick: (t: TeamTotals) => number) =>
        typeof prevState === "object" ? pick(prevState) : prevState;

    // Taux de prise en charge PAR BLOC — même définition que la barre globale :
    // répondu ou transféré, c'est pris en charge.
    const directHandled = kpis.teamDirectAnswered + (handedOffCounts ? kpis.directHandedOff : 0);
    const queueHandled = kpis.callsAnswered + (handedOffCounts ? kpis.callsHandedOff : 0);
    const directRate = kpis.teamDirectReceived > 0
        ? Math.round((directHandled / kpis.teamDirectReceived) * 100)
        : 0;
    const queueRate = kpis.callsReceived > 0
        ? Math.round((queueHandled / kpis.callsReceived) * 100)
        : 0;

    // Non abouti = ni répondu ici, ni transféré : perdus et débordés.
    const directUnanswered = kpis.teamDirectReceived - kpis.teamDirectAnswered - kpis.directHandedOff;
    const queueUnanswered = kpis.callsReceived - kpis.callsAnswered - kpis.callsHandedOff;

    // Verdict de la consigne « moins de 30 % de perdus » : porté par
    // l'étiquette rouge du donut — triangle d'alerte devant le pourcentage
    // dès la zone d'approche (orange à 25 %, rouge au dépassement), rien de
    // plus quand l'objectif est tenu.
    const verdict = lossVerdict(lossRate);

    // Infobulle du chip de perte : la définition, et l'écart N-1 en points
    // quand la comparaison est disponible.
    const prevLoss = prevOf((t) => t.lossRate);
    const lossTip = "Taux de perte : perdus / reçus"
        + (typeof prevLoss === "number"
            ? ` — période précédente : ${prevLoss} % (${lossRate - prevLoss > 0 ? "+" : ""}${lossRate - prevLoss} pts)`
            : "");

    // Étiquettes des trois zones de l'anneau extérieur, posées à l'EXTÉRIEUR
    // de l'arc, sans ligne de rappel : la position et la couleur (fixe, celle
    // du segment — jamais un code santé) disent l'appartenance. Même taille
    // pour les trois ; le rouge, LA donnée cherchée, garde le gras et son
    // chip, et s'affiche toujours — le vert et l'ambre se taisent sous 5 %
    // (l'infobulle du secteur prend le relais).
    const RADIAN = Math.PI / 180;
    const renderOutcomeLabel = (props: unknown) => {
        const { cx, cy, midAngle, outerRadius, name, value } = props as {
            cx?: number; cy?: number; midAngle?: number; outerRadius?: number;
            name?: string; value?: number;
        };
        if (cx === undefined || cy === undefined || midAngle === undefined
            || outerRadius === undefined || value === undefined || totalReceived === 0) return null;
        const pctExact = (value / totalReceived) * 100;
        const isLost = name === "Perdus";
        if (!isLost && pctExact < 5) return null;
        const pct = Math.round(pctExact);
        const r = outerRadius + 13;
        const x = cx + r * Math.cos(-midAngle * RADIAN);
        const y = cy + r * Math.sin(-midAngle * RADIAN);
        if (!isLost) {
            return (
                <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
                    fontSize={15} fontWeight={500}
                    fill={name === "Répondus" ? "#047857" : "#b45309"}
                >
                    {pct}%
                </text>
            );
        }
        // LA donnée cherchée : un chip complet (fond pâle, bordure, gras),
        // décalé de l'anneau dans la direction de son segment — la demi-
        // étendue projetée garantit ~8 px d'air quel que soit l'angle.
        const showAlert = verdict !== "ok";
        const label = `${pct}%`;
        const textW = label.length * 8.3;
        const w = 16 + textW + (showAlert ? 17 : 0);
        const ux = Math.cos(-midAngle * RADIAN);
        const uy = Math.sin(-midAngle * RADIAN);
        const halfExtent = (w / 2) * Math.abs(ux) + 11 * Math.abs(uy);
        const d = outerRadius + 8 + halfExtent;
        const chipCx = cx + d * ux;
        const chipCy = cy + d * uy;
        const left = chipCx - w / 2;
        return (
            <Tip content={lossTip}>
                <g style={{ cursor: "default" }}>
                    <rect x={left} y={chipCy - 11} width={w} height={22} rx={11}
                        fill="#fef2f2" stroke="#fecaca" strokeWidth={1}
                    />
                    {showAlert && (
                        <AlertTriangle
                            x={left + 8} y={chipCy - 6.5} width={13} height={13}
                            color={verdict === "over" ? "#dc2626" : "#d97706"} strokeWidth={2.5}
                        />
                    )}
                    <text x={showAlert ? left + 24 : chipCx} y={chipCy}
                        textAnchor={showAlert ? "start" : "middle"} dominantBaseline="central"
                        fontSize={15} fontWeight={700} fill="#b91c1c"
                    >
                        {label}
                    </text>
                </g>
            </Tip>
        );
    };


    // Lien vers les logs filtres par le SOCLE de classement : la population
    // listee est exactement celle agregee par le KPI, donc le nombre de lignes
    // egale le chiffre affiche. L'ancien `journeyFilter` testait la presence
    // d'un segment de resultat donne, critere non exclusif : un appel repasse
    // dans la file pouvait apparaitre a la fois dans « Repondus » et « Perdus ».
    // `team` demande d'inclure les appels directs de l'equipe, exactement comme
    // les cartes qui additionnent « File » et « Directs ».
    // La provenance choisie voyage avec le lien : la liste des logs décrit
    // alors exactement la population du chiffre cliqué.
    // Toujours explicite : le défaut global étant « externe », omettre origin
    // depuis la vue « Les deux » ferait retomber les journaux sur « externe ».
    const originParam = `&origin=${origin}`;
    const outcomeLink = (outcomes: readonly string[], team = true) =>
        `/admin/logs?start=${startDate}&end=${endDate}&queueOutcome=${queueNumber}:${outcomes.join(",")}${team ? ":team" : ""}${originParam}`;

    // Anneau externe : KPIs dans l'ordre de la barre et des vignettes
    // (vert Répondus, ambre Débordements, rouge Perdus).
    const outcomeData = [
        { name: "Répondus", value: totalAnswered, color: COLORS.answered },
        { name: "Débordements", value: totalOverflow, color: COLORS.overflow },
        { name: "Perdus", value: totalLost, color: COLORS.abandoned },
    ].filter(d => d.value > 0);

    const directTotal = kpis.teamDirectReceived;
    const queueTotal = kpis.callsReceived;
    const innerTotal = directTotal + queueTotal;
    const gapAngle = 12;
    const availableAngle = 360 - 2 * gapAngle;
    const gapValue = innerTotal > 0 ? (gapAngle / 360) * innerTotal : 0;

    // Vignette KPI : lien vers les journaux quand l'utilisateur y a droit,
    // simple carte sinon — même contenu, sans affordance de clic mensongère.
    // `toneClass` teinte le fond aux couleurs du segment correspondant de la
    // barre de répartition : les vignettes SONT la légende de la barre.
    const TileShell = ({ href, toneClass, hoverClass, children }: {
        href: string;
        toneClass: string;
        hoverClass: string;
        children: React.ReactNode;
    }) => (logsEnabled ? (
        <Link
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`group p-3 rounded-xl border hover:shadow-md transition-all cursor-pointer ${toneClass} ${hoverClass}`}
        >
            {children}
        </Link>
    ) : (
        <div className={`p-3 rounded-xl border ${toneClass}`}>{children}</div>
    ));

    const innerData = [
        { name: "Directs (répondus)", value: kpis.teamDirectAnswered, color: COLORS.direct, hatched: false },
        { name: "Directs (transférés)", value: kpis.directHandedOff, color: COLORS.directTransferred, hatched: false },
        { name: "Directs (non aboutis)", value: directUnanswered, color: COLORS.directUnanswered, hatched: true },
        { name: "Gap", value: gapValue, color: "transparent", hatched: false },
        { name: "File (répondus)", value: kpis.callsAnswered, color: COLORS.queue, hatched: false },
        { name: "File (transférés)", value: kpis.callsHandedOff, color: COLORS.queueTransferred, hatched: false },
        { name: "File (non aboutis)", value: queueUnanswered, color: COLORS.queueUnanswered, hatched: true },
        { name: "Gap", value: gapValue, color: "transparent", hatched: false },
    ].filter(d => d.value > 0);

    return (
        <Card>
            <CardContent className="py-6 px-6">
                {/* Header : titre et attente moyenne sur UNE ligne. La
                    provenance se règle dans le HEADER de l'application
                    (contexte global) ; elle voyage avec les liens des cartes. */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center mb-6">
                    <div className="lg:col-span-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                            <Users className="h-4 w-4" />
                            <span>{queueName}</span>
                        </div>
                        {queueDepartment && (
                            <p className="mt-0.5 pl-6 text-xs text-slate-400">{queueDepartment}</p>
                        )}
                    </div>
                    <div className="lg:col-span-8 flex flex-wrap items-center justify-end gap-3">
                        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                            <Clock className="h-4 w-4 text-slate-500" />
                            <span className="text-sm font-medium text-slate-700">
                                Attente moy: <span className="text-slate-900">{formatDuration(kpis.avgWaitTimeSeconds)}</span>
                            </span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Colonne gauche : Donut double anneau — les anneaux gardent
                        leur taille d'origine, le conteneur est juste plus LARGE
                        (320×256) pour que le chip du taux de perte ait sa place
                        même quand le segment rouge pointe à l'horizontale. */}
                    <div className="lg:col-span-4 flex items-center justify-center">
                        <div className="relative w-80 h-64">
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
                                    {/* Anneau externe : KPIs (Répondus, Débordements, Perdus) */}
                                    <Pie
                                        data={outcomeData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={70}
                                        outerRadius={95}
                                        paddingAngle={2}
                                        dataKey="value"
                                        stroke="none"
                                        label={renderOutcomeLabel}
                                        labelLine={false}
                                        isAnimationActive={false}
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
                                        isAnimationActive={false}
                                    >
                                        {innerData.map((entry, index) => (
                                            <Cell
                                                key={`inner-${index}`}
                                                fill={entry.color === "transparent" ? "transparent" : (entry.hatched ? (entry.color === COLORS.directUnanswered ? "url(#hatch-blue)" : "url(#hatch-violet)") : entry.color)}
                                            />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip
                                        formatter={(value, name) => [
                                            `${value} appels${totalReceived > 0 ? ` (${Math.round((Number(value) / totalReceived) * 100)} %)` : ""}`,
                                            name,
                                        ]}
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
                            {/* Total Reçus — le dénominateur reste NEUTRE : un
                                volume n'est ni bon ni mauvais, et le bleu est
                                réservé au canal « directs ». */}
                            <TileShell
                                href={outcomeLink(outcomesForBucket("received"))}
                                toneClass="bg-slate-50 border-slate-200"
                                hoverClass="hover:border-blue-300"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1.5">
                                        <PhoneIncoming className="h-4 w-4 text-blue-600" />
                                        <span className="text-xs font-medium text-slate-600">Total reçus</span>
                                    </div>
                                    <TrendPill current={totalReceived} previous={prevOf((t) => t.totalReceived)} sense="neutral" />
                                </div>
                                <div className="text-2xl font-bold text-slate-900">{totalReceived}</div>
                                <div className="mt-0.5 text-[10px] text-slate-500">
                                    Directs: {kpis.teamDirectReceived} · Équipe: {kpis.callsReceived}
                                </div>
                            </TileShell>

                            {/* Répondus */}
                            <TileShell
                                href={outcomeLink(outcomesForBucket("answered"))}
                                toneClass="bg-emerald-50/50 border-emerald-200"
                                hoverClass="hover:border-emerald-300"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1.5">
                                        <Phone className="h-4 w-4 text-emerald-600" />
                                        <span className="text-xs font-medium text-emerald-900">Répondus</span>
                                    </div>
                                    <TrendPill current={totalAnswered} previous={prevOf((t) => t.totalAnswered)} sense="higher-better" />
                                </div>
                                <div className="text-2xl font-bold text-emerald-700">{totalAnswered}</div>
                                <div className="mt-0.5 text-[10px] text-emerald-600">
                                    Directs: {kpis.teamDirectAnswered} · Équipe: {kpis.callsAnswered}{totalHandedOff > 0 && <> · Transférés: {totalHandedOff}</>}
                                </div>
                            </TileShell>

                            {/* Débordements — partis SANS décroché ici, file +
                                directs : le lien inclut les directs (team) pour
                                lister la même population. Les transferts
                                accomplis vivent dans la vignette Répondus.
                                AVANT Perdus : l'ordre des vignettes suit celui
                                des segments de la barre (vert, ambre, rouge). */}
                            <TileShell
                                href={outcomeLink(outcomesForBucket("overflow"))}
                                toneClass="bg-amber-50/50 border-amber-200"
                                hoverClass="hover:border-amber-300"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1.5">
                                        <ArrowRightLeft className="h-4 w-4 text-amber-600" />
                                        <span className="text-xs font-medium text-amber-900">Débordements</span>
                                    </div>
                                    <TrendPill current={totalOverflow} previous={prevOf((t) => t.totalRedirected)} sense="neutral" />
                                </div>
                                <div className="text-2xl font-bold text-amber-700">{totalOverflow}</div>
                                <div className="mt-0.5 text-[10px] text-amber-600">
                                    Directs: {kpis.directOverflow} · Équipe: {kpis.callsOverflow}
                                </div>
                            </TileShell>

                            {/* Perdus */}
                            <TileShell
                                href={outcomeLink(outcomesForBucket("lost"))}
                                toneClass="bg-red-50/50 border-red-200"
                                hoverClass="hover:border-red-300"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1.5">
                                        <PhoneMissed className="h-4 w-4 text-red-600" />
                                        <span className="text-xs font-medium text-red-900">Perdus</span>
                                    </div>
                                    <TrendPill current={totalLost} previous={prevOf((t) => t.totalLost)} sense="lower-better" />
                                </div>
                                <div className="text-2xl font-bold text-red-700">{totalLost}</div>
                                <div className="mt-0.5 text-[10px] text-red-600">
                                    Directs: {kpis.directLost} · Équipe: {sumBucket(kpis.outcomeCounts, "lost")}
                                </div>
                            </TileShell>

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
                                        <div className="font-bold text-blue-400">{kpis.directHandedOff}</div>
                                        <div className="text-[10px] text-blue-600">Transférés</div>
                                    </div>
                                    <div className="text-center">
                                        <Tip content="Prise en charge du bloc : (répondus + transférés) / reçus">
                                            <div className={`font-bold ${directRate >= 80 ? 'text-emerald-700' : directRate >= 60 ? 'text-amber-700' : 'text-red-700'}`}>
                                                {directRate}%
                                            </div>
                                        </Tip>
                                        <div className="text-[10px] text-blue-600">Taux</div>
                                    </div>
                                </div>
                            </div>

                            {/* File */}
                            <div className="flex items-center justify-between p-2.5 rounded-lg bg-violet-50/50 border border-violet-100">
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                                    <span className="text-sm font-medium text-violet-900">Appels d'équipe</span>
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
                                        <div className="font-bold text-violet-400">{kpis.callsHandedOff}</div>
                                        <div className="text-[10px] text-violet-600">Transférés</div>
                                    </div>
                                    <div className="text-center">
                                        <Tip content="Prise en charge du bloc : (répondus + transférés) / reçus">
                                            <div className={`font-bold ${queueRate >= 80 ? 'text-emerald-700' : queueRate >= 60 ? 'text-amber-700' : 'text-red-700'}`}>
                                                {queueRate}%
                                            </div>
                                        </Tip>
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
