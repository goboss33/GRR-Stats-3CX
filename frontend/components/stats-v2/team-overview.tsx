"use client";

import { useState } from "react";

import { formatDurationHuman as formatDuration } from "@/services/domain/call-aggregation";

import { QueueKPIs } from "@/types/statistics.types";
import { Card, CardContent } from "@/components/ui/card";
import { Tip } from "@/components/ui/tooltip";
import { TrendPill } from "@/components/stats-v2/trend-arrow";
import { Phone, PhoneIncoming, PhoneMissed, ArrowRightLeft, Users, Clock, AlertTriangle, Info } from "lucide-react";
import { outcomesForBucket, sumBucket, type CallOrigin } from "@/services/domain/call-classification";
import { computeTeamTotals, lossVerdict, type TeamTotals } from "@/services/domain/team-totals";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
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

    // LIAISON vignettes <-> donut <-> blocs de canal (retour du cadre testeur :
    // « à quoi correspondent les cercles intérieurs ? »). Survoler une vignette
    // de sort illumine son arc ; survoler un arc illumine sa vignette ou son
    // bloc ; tout ce qui n'appartient pas à la famille survolée s'estompe.
    // Pur état d'affichage — aucun chiffre ne change.
    type Focus =
        | { kind: "outcome"; key: "answered" | "overflow" | "lost" }
        | { kind: "channel"; key: "direct" | "queue" }
        | { kind: "total" };
    const [focus, setFocus] = useState<Focus | null>(null);
    // Pas de délai de relâchement : une MATRICE de détection invisible couvre
    // les zones SANS espace blanc (anneaux jointifs sur le donut, enveloppes
    // bord à bord autour des vignettes et des blocs). La souris est toujours
    // « quelque part », le focus passe d'une zone à l'autre sans état vide.
    // Survoler le TOTAL (centre du donut, vignette « Appels reçus ») ne doit
    // rien estomper : tout appartient au total.
    const cellOpacity = (kind: "outcome" | "channel", key: string): number =>
        !focus || focus.kind === "total" ? 1 : focus.kind === kind && focus.key === key ? 1 : 0.25;
    const focusHandlers = (f: Focus) => ({
        onMouseEnter: () => setFocus(f),
        onMouseLeave: () => setFocus(null),
    });
    const OUTCOME_KEYS: Record<string, "answered" | "overflow" | "lost"> = {
        "Répondus": "answered", "Débordements": "overflow", "Perdus": "lost",
    };

    // Animation d'ENTRÉE du donut : une fois par contexte (équipe + période +
    // provenance), jamais au rafraîchissement du même contexte — c'était le
    // « petit souci » historique : l'animation rejouait à chaque polling et
    // Recharts masque les étiquettes pendant qu'elle tourne, donc les
    // pourcentages clignotaient toutes les 10-15 s.
    // NB : pas de garde prefers-reduced-motion ici — c'était le premier jet,
    // et le poste de l'utilisateur principal a les animations système
    // désactivées : le balayage et les transitions devenaient invisibles.
    // Produit interne, animations courtes : on les assume.
    const contextKey = `${queueNumber}|${startDate}|${endDate}|${origin}`;
    const [animatedKey, setAnimatedKey] = useState<string | null>(null);
    const entryAnimation = animatedKey !== contextKey;

    // Détachement de l'arc survolé : mise à l'échelle autour du CENTRE du
    // graphique (conteneur 320×256 → 160,128). Le rayon gagne ~4 %, l'arc
    // « sort de la tarte » — pur CSS, aucun recalcul Recharts.
    const DONUT_CENTER = "160px 128px";
    const arcStyle = (focused: boolean, pop: number) => ({
        transition: "opacity 150ms ease, transform 150ms ease",
        transform: focused ? `scale(${pop})` : "scale(1)",
        transformOrigin: DONUT_CENTER,
        outline: "none",
    });

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
        // Tous les libellés s'écartent de l'anneau par leur demi-étendue
        // PROJETÉE dans la direction du segment : ~8 px d'air garantis quel
        // que soit l'angle, un texte large ne revient jamais lécher l'arc.
        const ux = Math.cos(-midAngle * RADIAN);
        const uy = Math.sin(-midAngle * RADIAN);
        if (!isLost) {
            const plainW = `${pct}%`.length * 7.8;
            const plainExtent = (plainW / 2) * Math.abs(ux) + 8 * Math.abs(uy);
            const dPlain = outerRadius + 8 + plainExtent;
            return (
                <text x={cx + dPlain * ux} y={cy + dPlain * uy}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={15} fontWeight={500}
                    fill={name === "Répondus" ? "#047857" : "#b45309"}
                >
                    {pct}%
                </text>
            );
        }
        // LA donnée cherchée : un chip complet (fond pâle, bordure, gras).
        const showAlert = verdict !== "ok";
        const label = `${pct}%`;
        const textW = label.length * 8.3;
        const w = 16 + textW + (showAlert ? 17 : 0);
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
    // barre de répartition : les vignettes SONT la légende de la barre. Colonne flex étirée
    // dans son enveloppe : les vignettes d'une même rangée partagent leur
    // hauteur et la ligne « Directs / Équipe » s'ancre en bas (mt-auto).
    const TileShell = ({ href, toneClass, hoverClass, interaction, children }: {
        href: string;
        toneClass: string;
        hoverClass: string;
        /** Liaison vignette <-> donut : survol + surbrillance quand l'arc l'est. */
        interaction?: React.HTMLAttributes<HTMLElement>;
        children: React.ReactNode;
    }) => (logsEnabled ? (
        <Link
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`group flex w-full flex-col p-3 rounded-xl border hover:shadow-md transition-all cursor-pointer ${toneClass} ${hoverClass}`}
            {...interaction}
        >
            {children}
        </Link>
    ) : (
        <div className={`flex w-full flex-col p-3 rounded-xl border transition-all ${toneClass}`} {...interaction}>{children}</div>
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

    // MATRICE DE DÉTECTION — données « jointives ». Les Pie transparents qui
    // captent la souris ne doivent avoir AUCUN trou : les zones s'étendent
    // jusqu'au MILIEU de chaque espace blanc du donut.
    //
    // Anneau externe : recharts, sur un cercle complet, fait démarrer le
    // premier secteur pile à startAngle, place une gouttière de paddingAngle
    // APRÈS chaque secteur non nul, et répartit 360 − n×padding au prorata
    // (cf. Pie.js : totalPaddingAngle = notZeroItemCount × paddingAngle ;
    // padding forcé à 0 quand il n'y a qu'un secteur). On reproduit ce calcul
    // en degrés puis chaque zone gagne une demi-gouttière de chaque côté, et
    // l'ensemble démarre une demi-gouttière plus tôt : somme = 360 pile.
    const OUTER_PADDING = 2;
    const outerPad = outcomeData.length <= 1 ? 0 : OUTER_PADDING;
    const outcomeHitData = (() => {
        const total = outcomeData.reduce((sum, d) => sum + d.value, 0);
        if (total <= 0) return [];
        const usable = 360 - outerPad * outcomeData.length;
        return outcomeData.map(d => ({ name: d.name, value: (d.value / total) * usable + outerPad }));
    })();

    // Anneau interne : les séparations sont des secteurs « Gap » transparents
    // (padding 0, spans purement proportionnels). Chaque voisin en absorbe la
    // moitié — survoler l'espace entre Directs et File sélectionne le canal
    // le plus proche, jamais rien. Les frontières entre secteurs pleins
    // voisins ne bougent pas (leurs valeurs sont inchangées).
    const innerHit = (() => {
        const entries = innerData.map((d, i) => ({ i, name: d.name, value: d.value, spacer: d.color === "transparent" }));
        const total = entries.reduce((sum, d) => sum + d.value, 0);
        if (total <= 0 || !entries.some(d => !d.spacer)) return { data: [], startAngle: -90 };
        const values = entries.map(d => (d.spacer ? 0 : d.value));
        const n = entries.length;
        entries.forEach((d, i) => {
            if (!d.spacer) return;
            let prev = (i + n - 1) % n;
            while (entries[prev].spacer) prev = (prev + n - 1) % n;
            let next = (i + 1) % n;
            while (entries[next].spacer) next = (next + 1) % n;
            values[prev] += d.value / 2;
            values[next] += d.value / 2;
        });
        // Départ décalé : les « Gap » qui touchent la ligne de départ (queue
        // du tableau, puis tête) forment UNE zone blanche à cheval sur -90° ;
        // la première zone de détection doit commencer en son MILIEU, sinon
        // toutes les frontières glissent d'autant (bug attrapé par la preuve
        // géométrique : décalage uniforme d'une demi-gouttière).
        let lead = 0;
        for (const d of entries) { if (!d.spacer) break; lead += d.value; }
        let trail = 0;
        for (let i = n - 1; i >= 0 && entries[i].spacer; i--) trail += entries[i].value;
        const toDeg = (v: number) => (v / total) * 360;
        const startAngle = -90 + toDeg(lead) - toDeg(lead + trail) / 2;
        return { data: entries.filter(d => !d.spacer).map(d => ({ name: d.name, value: values[d.i] })), startAngle };
    })();

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
                        <div className="relative w-80 h-64" onMouseLeave={() => setFocus(null)}>
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
                                        paddingAngle={OUTER_PADDING}
                                        dataKey="value"
                                        stroke="none"
                                        label={renderOutcomeLabel}
                                        labelLine={false}
                                        isAnimationActive={entryAnimation}
                                        onAnimationEnd={() => setAnimatedKey(contextKey)}
                                    >
                                        {outcomeData.map((entry, index) => {
                                            const key = OUTCOME_KEYS[entry.name];
                                            const focused = focus?.kind === "outcome" && focus.key === key;
                                            return (
                                                <Cell
                                                    key={`outer-${index}`}
                                                    fill={entry.color}
                                                    opacity={cellOpacity("outcome", key)}
                                                    style={arcStyle(focused, 1.045)}
                                                />
                                            );
                                        })}
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
                                        isAnimationActive={entryAnimation}
                                    >
                                        {innerData.map((entry, index) => {
                                            const channel = entry.name.startsWith("Directs") ? "direct"
                                                : entry.name.startsWith("File") ? "queue" : null;
                                            const focused = channel !== null && focus?.kind === "channel" && focus.key === channel;
                                            return (
                                                <Cell
                                                    key={`inner-${index}`}
                                                    fill={entry.color === "transparent" ? "transparent" : (entry.hatched ? (entry.color === COLORS.directUnanswered ? "url(#hatch-blue)" : "url(#hatch-violet)") : entry.color)}
                                                    opacity={channel ? cellOpacity("channel", channel) : 1}
                                                    style={arcStyle(focused, 1.03)}
                                                />
                                            );
                                        })}
                                    </Pie>
                                    {/* MATRICE DE DÉTECTION (croquis utilisateur) :
                                        deux anneaux transparents et JOINTIFS, du
                                        bord du centre (r=38, le disque HTML couvre
                                        jusqu'à 40) à juste au-delà de l'anneau
                                        externe (r=100). Frontière radiale à 67.5 :
                                        le MILIEU du blanc entre les anneaux
                                        visuels (65 → 70). Les données `*HitData`
                                        absorbent gouttières et « Gap » : aucun
                                        trou angulaire non plus — chaque pixel du
                                        disque appartient à une zone. Aucun rendu,
                                        fill transparent. */}
                                    <Pie
                                        data={innerHit.data}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={38}
                                        outerRadius={67.5}
                                        paddingAngle={0}
                                        dataKey="value"
                                        stroke="none"
                                        startAngle={innerHit.startAngle}
                                        endAngle={innerHit.startAngle + 360}
                                        isAnimationActive={false}
                                        onMouseEnter={(entry: { name?: string; payload?: { name?: string } }) => {
                                            const name = entry?.name ?? entry?.payload?.name ?? "";
                                            if (name.startsWith("Directs")) setFocus({ kind: "channel", key: "direct" });
                                            else if (name.startsWith("File")) setFocus({ kind: "channel", key: "queue" });
                                        }}
                                        onMouseLeave={() => setFocus(null)}
                                    >
                                        {innerHit.data.map((entry, index) => (
                                            <Cell key={`hit-inner-${index}`} fill="transparent" style={{ outline: "none" }} />
                                        ))}
                                    </Pie>
                                    <Pie
                                        data={outcomeHitData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={67.5}
                                        outerRadius={100}
                                        paddingAngle={0}
                                        dataKey="value"
                                        stroke="none"
                                        startAngle={-outerPad / 2}
                                        endAngle={360 - outerPad / 2}
                                        isAnimationActive={false}
                                        onMouseEnter={(entry: { name?: string; payload?: { name?: string } }) => {
                                            const key = OUTCOME_KEYS[entry?.name ?? entry?.payload?.name ?? ""];
                                            if (key) setFocus({ kind: "outcome", key });
                                        }}
                                        onMouseLeave={() => setFocus(null)}
                                    >
                                        {outcomeHitData.map((entry, index) => (
                                            <Cell key={`hit-outer-${index}`} fill="transparent" style={{ outline: "none" }} />
                                        ))}
                                    </Pie>
                                </PieChart>
                            </ResponsiveContainer>
                            {/* Centre du Donut */}
                            {/* pointer-events-none : ce calque couvre TOUT le
                                graphique, pas seulement le trou — sans cela il
                                intercepte les survols destinés aux arcs (bug de
                                réciprocité constaté). Le contenu réel les
                                réactive pour rester interactif. */}
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                {/* Zone RONDE du trou : survoler le total illumine
                                    la vignette « Appels reçus » — et rien ne
                                    s'estompe, tout appartient au total. Le disque
                                    se grise légèrement en retour, y compris quand
                                    c'est la vignette qui est survolée. */}
                                <div
                                    className={`pointer-events-auto flex h-20 w-20 cursor-default flex-col items-center justify-center rounded-full text-center transition-colors ${focus?.kind === "total" ? "bg-slate-100" : ""}`}
                                    {...focusHandlers({ kind: "total" })}
                                >
                                    <div className="text-3xl font-bold text-slate-900">{totalReceived}</div>
                                    <div className="text-xs text-slate-500">Total</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Colonne droite : KPIs + Détails */}
                    <div className="lg:col-span-8 space-y-4">
                        {/* KPI Cards Grid */}
                        {/* MATRICE DE DÉTECTION (croquis utilisateur) : les
                            enveloppes de survol se touchent bord à bord — la
                            gouttière visuelle vient du padding des enveloppes,
                            plus d'espace mort entre vignettes ni entre blocs.
                            Le -m-1.5 compense pour un rendu au pixel près. */}
                        <div className="-m-1.5">
                        <div className="grid grid-cols-2 md:grid-cols-4">
                            {/* Total Reçus — le dénominateur reste NEUTRE : un
                                volume n'est ni bon ni mauvais, et le bleu est
                                réservé au canal « directs ». */}
                            <div className="flex p-1.5" {...focusHandlers({ kind: "total" })}>
                            <TileShell
                                href={outcomeLink(outcomesForBucket("received"))}
                                toneClass={`bg-slate-50 border-slate-200 ${focus?.kind === "total" ? "ring-2 ring-slate-400 -translate-y-px shadow-md" : ""}`}
                                hoverClass="hover:border-blue-300"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1.5">
                                        <PhoneIncoming className="h-4 w-4 text-blue-600" />
                                        <span className="text-xs font-medium text-slate-600">Appels reçus</span>
                                    </div>
                                    <TrendPill current={totalReceived} previous={prevOf((t) => t.totalReceived)} sense="neutral" />
                                </div>
                                <div className="text-2xl font-bold text-slate-900">{totalReceived}</div>
                                {/* Paires label:valeur insécables : quand la ligne
                                    se coupe, elle se coupe AVANT une paire entière
                                    — « Transférés: 13 » passe à la ligne d'un
                                    bloc, jamais le nombre seul. Le « i » du coin
                                    inférieur droit porte la définition de la
                                    vignette (avant : infobulle invisible sur le
                                    libellé) — même icône que dans les colonnes du
                                    tableau des agents. */}
                                <div className="mt-auto flex items-end justify-between gap-1.5 pt-0.5">
                                    <div className="text-[10px] text-slate-500">
                                        Directs:&nbsp;{kpis.teamDirectReceived}&nbsp;· Équipe:&nbsp;{kpis.callsReceived}
                                    </div>
                                    <Tip content="Tous les appels arrivés pour l'équipe sur la période.">
                                        <Info className="h-3 w-3 flex-shrink-0 text-slate-400 hover:text-slate-600" />
                                    </Tip>
                                </div>
                            </TileShell>
                            </div>

                            {/* Répondus */}
                            <div className="flex p-1.5" {...focusHandlers({ kind: "outcome", key: "answered" })}>
                            <TileShell
                                href={outcomeLink(outcomesForBucket("answered"))}
                                toneClass={`bg-emerald-50/50 border-emerald-200 ${focus?.kind === "outcome" && focus.key === "answered" ? "ring-2 ring-emerald-400 -translate-y-px shadow-md" : ""}`}
                                hoverClass="hover:border-emerald-300"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1.5">
                                        <Phone className="h-4 w-4 text-emerald-600" />
                                        <span className="text-xs font-medium text-emerald-900">Appels répondus</span>
                                    </div>
                                    <TrendPill current={totalAnswered} previous={prevOf((t) => t.totalAnswered)} sense="higher-better" />
                                </div>
                                <div className="text-2xl font-bold text-emerald-700">{totalAnswered}</div>
                                <div className="mt-auto flex items-end justify-between gap-1.5 pt-0.5">
                                    <div className="text-[10px] text-emerald-600">
                                        Directs:&nbsp;{kpis.teamDirectAnswered}&nbsp;· Équipe:&nbsp;{kpis.callsAnswered}{totalHandedOff > 0 && <>&nbsp;· Transférés:&nbsp;{totalHandedOff}</>}
                                    </div>
                                    <Tip content="Appels décrochés par un membre de l'équipe — y compris ceux ensuite transférés.">
                                        <Info className="h-3 w-3 flex-shrink-0 text-slate-400 hover:text-slate-600" />
                                    </Tip>
                                </div>
                            </TileShell>
                            </div>

                            {/* Débordements — partis SANS décroché ici, file +
                                directs : le lien inclut les directs (team) pour
                                lister la même population. Les transferts
                                accomplis vivent dans la vignette Répondus.
                                AVANT Perdus : l'ordre des vignettes suit celui
                                des segments de la barre (vert, ambre, rouge). */}
                            <div className="flex p-1.5" {...focusHandlers({ kind: "outcome", key: "overflow" })}>
                            <TileShell
                                href={outcomeLink(outcomesForBucket("overflow"))}
                                toneClass={`bg-amber-50/50 border-amber-200 ${focus?.kind === "outcome" && focus.key === "overflow" ? "ring-2 ring-amber-400 -translate-y-px shadow-md" : ""}`}
                                hoverClass="hover:border-amber-300"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1.5">
                                        <ArrowRightLeft className="h-4 w-4 text-amber-600" />
                                        <span className="text-xs font-medium text-amber-900">Appels débordés</span>
                                    </div>
                                    <TrendPill current={totalOverflow} previous={prevOf((t) => t.totalRedirected)} sense="neutral" />
                                </div>
                                <div className="text-2xl font-bold text-amber-700">{totalOverflow}</div>
                                <div className="mt-auto flex items-end justify-between gap-1.5 pt-0.5">
                                    <div className="text-[10px] text-amber-600">
                                        Directs:&nbsp;{kpis.directOverflow}&nbsp;· Équipe:&nbsp;{kpis.callsOverflow}
                                    </div>
                                    <Tip content="Appels renvoyés automatiquement vers une autre équipe, personne n'ayant décroché ici à temps.">
                                        <Info className="h-3 w-3 flex-shrink-0 text-slate-400 hover:text-slate-600" />
                                    </Tip>
                                </div>
                            </TileShell>
                            </div>

                            {/* Perdus */}
                            <div className="flex p-1.5" {...focusHandlers({ kind: "outcome", key: "lost" })}>
                            <TileShell
                                href={outcomeLink(outcomesForBucket("lost"))}
                                toneClass={`bg-red-50/50 border-red-200 ${focus?.kind === "outcome" && focus.key === "lost" ? "ring-2 ring-red-400 -translate-y-px shadow-md" : ""}`}
                                hoverClass="hover:border-red-300"
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1.5">
                                        <PhoneMissed className="h-4 w-4 text-red-600" />
                                        <span className="text-xs font-medium text-red-900">Appels perdus</span>
                                    </div>
                                    <TrendPill current={totalLost} previous={prevOf((t) => t.totalLost)} sense="lower-better" />
                                </div>
                                <div className="text-2xl font-bold text-red-700">{totalLost}</div>
                                <div className="mt-auto flex items-end justify-between gap-1.5 pt-0.5">
                                    <div className="text-[10px] text-red-600">
                                        Directs:&nbsp;{kpis.directLost}&nbsp;· Équipe:&nbsp;{sumBucket(kpis.outcomeCounts, "lost")}
                                    </div>
                                    <Tip content="Appels restés sans réponse : l'appelant a raccroché sans avoir été servi.">
                                        <Info className="h-3 w-3 flex-shrink-0 text-slate-400 hover:text-slate-600" />
                                    </Tip>
                                </div>
                            </TileShell>
                            </div>

                        </div>

                        {/* Détails Directs vs File (compact) — enveloppes
                            jointives : pb 6 px de la grille + pt 10 px = les
                            16 px d'avant ; 4 px + 4 px = les 8 px entre blocs. */}
                        <div className="px-1.5 pt-2.5 pb-1" {...focusHandlers({ kind: "channel", key: "direct" })}>
                            {/* Directs */}
                            <div
                                className={`flex items-center justify-between p-2.5 rounded-lg bg-blue-50/50 border border-blue-100 transition-all ${focus?.kind === "channel" && focus.key === "direct" ? "ring-2 ring-blue-400 -translate-y-px shadow-md" : ""}`}
                            >
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                        {/* Le « i » remplace la pastille de couleur :
                                            le fond teinté suffit à dire le canal, la
                                            légende vit désormais sur les chiffres. */}
                                        <Tip content="Appels arrivés sur la ligne directe d'un collaborateur, jamais distribués au reste de l'équipe.">
                                            <Info className="h-3 w-3 flex-shrink-0 text-slate-400 hover:text-slate-600" />
                                        </Tip>
                                        <span className="text-sm font-medium text-blue-900">Appels Directs</span>
                                    </div>
                                </div>
                                {/* La légende de l'anneau vit SUR les chiffres :
                                    chaque segment (plein, clair, hachuré cerclé)
                                    porte sa pastille devant son nombre ; « Reçus »
                                    porte un anneau vide — le contour qui contient
                                    les trois segments, pas un segment de plus. La
                                    ligne se vérifie d'elle-même :
                                    Répondus + Transférés + Non aboutis = Reçus. */}
                                <div className="flex items-center gap-5 text-sm">
                                    <div className="text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-blue-500" />
                                            <span className="font-bold text-blue-700">{kpis.teamDirectReceived}</span>
                                        </div>
                                        <Tip content="Tout le canal : répondus + transférés + non aboutis.">
                                            <div className="text-[10px] text-blue-600">Reçus</div>
                                        </Tip>
                                    </div>
                                    <div className="text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                                            <span className="font-bold text-blue-700">{kpis.teamDirectAnswered}</span>
                                        </div>
                                        <div className="text-[10px] text-blue-600">Répondus</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            <span className="h-2.5 w-2.5 rounded-full bg-blue-300" />
                                            <span className="font-bold text-blue-400">{kpis.directHandedOff}</span>
                                        </div>
                                        <div className="text-[10px] text-blue-600">Transférés</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            <span className="h-2.5 w-2.5 rounded-full border border-blue-400" style={{ background: "repeating-linear-gradient(45deg, #3b82f6 0 1.5px, transparent 1.5px 3.5px)" }} />
                                            <span className="font-bold text-blue-700">{directUnanswered}</span>
                                        </div>
                                        <Tip content="Ni répondus ici, ni transférés : les perdus et les débordés de ce canal.">
                                            <div className="text-[10px] text-blue-600">Non aboutis</div>
                                        </Tip>
                                    </div>
                                    <div className="text-center">
                                        {/* Le taux garde la couleur de son bloc et ne
                                            vire qu'au ROUGE, sous 60 % : le vert et
                                            l'ambre appartiennent au registre des sorts
                                            (répondus, débordés) — les réutiliser ici
                                            faisait trois grammaires de couleur sur un
                                            même écran. Seule l'alerte parle encore. */}
                                        <Tip content="Prise en charge du bloc : (répondus + transférés) / reçus">
                                            <div className={`font-bold ${directRate >= 60 ? 'text-blue-700' : 'text-red-700'}`}>
                                                {directRate}%
                                            </div>
                                        </Tip>
                                        <div className="text-[10px] text-blue-600">Taux</div>
                                    </div>
                                </div>
                            </div>

                        </div>
                        <div className="px-1.5 pt-1 pb-1.5" {...focusHandlers({ kind: "channel", key: "queue" })}>
                            {/* File */}
                            <div
                                className={`flex items-center justify-between p-2.5 rounded-lg bg-violet-50/50 border border-violet-100 transition-all ${focus?.kind === "channel" && focus.key === "queue" ? "ring-2 ring-violet-400 -translate-y-px shadow-md" : ""}`}
                            >
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                        <Tip content="Appels distribués à toute l'équipe — le plus souvent après avoir sonné sans réponse sur une ligne directe, parfois en arrivant directement sur le numéro commun.">
                                            <Info className="h-3 w-3 flex-shrink-0 text-slate-400 hover:text-slate-600" />
                                        </Tip>
                                        <span className="text-sm font-medium text-violet-900">Appels d'équipe</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-5 text-sm">
                                    <div className="text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-violet-500" />
                                            <span className="font-bold text-violet-700">{kpis.callsReceived}</span>
                                        </div>
                                        <Tip content="Tout le canal : répondus + transférés + non aboutis.">
                                            <div className="text-[10px] text-violet-600">Reçus</div>
                                        </Tip>
                                    </div>
                                    <div className="text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
                                            <span className="font-bold text-violet-700">{kpis.callsAnswered}</span>
                                        </div>
                                        <div className="text-[10px] text-violet-600">Répondus</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            <span className="h-2.5 w-2.5 rounded-full bg-violet-300" />
                                            <span className="font-bold text-violet-400">{kpis.callsHandedOff}</span>
                                        </div>
                                        <div className="text-[10px] text-violet-600">Transférés</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            <span className="h-2.5 w-2.5 rounded-full border border-violet-400" style={{ background: "repeating-linear-gradient(45deg, #8b5cf6 0 1.5px, transparent 1.5px 3.5px)" }} />
                                            <span className="font-bold text-violet-700">{queueUnanswered}</span>
                                        </div>
                                        <Tip content="Ni répondus ici, ni transférés : les perdus et les débordés de ce canal.">
                                            <div className="text-[10px] text-violet-600">Non aboutis</div>
                                        </Tip>
                                    </div>
                                    <div className="text-center">
                                        <Tip content="Prise en charge du bloc : (répondus + transférés) / reçus">
                                            <div className={`font-bold ${queueRate >= 60 ? 'text-violet-700' : 'text-red-700'}`}>
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
                </div>
            </CardContent>
        </Card>
    );
}
