"use client";

/**
 * Écran de détail des alertes : le tableau complet derrière la cloche du
 * header. Ignorer est GLOBAL (tous lecteurs), tracé, sans confirmation — et
 * réversible depuis l'onglet Ignorées : rien ne disparaît jamais vraiment.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Clock, EyeOff, PhoneOff, RotateCcw, UserX } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getSelectedServer } from "@/lib/selected-server";
import { getAlerts, ignoreAlert, restoreAlert, type IgnoredAlert } from "@/services/notifications.service";
import type { AnomalyAlert } from "@/services/repositories/anomaly-detector";

function TypeBadge({ type }: { type: AnomalyAlert["type"] }) {
    if (type === "queue_disconnected") {
        return (
            <Badge variant="outline" className="gap-1.5 border-red-200 bg-red-50 text-red-700">
                <PhoneOff className="h-3.5 w-3.5" />
                File sans agent connecté
            </Badge>
        );
    }
    if (type === "away_forgotten") {
        return (
            <Badge variant="outline" className="gap-1.5 border-orange-200 bg-orange-50 text-orange-700">
                <Clock className="h-3.5 w-3.5" />
                Statut Absent oublié (probable)
            </Badge>
        );
    }
    return (
        <Badge variant="outline" className="gap-1.5 border-amber-200 bg-amber-50 text-amber-700">
            <UserX className="h-3.5 w-3.5" />
            Agent déconnecté (probable)
        </Badge>
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

export default function AlertsClient() {
    const [alerts, setAlerts] = useState<AnomalyAlert[] | null>(null);
    const [ignored, setIgnored] = useState<IgnoredAlert[]>([]);
    const [windowDays, setWindowDays] = useState(7);
    const [tab, setTab] = useState<"active" | "ignored">("active");
    const [busyId, setBusyId] = useState<string | null>(null);

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
                        Les alertes s'éteignent d'elles-mêmes quand la situation rentre dans l'ordre ;
                        « Ignorer » est partagé entre tous les lecteurs, tracé, et réversible ici même.
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
                                <th className="px-4 py-3">Type</th>
                                <th className="px-4 py-3">File</th>
                                <th className="px-4 py-3">Agent(s) concerné(s)</th>
                                <th className="px-4 py-3">Dernière sollicitation</th>
                                <th className="px-4 py-3 text-right">{tab === "ignored" ? "Ignorée" : ""}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {rows.map(({ alert: a, meta }) => (
                                <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-4 py-3"><TypeBadge type={a.type} /></td>
                                    <td className="px-4 py-3">
                                        <p className="font-medium text-slate-900">{a.queueName}</p>
                                        <p className="text-xs font-mono text-slate-500">File {a.queueNumber}</p>
                                    </td>
                                    <td className="px-4 py-3"><AgentsCell alert={a} /></td>
                                    <td className="px-4 py-3">
                                        {a.lastPollAt ? (
                                            <Tip content={format(new Date(a.lastPollAt), "dd/MM/yyyy HH:mm", { locale: fr })}>
                                                <span className="text-slate-700">
                                                    {formatDistanceToNow(new Date(a.lastPollAt), { addSuffix: true, locale: fr })}
                                                </span>
                                            </Tip>
                                        ) : (
                                            <span className="text-slate-400">—</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        {tab === "active" ? (
                                            <Tip content="Ignorer pour tous les lecteurs — réversible depuis l'onglet Ignorées">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    disabled={busyId === a.id}
                                                    onClick={() => onIgnore(a.id)}
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
                                                        onClick={() => onRestore(a.id)}
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
        </div>
    );
}
