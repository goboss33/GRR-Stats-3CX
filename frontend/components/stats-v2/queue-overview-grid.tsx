"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { QueueOverviewCard } from "@/components/stats-v2/queue-overview-card";
import { getQueueOverviewKpis } from "@/services/queue-statistics.service";
import { getQueueFavorites } from "@/services/queue-favorites.service";
import { getSelectedServer } from "@/lib/selected-server";
import { logger } from "@/lib/logger";
import type { QueueInfo } from "@/types/queues.types";
import type { QueueKPIs } from "@/types/statistics.types";
import type { CallOrigin } from "@/services/domain/call-classification";

/**
 * Aperçu des groupes du périmètre — la grille de cartes du tableau de bord.
 *
 * FAVORITES D'ABORD : au-delà d'une douzaine de groupes, seules les équipes
 * épinglées (ou les douze premières, sans favoris) s'affichent, le reste se
 * déplie à la demande — un périmètre d'administrateur (~85 files) ne doit pas
 * engloutir le tableau de bord. Seules les cartes VISIBLES chargent leurs
 * chiffres : déplier déclenche le chargement du reste.
 *
 * Chargement PROGRESSIF : squelettes immédiats, chaque carte se remplit dès
 * que sa réponse arrive (pool borné, ~0,5 s par carte — LA MÊME requête KPI
 * que l'écran détail, pour que l'aperçu et le détail affichent les mêmes
 * chiffres par construction). Tri stable par numéro ; les groupes sans appel
 * sur la période se replient sous la grille.
 */

const CONCURRENCY = 5;
/** Au-delà, le repli s'active : favorites (ou 12 premières) + « Afficher tout ». */
const COLLAPSE_THRESHOLD = 12;

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
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    const [expanded, setExpanded] = useState(false);
    const contextKeyRef = useRef("");
    const inflightRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        getQueueFavorites(getSelectedServer())
            .then((list) => setFavorites(new Set(list)))
            .catch(() => undefined);
    }, []);

    const sorted = useMemo(
        () => [...queues].sort((a, b) => a.queueNumber.localeCompare(b.queueNumber, undefined, { numeric: true })),
        [queues],
    );

    // Qui s'affiche ? Toujours les favorites en tête, complétées par les
    // suivantes jusqu'à DOUZE cartes minimum (3 favoris → 3 + 9 autres ;
    // 15 favoris → les 12 premières) ; le reste derrière le déplioir. L'ordre
    // favorites-d'abord vaut aussi déplié : déplier ne remélange pas la grille.
    const { shown, hiddenCount } = useMemo(() => {
        const pinned = sorted.filter((q) => favorites.has(q.queueNumber));
        const rest = sorted.filter((q) => !favorites.has(q.queueNumber));
        const ordered = [...pinned, ...rest];
        if (expanded || ordered.length <= COLLAPSE_THRESHOLD) {
            return { shown: ordered, hiddenCount: 0 };
        }
        return {
            shown: ordered.slice(0, COLLAPSE_THRESHOLD),
            hiddenCount: ordered.length - COLLAPSE_THRESHOLD,
        };
    }, [sorted, favorites, expanded]);

    // Charge les cartes VISIBLES qui ne le sont pas encore — déplier étend le
    // chargement au reste, changer de contexte remet tout à zéro.
    const ctxKey = `${getSelectedServer()}|${startDate.toISOString()}|${endDate.toISOString()}|${origin}|${sorted.map((q) => q.queueNumber).join(",")}`;
    const shownKey = shown.map((q) => q.queueNumber).join(",");
    useEffect(() => {
        if (shown.length === 0) return;
        if (contextKeyRef.current !== ctxKey) {
            contextKeyRef.current = ctxKey;
            setKpisByQueue({});
            setFailed(new Set());
            inflightRef.current = new Set();
        }

        const serverId = getSelectedServer();
        const pending = shown
            .map((q) => q.queueNumber)
            .filter((n) => !inflightRef.current.has(n));
        pending.forEach((n) => inflightRef.current.add(n));

        const worker = async () => {
            for (;;) {
                const queueNumber = pending.shift();
                if (!queueNumber || contextKeyRef.current !== ctxKey) return;
                try {
                    const kpis = await getQueueOverviewKpis(serverId, queueNumber, startDate, endDate, origin);
                    if (contextKeyRef.current !== ctxKey) return;
                    setKpisByQueue((current) => ({ ...current, [queueNumber]: kpis }));
                } catch (error) {
                    logger.error("[QueueOverview] KPI en échec :", { queue: queueNumber, error });
                    if (contextKeyRef.current !== ctxKey) return;
                    setFailed((current) => new Set(current).add(queueNumber));
                }
            }
        };
        for (let i = 0; i < CONCURRENCY; i++) void worker();
        // startDate/endDate portés par ctxKey (identité de Date instable).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ctxKey, shownKey]);

    if (sorted.length === 0) return null;

    // Un groupe « sans appel » ne l'est qu'une fois sa réponse arrivée.
    const isEmpty = (q: QueueInfo) => {
        const kpis = kpisByQueue[q.queueNumber];
        return kpis !== undefined && kpis.callsReceived + kpis.teamDirectReceived === 0;
    };
    const visible = shown.filter((q) => !failed.has(q.queueNumber) && !isEmpty(q));
    const empty = shown.filter((q) => isEmpty(q));

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

            {(hiddenCount > 0 || (expanded && sorted.length > COLLAPSE_THRESHOLD)) && (
                <button
                    type="button"
                    onClick={() => setExpanded((e) => !e)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white py-2 text-sm font-medium text-slate-500 transition-colors hover:border-blue-300 hover:text-slate-800"
                >
                    {expanded
                        ? <>Réduire <ChevronUp className="h-4 w-4" /></>
                        : <>Afficher les {hiddenCount} autres groupes <ChevronDown className="h-4 w-4" /></>}
                </button>
            )}

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
