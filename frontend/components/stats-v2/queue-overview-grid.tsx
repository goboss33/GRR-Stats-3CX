"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { QueueOverviewCard } from "@/components/stats-v2/queue-overview-card";
import { getQueueOverviewKpis } from "@/services/queue-statistics.service";
import { getSelectedServer } from "@/lib/selected-server";
import { logger } from "@/lib/logger";
import type { QueueInfo } from "@/types/queues.types";
import type { QueueKPIs } from "@/types/statistics.types";
import type { CallOrigin } from "@/services/domain/call-classification";

/**
 * Aperçu des groupes du périmètre — la grille de cartes de l'écran de
 * sélection.
 *
 * Chargement PROGRESSIF : la grille de squelettes s'affiche immédiatement
 * (la recherche au-dessus reste utilisable sans attendre), puis chaque carte
 * se remplit dès que sa réponse arrive. Les requêtes partent par vagues
 * (limite de concurrence) pour ne pas marteler la base — chaque carte coûte
 * la requête KPI du détail (~0,5 s), LA MÊME, pour que l'aperçu et le détail
 * affichent les mêmes chiffres par construction.
 *
 * Tri stable par numéro de file (des cartes qui se réordonnent pendant le
 * chargement seraient pénibles) ; les pastilles rouges font le repérage.
 * Les files sans appel sur la période sont repliées sous la grille.
 */

const CONCURRENCY = 5;

interface Props {
    queues: QueueInfo[];
    startDate: Date;
    endDate: Date;
    origin: CallOrigin;
    onSelect: (queueNumber: string, queueName: string) => void;
}

export function QueueOverviewGrid({ queues, startDate, endDate, origin, onSelect }: Props) {
    const [kpisByQueue, setKpisByQueue] = useState<Record<string, QueueKPIs>>({});
    // Files dont la requête a échoué : retirées de la grille plutôt que de
    // laisser un squelette éternel.
    const [failed, setFailed] = useState<Set<string>>(new Set());
    const contextKeyRef = useRef("");

    const sorted = useMemo(
        () => [...queues].sort((a, b) => a.queueNumber.localeCompare(b.queueNumber, undefined, { numeric: true })),
        [queues],
    );

    useEffect(() => {
        if (sorted.length === 0) return;
        const ctxKey = `${getSelectedServer()}|${startDate.toISOString()}|${endDate.toISOString()}|${origin}|${sorted.map((q) => q.queueNumber).join(",")}`;
        if (contextKeyRef.current === ctxKey) return;
        contextKeyRef.current = ctxKey;
        setKpisByQueue({});
        setFailed(new Set());

        const serverId = getSelectedServer();
        const pending = [...sorted];
        // Pool de travailleurs : CONCURRENCY requêtes en vol au maximum, les
        // réponses remplissent les cartes au fil de l'eau.
        const worker = async () => {
            for (;;) {
                const queue = pending.shift();
                if (!queue || contextKeyRef.current !== ctxKey) return;
                try {
                    const kpis = await getQueueOverviewKpis(serverId, queue.queueNumber, startDate, endDate, origin);
                    if (contextKeyRef.current !== ctxKey) return;
                    setKpisByQueue((current) => ({ ...current, [queue.queueNumber]: kpis }));
                } catch (error) {
                    logger.error("[QueueOverview] KPI en échec :", { queue: queue.queueNumber, error });
                    if (contextKeyRef.current !== ctxKey) return;
                    setFailed((current) => new Set(current).add(queue.queueNumber));
                }
            }
        };
        for (let i = 0; i < CONCURRENCY; i++) void worker();
    }, [sorted, startDate, endDate, origin]);

    if (sorted.length === 0) return null;

    // Une file « sans appel » ne l'est qu'une fois sa réponse arrivée.
    const isEmpty = (q: QueueInfo) => {
        const kpis = kpisByQueue[q.queueNumber];
        return kpis !== undefined && kpis.callsReceived + kpis.teamDirectReceived === 0;
    };
    const visible = sorted.filter((q) => !failed.has(q.queueNumber) && !isEmpty(q));
    const empty = sorted.filter((q) => isEmpty(q));

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visible.map((q) => (
                    <QueueOverviewCard
                        key={q.queueNumber}
                        queueNumber={q.queueNumber}
                        queueName={q.queueName}
                        kpis={kpisByQueue[q.queueNumber] ?? null}
                        onSelect={onSelect}
                    />
                ))}
            </div>

            {empty.length > 0 && (
                <details className="text-sm text-slate-500">
                    <summary className="cursor-pointer select-none hover:text-slate-700">
                        {empty.length} groupe{empty.length > 1 ? "s" : ""} sans appel sur la période
                    </summary>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {empty.map((q) => (
                            <button
                                key={q.queueNumber}
                                type="button"
                                onClick={() => onSelect(q.queueNumber, q.queueName)}
                                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500 hover:border-blue-300 hover:text-slate-800"
                            >
                                {q.queueNumber} · {q.queueName}
                            </button>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}
