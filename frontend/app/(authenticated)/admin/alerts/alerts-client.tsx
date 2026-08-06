"use client";

/**
 * Écran de détail des alertes : le tableau complet derrière la cloche du
 * header. Cliquer une ligne ouvre les PREUVES de la détection (renvois avec
 * IDs d'appels — cliquables vers les logs —, dernier signe de vie, activité
 * de la file). Ignorer est GLOBAL (tous lecteurs), tracé, sans confirmation —
 * et réversible depuis l'onglet Ignorées : rien ne disparaît jamais vraiment.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, EyeOff, RotateCcw } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getSelectedServer } from "@/lib/selected-server";
import { getAlerts, ignoreAlert, restoreAlert, type IgnoredAlert } from "@/services/notifications.service";
import type { AnomalyAlert } from "@/services/repositories/anomaly-detector";

/** Le « Q » de la 3CX — le glyphe exact de l'interface (SVG fourni),
 *  couleur héritée du parent (currentColor). */
function QIcon({ className }: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" fill="currentColor" aria-hidden className={className}>
            <path d="M160 320C160 408.4 231.6 480 320 480C348.9 480 376 472.3 399.4 458.9L327.4 372.5C316.1 358.9 317.9 338.7 331.5 327.4C345.1 316.1 365.3 317.9 376.6 331.5L447.5 416.6C467.9 389.8 480 356.3 480 320C480 231.6 408.4 160 320 160C231.6 160 160 231.6 160 320zM440.9 508.6C406 531 364.5 544 320 544C196.3 544 96 443.7 96 320C96 196.3 196.3 96 320 96C443.7 96 544 196.3 544 320C544 376.1 523.4 427.4 489.3 466.7L536.6 523.5C547.9 537.1 546.1 557.3 532.5 568.6C518.9 579.9 498.7 578.1 487.4 564.5L440.8 508.6z" />
        </svg>
    );
}

function TypeCell({ type }: { type: AnomalyAlert["type"] }) {
    if (type === "queue_disconnected") {
        // Fond rouge sans radius : toute la file est hors Q.
        return (
            <span className="inline-flex items-center bg-red-500 px-2 py-1 text-xs font-semibold text-white">
                File déconnectée
            </span>
        );
    }
    if (type === "away_forgotten") {
        // Le surlignage orange sans radius, comme la pastille de statut 3CX.
        return (
            <span className="inline-flex items-center bg-orange-300 px-2 py-1 text-xs font-semibold text-orange-950">
                Absent
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 border border-slate-600 bg-white px-2 py-1 text-xs font-medium text-slate-700">
            <span className="shrink-0" style={{ color: "#0098C9" }}>
                <QIcon className="h-3.5 w-3.5" />
            </span>
            Déconnecté
        </span>
    );
}

/** Le « signal » varie selon le type : DURÉE de l'épisode d'absence pour les
 *  statuts Absent (depuis quand il renvoie ses appels — plus parlant que la
 *  date du dernier renvoi), dernière sollicitation pour les déconnexions. */
function SignalCell({ alert }: { alert: AnomalyAlert }) {
    if (alert.type === "away_forgotten") {
        const since = alert.awaySince ?? alert.lastAwayAt;
        if (!since) return <span className="text-slate-400">—</span>;
        return (
            <Tip content={`Premier renvoi de l'épisode : ${format(new Date(since), "dd/MM/yyyy HH:mm", { locale: fr })}`}>
                <span>
                    <span className="text-slate-700">
                        depuis {formatDistanceToNow(new Date(since), { locale: fr })}
                    </span>
                    <span className="block text-xs text-slate-400">renvoie ses appels (Absent)</span>
                </span>
            </Tip>
        );
    }
    if (!alert.lastPollAt) return <span className="text-slate-400">—</span>;
    return (
        <Tip content={format(new Date(alert.lastPollAt), "dd/MM/yyyy HH:mm", { locale: fr })}>
            <span>
                <span className="text-slate-700">
                    {formatDistanceToNow(new Date(alert.lastPollAt), { addSuffix: true, locale: fr })}
                </span>
                <span className="block text-xs text-slate-400">dernière sollicitation file</span>
            </span>
        </Tip>
    );
}

function AgentsCell({ alert }: { alert: AnomalyAlert }) {
    if (alert.type !== "queue_disconnected") {
        return (
            <>
                <p className="font-medium text-slate-900">{alert.agentName}</p>
                <p className="text-xs font-mono text-slate-500">Ext. {alert.agentExtension}</p>
            </>
        );
    }
    const count = alert.activeMembers?.length ?? 0;
    return (
        <p className="text-slate-700">
            {count} membre{count > 1 ? "s" : ""} actif{count > 1 ? "s" : ""} hors file
            {alert.activeMembers && count > 0 && (
                <span className="block text-xs text-slate-500">
                    {alert.activeMembers.map((m) => m.name).join(", ")}
                </span>
            )}
        </p>
    );
}

function EvidenceRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
            <span className="text-sm text-slate-500">{label}</span>
            <span className="text-right text-sm text-slate-800">{children}</span>
        </div>
    );
}

function fmt(at: string | null | undefined): string {
    return at ? format(new Date(at), "EEE dd/MM HH:mm", { locale: fr }) : "—";
}

/** Lien vers l'appel dans les logs — avec la période du jour de l'appel :
 *  sans elle, les logs s'ouvriraient sur leur période par défaut (le mois
 *  passé) et ne trouveraient pas un appel de cette semaine. */
function logHref(callHistoryId: string, at: string): string {
    const day = new Date(at);
    const before = new Date(day.getTime() - 24 * 3600 * 1000);
    const after = new Date(day.getTime() + 24 * 3600 * 1000);
    return `/admin/logs?id=${callHistoryId}&start=${format(before, "yyyy-MM-dd")}&end=${format(after, "yyyy-MM-dd")}`;
}

/** Les preuves brutes de la détection : des appels (et des absences d'appels),
 *  pas des phrases. Les IDs mènent au log correspondant. */
function EvidenceModal({ alert, onClose }: { alert: AnomalyAlert | null; onClose: () => void }) {
    return (
        <Dialog open={alert !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-lg">
                {alert && (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-3">
                                <TypeCell type={alert.type} />
                            </DialogTitle>
                        </DialogHeader>
                        <p className="text-sm text-slate-600">
                            {alert.type === "queue_disconnected"
                                ? <>File {alert.queueNumber} · {alert.queueName}</>
                                : <>{alert.agentName} (Ext. {alert.agentExtension}) · file {alert.queueNumber} {alert.queueName}</>}
                        </p>

                        <div>
                            <EvidenceRow label="Dernière sollicitation par la file">
                                {fmt(alert.lastPollAt)}
                            </EvidenceRow>
                            <EvidenceRow label="Sollicitations distribuées par la file (fenêtre)">
                                {alert.queuePollsInWindow ?? 0}
                            </EvidenceRow>
                            {alert.type !== "queue_disconnected" && (
                                <EvidenceRow label="Dernier signe de vie du poste">
                                    {fmt(alert.lastActivityAt)}
                                </EvidenceRow>
                            )}
                            {alert.type === "away_forgotten" && (
                                <EvidenceRow label="Renvoie ses appels depuis">
                                    {fmt(alert.awaySince ?? alert.lastAwayAt)}
                                </EvidenceRow>
                            )}
                            {alert.type === "queue_disconnected" && alert.activeMembers && (
                                <EvidenceRow label="Signes de vie des membres">
                                    <span className="space-y-0.5">
                                        {alert.activeMembers.map((m) => (
                                            <span key={m.extension} className="block">
                                                {m.name} · {fmt(m.lastActivityAt)}
                                            </span>
                                        ))}
                                    </span>
                                </EvidenceRow>
                            )}
                        </div>

                        {alert.type === "away_forgotten" && alert.awayCalls && alert.awayCalls.length > 0 && (
                            <div>
                                <p className="mb-1 text-sm font-medium text-slate-700">
                                    Appels directs renvoyés pour absence
                                </p>
                                <div className="max-h-44 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2">
                                    {alert.awayCalls.map((c) => (
                                        <p key={`${c.callHistoryId}-${c.at}`} className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
                                            <span className="text-slate-600">{fmt(c.at)}</span>
                                            <Link
                                                href={logHref(c.callHistoryId, c.at)}
                                                className="font-mono text-blue-600 hover:underline"
                                            >
                                                {c.callHistoryId}
                                            </Link>
                                        </p>
                                    ))}
                                </div>
                            </div>
                        )}

                        <p className="text-xs text-slate-400">
                            Fenêtre d'observation glissante — les identifiants ouvrent l'appel dans les logs.
                        </p>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

export default function AlertsClient() {
    const [alerts, setAlerts] = useState<AnomalyAlert[] | null>(null);
    const [ignored, setIgnored] = useState<IgnoredAlert[]>([]);
    const [windowDays, setWindowDays] = useState(7);
    const [tab, setTab] = useState<"active" | "ignored">("active");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [inspected, setInspected] = useState<AnomalyAlert | null>(null);

    const load = useCallback(() => {
        getAlerts(getSelectedServer())
            .then((payload) => {
                setAlerts(payload.allowed ? payload.alerts : []);
                setIgnored(payload.allowed ? payload.ignored : []);
                setWindowDays(payload.windowDays);
            })
            .catch(() => setAlerts([]));
    }, []);

    useEffect(() => { load(); }, [load]);

    const onIgnore = async (alertId: string) => {
        setBusyId(alertId);
        try {
            await ignoreAlert(getSelectedServer(), alertId);
            load();
        } catch {
            toast.error("Impossible d'ignorer cette alerte");
        } finally {
            setBusyId(null);
        }
    };

    const onRestore = async (alertId: string) => {
        setBusyId(alertId);
        try {
            await restoreAlert(getSelectedServer(), alertId);
            load();
        } catch {
            toast.error("Impossible de restaurer cette alerte");
        } finally {
            setBusyId(null);
        }
    };

    const rows: Array<{ alert: AnomalyAlert; meta?: IgnoredAlert }> = tab === "active"
        ? (alerts ?? []).map((alert) => ({ alert }))
        : ignored.map((meta) => ({ alert: meta.alert, meta }));

    return (
        <div className="p-8 max-w-[1200px] mx-auto space-y-6">
            {/* Titre porté par le header de l'application. */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">Comment ces anomalies sont détectées</p>
                    <p className="opacity-90">
                        L'état temps réel de la 3CX n'est pas dans les données d'appels : on détecte sa
                        signature sur les {windowDays} derniers jours. Une équipe connue dont la file ne
                        sollicite personne — alors que ses membres passent des appels par ailleurs — est
                        probablement déconnectée de sa file (bouton « Q »). Un membre jamais sollicité alors
                        que la file distribue est signalé individuellement ; si ses appels directs sont
                        renvoyés pour cause d'absence, c'est son statut Absent qui a probablement été oublié.
                        Cliquez une ligne pour voir les preuves. Les alertes s'éteignent d'elles-mêmes quand
                        la situation rentre dans l'ordre ; « Ignorer » est partagé entre tous les lecteurs,
                        tracé, et réversible ici même.
                    </p>
                </div>
            </div>

            <div className="flex gap-1 border-b border-slate-200">
                {([
                    { id: "active" as const, label: `Actives (${alerts?.length ?? "…"})` },
                    { id: "ignored" as const, label: `Ignorées (${ignored.length})` },
                ]).map((t) => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={cn(
                            "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                            tab === t.id
                                ? "border-blue-600 text-blue-700"
                                : "border-transparent text-slate-500 hover:text-slate-800",
                        )}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <Card className="border-slate-200 shadow-sm overflow-hidden">
                {alerts === null ? (
                    <p className="px-6 py-12 text-center text-sm text-slate-500">Chargement…</p>
                ) : rows.length === 0 ? (
                    <p className="px-6 py-12 text-center text-sm text-slate-500">
                        {tab === "active"
                            ? `Aucune anomalie détectée sur les ${windowDays} derniers jours dans votre périmètre.`
                            : "Aucune alerte ignorée en ce moment."}
                    </p>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                                <th className="px-4 py-3 text-center">Type</th>
                                <th className="px-4 py-3">File</th>
                                <th className="px-4 py-3">Agent(s) concerné(s)</th>
                                <th className="px-4 py-3">Dernier signal</th>
                                <th className="px-4 py-3 text-right">{tab === "ignored" ? "Ignorée" : ""}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {rows.map(({ alert: a, meta }) => (
                                <tr
                                    key={a.id}
                                    onClick={() => setInspected(a)}
                                    className="cursor-pointer hover:bg-slate-50 transition-colors"
                                >
                                    <td className="px-4 py-3 text-center"><TypeCell type={a.type} /></td>
                                    <td className="px-4 py-3">
                                        <p className="font-medium text-slate-900">{a.queueName}</p>
                                        <p className="text-xs font-mono text-slate-500">File {a.queueNumber}</p>
                                    </td>
                                    <td className="px-4 py-3"><AgentsCell alert={a} /></td>
                                    <td className="px-4 py-3"><SignalCell alert={a} /></td>
                                    <td className="px-4 py-3 text-right">
                                        {tab === "active" ? (
                                            <Tip content="Ignorer pour tous les lecteurs — réversible depuis l'onglet Ignorées">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    disabled={busyId === a.id}
                                                    onClick={(e) => { e.stopPropagation(); onIgnore(a.id); }}
                                                    className="h-7 w-7 text-slate-400 hover:text-slate-700"
                                                >
                                                    <EyeOff className="h-4 w-4" />
                                                </Button>
                                            </Tip>
                                        ) : (
                                            <div className="flex items-center justify-end gap-2">
                                                <span className="text-xs text-slate-500">
                                                    par {meta!.ignoredByName} le {format(new Date(meta!.ignoredAt), "dd/MM/yyyy", { locale: fr })}
                                                </span>
                                                <Tip content="Restaurer cette alerte">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        disabled={busyId === a.id}
                                                        onClick={(e) => { e.stopPropagation(); onRestore(a.id); }}
                                                        className="h-7 w-7 text-slate-400 hover:text-slate-700"
                                                    >
                                                        <RotateCcw className="h-4 w-4" />
                                                    </Button>
                                                </Tip>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Card>

            <EvidenceModal alert={inspected} onClose={() => setInspected(null)} />
        </div>
    );
}
