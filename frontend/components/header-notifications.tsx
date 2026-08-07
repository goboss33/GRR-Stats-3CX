"use client";

/**
 * Cloche d'alertes du header : aperçu des anomalies détectées (agents ou
 * équipes déconnectés de leur file), avec lien vers l'écran de détail.
 *
 * Le composant n'est monté que si le lecteur a le droit de voir la cloche
 * (cf. lib/notification-access) ; le service re-vérifie de toute façon. Les
 * alertes sont sans état : pas de lu/non-lu, elles s'éteignent d'elles-mêmes
 * quand l'anomalie cesse.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Clock, PhoneOff, UserX } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import { getSelectedServer } from "@/lib/selected-server";
import { getAlerts } from "@/services/notifications.service";
import type { AnomalyAlert } from "@/services/repositories/anomaly-detector";

const PREVIEW_COUNT = 6;

export function HeaderNotifications() {
    const [alerts, setAlerts] = useState<AnomalyAlert[] | null>(null);
    const [windowDays, setWindowDays] = useState(7);

    useEffect(() => {
        getAlerts(getSelectedServer())
            .then((payload) => {
                if (!payload.allowed) return;
                setAlerts(payload.alerts);
                setWindowDays(payload.windowDays);
            })
            .catch(() => undefined);
    }, []);

    const count = alerts?.length ?? 0;

    return (
        <Popover>
            <Tip content={count > 0 ? `${count} anomalie${count > 1 ? "s" : ""} détectée${count > 1 ? "s" : ""}` : "Aucune anomalie détectée"}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="icon"
                        className="relative bg-white shadow-sm hover:bg-slate-50 transition-colors"
                    >
                        <Bell className="h-4 w-4 text-slate-600" />
                        {count > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white">
                                {count > 9 ? "9+" : count}
                            </span>
                        )}
                    </Button>
                </PopoverTrigger>
            </Tip>
            <PopoverContent className="w-96 p-0" align="end">
                <div className="border-b px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">Alertes</p>
                    <p className="text-xs text-slate-500">
                        Anomalies détectées sur les {windowDays} derniers jours, dans votre périmètre
                    </p>
                </div>
                <div className="max-h-80 overflow-y-auto">
                    {alerts === null ? (
                        <p className="px-4 py-6 text-center text-sm text-slate-500">Chargement…</p>
                    ) : count === 0 ? (
                        <p className="px-4 py-6 text-center text-sm text-slate-500">
                            Aucune anomalie détectée
                        </p>
                    ) : (
                        alerts.slice(0, PREVIEW_COUNT).map((a) => (
                            <div key={a.id} className="flex items-start gap-3 border-b px-4 py-3 last:border-b-0">
                                {a.type === "queue_disconnected"
                                    ? <PhoneOff className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                                    : a.type === "away_forgotten"
                                        ? <Clock className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                                        : <UserX className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-slate-900">
                                        {a.type === "queue_disconnected"
                                            ? `Équipe ${a.queueNumber} sans agent connecté`
                                            : a.type === "away_forgotten"
                                                ? `${a.agentName} en statut Absent — probablement oublié`
                                                : `${a.agentName} déconnecté de l'équipe ${a.queueNumber}`}
                                    </p>
                                    <p className="truncate text-xs text-slate-500">
                                        {a.queueName}
                                        {a.type === "away_forgotten" && (a.awaySince ?? a.lastAwayAt)
                                            ? <> · renvoie ses appels depuis {formatDistanceToNow(new Date((a.awaySince ?? a.lastAwayAt)!), { locale: fr })}</>
                                            : a.lastPollAt && (
                                                <> · dernière sollicitation {formatDistanceToNow(new Date(a.lastPollAt), { addSuffix: true, locale: fr })}</>
                                            )}
                                    </p>
                                </div>
                            </div>
                        ))
                    )}
                    {count > PREVIEW_COUNT && (
                        <p className="px-4 py-2 text-center text-xs text-slate-500">
                            + {count - PREVIEW_COUNT} autre{count - PREVIEW_COUNT > 1 ? "s" : ""}…
                        </p>
                    )}
                </div>
                <div className="border-t px-4 py-2.5">
                    <Link
                        href="/admin/alerts"
                        className="text-sm font-medium text-blue-600 hover:text-blue-700"
                    >
                        Voir le détail des alertes →
                    </Link>
                </div>
            </PopoverContent>
        </Popover>
    );
}
