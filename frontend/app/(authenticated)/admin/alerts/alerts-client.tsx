"use client";

/**
 * Écran de détail des alertes : le tableau complet derrière la cloche du
 * header. Sans état (pas de lu/non-lu) : une alerte disparaît d'elle-même
 * quand l'anomalie cesse — décision d'août 2026, à revoir à l'usage.
 */

import { useEffect, useState } from "react";
import { AlertCircle, PhoneOff, UserX } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import { getSelectedServer } from "@/lib/selected-server";
import { getAlerts } from "@/services/notifications.service";
import type { AnomalyAlert } from "@/services/repositories/anomaly-detector";

export default function AlertsClient() {
    const [alerts, setAlerts] = useState<AnomalyAlert[] | null>(null);
    const [windowDays, setWindowDays] = useState(7);

    useEffect(() => {
        getAlerts(getSelectedServer())
            .then((payload) => {
                setAlerts(payload.allowed ? payload.alerts : []);
                setWindowDays(payload.windowDays);
            })
            .catch(() => setAlerts([]));
    }, []);

    return (
        <div className="p-8 max-w-[1200px] mx-auto space-y-6">
            {/* Titre porté par le header de l'application. */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">Comment ces anomalies sont détectées</p>
                    <p className="opacity-90">
                        L'état du bouton « Q » de la 3CX n'est pas dans les données d'appels : on détecte sa
                        signature sur les {windowDays} derniers jours. Une équipe connue dont la file ne
                        sollicite personne — alors que ses membres décrochent ou émettent des appels par
                        ailleurs — est probablement déconnectée de sa file. Un membre jamais sollicité alors
                        que la file distribue est signalé individuellement. Les alertes s'éteignent
                        d'elles-mêmes quand la situation rentre dans l'ordre.
                    </p>
                </div>
            </div>

            <Card className="border-slate-200 shadow-sm overflow-hidden">
                {alerts === null ? (
                    <p className="px-6 py-12 text-center text-sm text-slate-500">Chargement…</p>
                ) : alerts.length === 0 ? (
                    <p className="px-6 py-12 text-center text-sm text-slate-500">
                        Aucune anomalie détectée sur les {windowDays} derniers jours dans votre périmètre.
                    </p>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                                <th className="px-4 py-3">Type</th>
                                <th className="px-4 py-3">File</th>
                                <th className="px-4 py-3">Agent(s) concerné(s)</th>
                                <th className="px-4 py-3">Dernière sollicitation</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {alerts.map((a) => (
                                <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-4 py-3">
                                        {a.type === "queue_disconnected" ? (
                                            <Badge variant="outline" className="gap-1.5 border-red-200 bg-red-50 text-red-700">
                                                <PhoneOff className="h-3.5 w-3.5" />
                                                File sans agent connecté
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline" className="gap-1.5 border-amber-200 bg-amber-50 text-amber-700">
                                                <UserX className="h-3.5 w-3.5" />
                                                Agent déconnecté (probable)
                                            </Badge>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <p className="font-medium text-slate-900">{a.queueName}</p>
                                        <p className="text-xs font-mono text-slate-500">File {a.queueNumber}</p>
                                    </td>
                                    <td className="px-4 py-3">
                                        {a.type === "agent_disconnected" ? (
                                            <>
                                                <p className="font-medium text-slate-900">{a.agentName}</p>
                                                <p className="text-xs font-mono text-slate-500">Ext. {a.agentExtension}</p>
                                            </>
                                        ) : (
                                            <p className="text-slate-700">
                                                {a.activeMembers?.length ?? 0} membre{(a.activeMembers?.length ?? 0) > 1 ? "s" : ""} actif{(a.activeMembers?.length ?? 0) > 1 ? "s" : ""} hors file
                                                {a.activeMembers && a.activeMembers.length > 0 && (
                                                    <span className="block text-xs text-slate-500">
                                                        {a.activeMembers.map((m) => m.name).join(", ")}
                                                    </span>
                                                )}
                                            </p>
                                        )}
                                    </td>
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
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Card>
        </div>
    );
}
