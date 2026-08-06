"use client";

/**
 * Carte de parcours d'une file — la configuration 3CX DÉDUITE des appels.
 *
 * Disposition en flux gauche → droite (le routage téléphonique est un flux
 * orienté) : entrées à l'ouest, la file au centre, issues à l'est, agents en
 * dessous. Épaisseur et opacité des routes ∝ √volume (une échelle linéaire
 * rendrait 5 appels invisibles à côté de 1500) ; les chiffres exacts restent
 * affichés. Couleurs des issues = la grammaire des vignettes (répondus vert,
 * raccrochés rouge, renvois ambre). Cliquer une file satellite re-centre la
 * carte sur elle (fil d'Ariane pour revenir) — la carte se navigue de proche
 * en proche.
 *
 * Nœuds en HTML positionné, routes en SVG sous-jacent : le texte, les icônes
 * et les infobulles restent du HTML normal.
 */

import { useCallback, useEffect, useState } from "react";
import {
    CircleHelp, FileCode2, ListTree, MinusCircle, PhoneCall, PhoneForwarded,
    PhoneIncoming, PhoneOff, User, Users, CheckCircle2,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tip } from "@/components/ui/tooltip";
import { QIcon } from "@/components/q-icon";
import { cn } from "@/lib/utils";
import { getSelectedServer } from "@/lib/selected-server";
import {
    getQueueTopology,
    type FlowKind, type FlowNode, type DownstreamFlow, type QueueTopology,
} from "@/services/queue-topology.service";

// ---- Géométrie des couloirs ----
const NODE_W = 240;
const NODE_H = 56;
const NODE_GAP = 12;
const CENTER_W = 250;
const CENTER_H = 128;
const LEFT_X = 8;
const CENTER_X = 356;
const RIGHT_X = 712;
const CANVAS_W = RIGHT_X + NODE_W + 8;

const KIND_ICONS: Record<FlowKind, React.ComponentType<{ className?: string }>> = {
    did: PhoneIncoming,
    script: FileCode2,
    ring_group: Users,
    extension: User,
    queue: QIcon,
    ivr: ListTree,
    direct_dial: PhoneCall,
    external: PhoneForwarded,
    other: CircleHelp,
};

const KIND_LABELS: Record<FlowKind, string> = {
    did: "SDA",
    script: "Script",
    ring_group: "Groupe d'appel",
    extension: "Renvoi de poste",
    queue: "File",
    ivr: "IVR",
    direct_dial: "Interne",
    external: "Externe",
    other: "Autre",
};

const REASON_LABELS: Record<string, string> = {
    no_answer: "non-réponse",
    no_destinations: "aucun agent",
    busy: "occupé",
    timeout: "délai dépassé",
    none: "renvoi",
};

interface RightItem {
    id: string;
    kind: "answered" | "abandoned" | "others" | "routed";
    flow?: DownstreamFlow;
    volume: number;
    height: number;
}

function scaleEdge(volume: number, maxVolume: number): { width: number; opacity: number } {
    if (maxVolume <= 0) return { width: 1.5, opacity: 0.35 };
    const t = Math.sqrt(volume / maxVolume);
    return { width: Math.max(1.5, 2 + 12 * t), opacity: 0.35 + 0.55 * t };
}

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
    const mid = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

function lastSeenTip(iso: string | null): string | undefined {
    if (!iso) return undefined;
    return `Dernier observé : ${format(new Date(iso), "dd/MM/yyyy HH:mm", { locale: fr })}`;
}

function NodeCard({ node, side, onNavigate }: {
    node: FlowNode & { reason?: string };
    side: "left" | "right";
    onNavigate?: (queueNumber: string, queueName: string) => void;
}) {
    const Icon = KIND_ICONS[node.kind];
    const clickable = node.kind === "queue" && node.number !== null && onNavigate !== undefined;
    const grouped = node.grouped
        ? `${node.grouped.slice(0, 15).map((g) => `${g.name} (${g.volume})`).join(", ")}${node.grouped.length > 15 ? "…" : ""}`
        : undefined;
    const body = (
        <div
            onClick={clickable ? () => onNavigate!(node.number!, node.name) : undefined}
            className={cn(
                "flex h-full items-center gap-2.5 rounded-2xl border bg-white px-3 shadow-sm",
                clickable ? "cursor-pointer border-sky-200 hover:border-sky-400 hover:shadow" : "border-slate-200",
            )}
        >
            <span className={cn("shrink-0", node.kind === "queue" ? "" : "text-slate-400")}
                style={node.kind === "queue" ? { color: "#0098C9" } : undefined}>
                <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-tight text-slate-800">{node.name}</span>
                <span className="block text-[11px] text-slate-400">
                    {KIND_LABELS[node.kind]}
                    {"reason" in node && node.reason ? ` · ${REASON_LABELS[node.reason] ?? node.reason}` : ""}
                </span>
            </span>
            <span className={cn(
                "shrink-0 text-[13px] font-semibold tabular-nums",
                side === "left" ? "text-slate-600" : "text-slate-700",
            )}>
                {node.volume.toLocaleString("fr-CH")}
            </span>
        </div>
    );
    const tip = [grouped, lastSeenTip(node.lastSeenAt)].filter(Boolean).join(" — ");
    return tip ? <Tip content={tip}>{body}</Tip> : body;
}

function TerminalCard({ icon: Icon, label, volume, tone }: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    volume: number;
    tone: "emerald" | "red" | "slate";
}) {
    const tones = {
        emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
        red: "border-red-200 bg-red-50 text-red-600",
        slate: "border-slate-200 bg-slate-50 text-slate-500",
    } as const;
    return (
        <div className={cn("flex h-full items-center gap-2.5 rounded-2xl border px-3 shadow-sm", tones[tone])}>
            <Icon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-tight">{label}</span>
            <span className="shrink-0 text-[13px] font-semibold tabular-nums">{volume.toLocaleString("fr-CH")}</span>
        </div>
    );
}

export function QueueFlowModal({ queueNumber, queueName, onClose }: {
    /** null = fermée. */
    queueNumber: string | null;
    queueName: string;
    onClose: () => void;
}) {
    const [topology, setTopology] = useState<QueueTopology | null>(null);
    const [loading, setLoading] = useState(false);
    // Fil d'Ariane de navigation ([0] = la file d'origine).
    const [trail, setTrail] = useState<Array<{ number: string; name: string }>>([]);

    const load = useCallback((num: string) => {
        setLoading(true);
        getQueueTopology(getSelectedServer(), num)
            .then((t) => setTopology(t))
            .catch(() => setTopology(null))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (!queueNumber) { setTopology(null); setTrail([]); return; }
        setTrail([{ number: queueNumber, name: queueName }]);
        load(queueNumber);
    }, [queueNumber, queueName, load]);

    const navigate = (num: string, name: string) => {
        setTrail((t) => [...t, { number: num, name }]);
        load(num);
    };
    const jumpTo = (index: number) => {
        setTrail((t) => t.slice(0, index + 1));
        load(trail[index].number);
    };

    // ---- Construction de la scène ----
    let scene: React.ReactNode = null;
    if (topology) {
        const left = topology.upstream;
        const right: RightItem[] = [];
        if (topology.answeredByTeam > 0) {
            right.push({ id: "answered", kind: "answered", volume: topology.answeredByTeam, height: NODE_H });
        }
        for (const flow of topology.downstream) {
            right.push({
                id: `routed|${flow.kind}|${flow.number ?? flow.name}`,
                kind: "routed",
                flow,
                volume: flow.volume,
                // Les files de destination portent leurs propres issues (profondeur 2).
                height: flow.kind === "queue" && flow.next ? NODE_H + 26 : NODE_H,
            });
        }
        if (topology.abandoned > 0) {
            right.push({ id: "abandoned", kind: "abandoned", volume: topology.abandoned, height: NODE_H });
        }
        if (topology.otherEndings > 0) {
            right.push({ id: "others", kind: "others", volume: topology.otherEndings, height: NODE_H });
        }

        const leftHeight = left.length * (NODE_H + NODE_GAP) - NODE_GAP;
        const rightHeight = right.reduce((acc, r) => acc + r.height + NODE_GAP, -NODE_GAP);
        const canvasH = Math.max(leftHeight, rightHeight, CENTER_H, 80) + 16;
        const centerY = canvasH / 2;

        const leftYs = left.map((_, i) => (canvasH - leftHeight) / 2 + i * (NODE_H + NODE_GAP));
        const rightYs: number[] = [];
        let cursor = (canvasH - rightHeight) / 2;
        for (const item of right) { rightYs.push(cursor); cursor += item.height + NODE_GAP; }

        const maxVolume = Math.max(
            1,
            ...left.map((n) => n.volume),
            ...right.map((r) => r.volume),
        );

        const edgeColor = (item: RightItem) =>
            item.kind === "answered" ? "#10b981"
            : item.kind === "abandoned" ? "#f87171"
            : item.kind === "others" ? "#94a3b8"
            : "#d97706";

        scene = (
            <div className="overflow-x-auto">
                <div className="relative" style={{ width: CANVAS_W, height: canvasH }}>
                    <svg className="absolute inset-0" width={CANVAS_W} height={canvasH} aria-hidden>
                        {left.map((node, i) => {
                            const { width, opacity } = scaleEdge(node.volume, maxVolume);
                            return (
                                <path key={`l${i}`} d={edgePath(LEFT_X + NODE_W, leftYs[i] + NODE_H / 2, CENTER_X, centerY)}
                                    fill="none" stroke="#94a3b8" strokeWidth={width} strokeOpacity={opacity} strokeLinecap="round" />
                            );
                        })}
                        {right.map((item, i) => {
                            const { width, opacity } = scaleEdge(item.volume, maxVolume);
                            return (
                                <path key={`r${i}`} d={edgePath(CENTER_X + CENTER_W, centerY, RIGHT_X, rightYs[i] + NODE_H / 2)}
                                    fill="none" stroke={edgeColor(item)} strokeWidth={width} strokeOpacity={opacity} strokeLinecap="round" />
                            );
                        })}
                    </svg>

                    {left.map((node, i) => (
                        <div key={`ln${i}`} className="absolute" style={{ left: LEFT_X, top: leftYs[i], width: NODE_W, height: NODE_H }}>
                            <NodeCard node={node} side="left" onNavigate={navigate} />
                        </div>
                    ))}

                    {/* La file au centre */}
                    <div className="absolute" style={{ left: CENTER_X, top: centerY - CENTER_H / 2, width: CENTER_W, height: CENTER_H }}>
                        <div className="flex h-full flex-col justify-center rounded-3xl border-2 bg-white px-4 shadow-md" style={{ borderColor: "#0098C9" }}>
                            <div className="flex items-center gap-2">
                                <span style={{ color: "#0098C9" }}><QIcon className="h-5 w-5" /></span>
                                <span className="font-mono text-xs text-slate-500">{topology.queueNumber}</span>
                            </div>
                            <p className="mt-1 truncate text-sm font-semibold text-slate-900">{topology.queueName}</p>
                            <p className="text-xs text-slate-500">
                                {topology.department ? `Département ${topology.department}` : "Sans département"}
                                {topology.strategy === "ring_all" && " · « Sonne tous »"}
                                {topology.strategy === "sequential" && " · Distribution séquentielle"}
                                {topology.strategy === "mixed" && " · Distribution mixte"}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">
                                {topology.totalPassages.toLocaleString("fr-CH")} passages · {topology.windowDays} jours
                            </p>
                        </div>
                    </div>

                    {right.map((item, i) => (
                        <div key={item.id} className="absolute" style={{ left: RIGHT_X, top: rightYs[i], width: NODE_W, height: item.height }}>
                            {item.kind === "answered" && (
                                <TerminalCard icon={CheckCircle2} label="Répondus par l'équipe" volume={item.volume} tone="emerald" />
                            )}
                            {item.kind === "abandoned" && (
                                <TerminalCard icon={PhoneOff} label="Raccrochés en attente" volume={item.volume} tone="red" />
                            )}
                            {item.kind === "others" && (
                                <TerminalCard icon={MinusCircle} label="Autres fins" volume={item.volume} tone="slate" />
                            )}
                            {item.kind === "routed" && item.flow && (
                                <div className="flex h-full flex-col">
                                    <div style={{ height: NODE_H }}>
                                        <NodeCard node={item.flow} side="right" onNavigate={navigate} />
                                    </div>
                                    {item.flow.next && (
                                        <p className="mt-0.5 truncate pl-3 text-[11px] text-slate-400">
                                            ↳ répondus {item.flow.next.answered}
                                            {item.flow.next.abandoned > 0 && ` · raccrochés ${item.flow.next.abandoned}`}
                                            {item.flow.next.routed.map((r) => ` · ${r.name} ${r.volume}`).join("")}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <Dialog open={queueNumber !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-6xl">
                <DialogHeader>
                    <DialogTitle className="flex flex-wrap items-center gap-1 text-base">
                        <span className="text-slate-500">Parcours d'appel ·</span>
                        {trail.map((step, i) => (
                            <span key={`${step.number}-${i}`} className="flex items-center gap-1">
                                {i > 0 && <span className="text-slate-300">›</span>}
                                {i < trail.length - 1 ? (
                                    <button type="button" onClick={() => jumpTo(i)} className="text-sky-600 hover:underline">
                                        {step.number}
                                    </button>
                                ) : (
                                    <span>{step.number} · {topology?.queueName ?? step.name}</span>
                                )}
                            </span>
                        ))}
                    </DialogTitle>
                </DialogHeader>

                {loading ? (
                    <p className="py-16 text-center text-sm text-slate-500">Analyse des 90 derniers jours…</p>
                ) : topology === null ? (
                    <p className="py-16 text-center text-sm text-slate-500">Impossible de déduire la topologie de cette file.</p>
                ) : topology.totalPassages === 0 && topology.agents.length === 0 ? (
                    <p className="py-16 text-center text-sm text-slate-500">
                        Aucun passage observé sur {topology.windowDays} jours — rien à cartographier.
                    </p>
                ) : (
                    <>
                        {scene}

                        {/* Les agents de la file, avec les états du détecteur d'alertes. */}
                        <div className="border-t pt-3">
                            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                                Agents sollicités (12 derniers mois) — répondus sur {topology.windowDays} jours
                            </p>
                            {topology.agents.length === 0 ? (
                                <p className="text-sm text-slate-400">Aucun agent sollicité.</p>
                            ) : (
                                <div className="flex flex-wrap gap-1.5">
                                    {topology.agents.map((agent) => (
                                        <Tip
                                            key={agent.extension}
                                            content={`Dernière sollicitation ${formatDistanceToNow(new Date(agent.lastPolledAt), { addSuffix: true, locale: fr })}${agent.status === "away" ? " — statut Absent (probable)" : agent.status === "disconnected" ? " — déconnecté de la file" : ""}`}
                                        >
                                            <span className={cn(
                                                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                                                agent.status === "connected" && "border-emerald-200 bg-emerald-50 text-emerald-800",
                                                agent.status === "disconnected" && "border-slate-200 bg-slate-50 text-slate-500",
                                                agent.status === "away" && "border-orange-200 bg-orange-50 text-orange-800",
                                            )}>
                                                <span className={cn(
                                                    "h-1.5 w-1.5 rounded-full",
                                                    agent.status === "connected" && "bg-emerald-500",
                                                    agent.status === "disconnected" && "bg-slate-400",
                                                    agent.status === "away" && "bg-orange-500",
                                                )} />
                                                {agent.name}
                                                <span className="font-mono text-[10px] text-slate-400">{agent.extension}</span>
                                                <span className="font-semibold tabular-nums">{agent.answered}</span>
                                            </span>
                                        </Tip>
                                    ))}
                                </div>
                            )}
                        </div>

                        <p className="text-[11px] leading-relaxed text-slate-400">
                            Configuration DÉDUITE des appels des {topology.windowDays} derniers jours — flux bruts par
                            passage, sans les règles de classement des statistiques. Un chemin configuré mais jamais
                            emprunté est invisible ; épaisseur et opacité des routes ∝ √volume ; cliquer une file
                            satellite re-centre la carte.
                        </p>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
