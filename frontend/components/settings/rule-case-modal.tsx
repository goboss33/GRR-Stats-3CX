"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QueueAgentPicker } from "@/components/queue-agent-picker";
import { getSelectedServer } from "@/lib/selected-server";
import type { ExemplarCase } from "@/services/rule-cases.service";
import { getCallChain } from "@/services/logs.service";
import { queueOutcomeConfig } from "@/components/logs-table-helpers";
import type { QueueInfo } from "@/types/queues.types";
import type { CallChainSegment } from "@/services/domain/call.types";
import type { ChoiceOption } from "@/components/settings/rules-config";

/**
 * « Voir un cas réel » — on règle une règle en tranchant un VRAI appel.
 *
 * La modale va chercher en base des appels discriminants (dont le sort change
 * selon l'option), affiche le déroulement, puis pose la question. Répondre
 * applique l'option : on configure sur pièce, pas sur doctrine. C'est aussi le
 * support de présentation aux responsables — un cas concret vaut mieux qu'un
 * paragraphe.
 */

interface Props {
    open: boolean;
    onClose: () => void;
    /** Question posée sous le déroulement ({queue} remplacé par le nom de la file). */
    question: string;
    options: ChoiceOption[];
    /** Valeur active, pour marquer l'option en place. */
    current: string;
    onChoose: (value: string) => void;
    queues: QueueInfo[];
    initialQueue: string | null;
    /** Recherche des cas — passée par la carte, avec son type de cas. */
    findCases: (serverId: ReturnType<typeof getSelectedServer>, queueNumber: string) => Promise<ExemplarCase[]>;
}

export function RuleCaseModal({
    open, onClose, question, options, current, onChoose, queues, initialQueue, findCases,
}: Props) {
    const [queue, setQueue] = useState<string | null>(initialQueue);
    const [cases, setCases] = useState<ExemplarCase[] | null>(null);
    const [index, setIndex] = useState(0);
    const [segments, setSegments] = useState<CallChainSegment[]>([]);
    const [loading, setLoading] = useState(false);

    const queueName = queues.find((q) => q.queueNumber === queue)?.queueName ?? queue ?? "cette file";

    // Recherche des cas à l'ouverture et à chaque changement de file.
    useEffect(() => {
        if (!open || !queue) return;
        let cancelled = false;
        setLoading(true); setCases(null); setSegments([]); setIndex(0);
        findCases(getSelectedServer(), queue)
            .then((found) => { if (!cancelled) setCases(found); })
            .catch(() => { if (!cancelled) setCases([]); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [open, queue, findCases]);

    // Déroulement de l'appel courant.
    const loadChain = useCallback((callHistoryId: string) => {
        let cancelled = false;
        setLoading(true);
        getCallChain(getSelectedServer(), callHistoryId)
            .then((segs) => { if (!cancelled) setSegments(segs); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!cases || cases.length === 0) return;
        return loadChain(cases[Math.min(index, cases.length - 1)].callHistoryId);
    }, [cases, index, loadChain]);

    const active = cases && cases.length > 0 ? cases[Math.min(index, cases.length - 1)] : null;

    // Segments affichés : on écarte le bruit technique pour garder un récit
    // lisible — c'est un support de discussion, pas un audit.
    const shown = segments.filter((s) => s.category !== "routing" && s.category !== "unknown");

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            {/* Pas d'overflow sur le conteneur : la liste du sélecteur (en
                absolute) doit pouvoir déborder du cadre. Seul le récit du cas
                défile, dans son propre conteneur plus bas. */}
            <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <Eye className="h-4 w-4 text-blue-600" />
                        Un cas réel, tiré de vos appels
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="min-w-[240px] flex-1">
                        <label className="mb-1 block text-xs text-slate-600">Groupe observé</label>
                        <QueueAgentPicker
                            queues={queues}
                            show="queues"
                            selectedQueueNumber={queue}
                            onSelect={(item) => setQueue(item.queueNumber)}
                            placeholder="Choisir un groupe…"
                            size="compact"
                        />
                    </div>
                    {cases && cases.length > 1 && (
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 disabled:opacity-40"
                                disabled={index === 0}
                                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                                aria-label="Cas précédent"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="text-xs tabular-nums text-slate-500">
                                cas {index + 1} / {cases.length}
                            </span>
                            <button
                                type="button"
                                className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 disabled:opacity-40"
                                disabled={index >= cases.length - 1}
                                onClick={() => setIndex((i) => Math.min(cases.length - 1, i + 1))}
                                aria-label="Cas suivant"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    )}
                </div>

                {loading && (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Recherche d&apos;un appel représentatif…
                    </div>
                )}

                {!loading && cases && cases.length === 0 && (
                    <div className="py-8 text-center text-sm text-slate-500">
                        Aucun appel de ce type dans ce groupe sur les 30 derniers jours.
                        <br />
                        Essayez un autre groupe — les réceptions en ont généralement le plus.
                    </div>
                )}

                {!loading && active && shown.length > 0 && (
                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                        <p className="rounded-lg border border-blue-100 bg-blue-50/70 px-4 py-2.5 text-sm text-slate-700">
                            Le{" "}
                            <strong>
                                {format(new Date(active.startedAt), "d MMMM à HH:mm", { locale: fr })}
                            </strong>
                            , dans le groupe <strong>{queueName}</strong> — voici ce qui s&apos;est passé :
                        </p>

                        <ol className="space-y-0">
                            {shown.map((seg, i) => (
                                <li key={seg.id} className="flex gap-3">
                                    <div className="flex w-4 flex-col items-center">
                                        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white ${
                                            seg.status === "answered" ? "bg-emerald-500"
                                                : seg.status === "voicemail" ? "bg-indigo-500"
                                                    : seg.destinationType === "queue" ? "bg-violet-500"
                                                        : "bg-red-400"
                                        }`} />
                                        {i < shown.length - 1 && <span className="w-px flex-1 bg-slate-200" />}
                                    </div>
                                    <div className="min-w-0 pb-4 text-sm">
                                        <span className="text-xs tabular-nums text-slate-400">
                                            {format(new Date(seg.startedAt), "HH:mm:ss")}
                                        </span>
                                        <div className="font-medium text-slate-800">
                                            {seg.destinationName || seg.destinationNumber}
                                            <span className="ml-1.5 text-xs font-normal text-slate-500">
                                                {seg.destinationType}
                                            </span>
                                            {seg.isMergedLeg && (
                                                <span className="ml-2 rounded-full border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">
                                                    ↳ jambe de transfert
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-xs text-slate-500">
                                            {seg.answeredAt ? `décroché · ${seg.durationFormatted}` : `sans réponse · ${seg.durationFormatted}`}
                                            {seg.terminationReasonDetails ? ` · ${seg.terminationReasonDetails}` : ""}
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ol>

                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <p className="mb-3 text-[15px] font-semibold text-slate-900">
                                {question.replace("{queue}", queueName)}
                            </p>
                            <div className="space-y-2">
                                {options.map((opt) => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => { onChoose(opt.value); onClose(); }}
                                        className={`w-full rounded-lg border p-3 text-left transition-colors ${
                                            opt.value === current
                                                ? "border-blue-400 bg-blue-50/60"
                                                : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40"
                                        }`}
                                    >
                                        <span className="block text-sm font-medium text-slate-900">
                                            {opt.label}
                                            {opt.value === current && (
                                                <span className="ml-2 text-xs font-normal text-blue-600">— réglage actuel</span>
                                            )}
                                        </span>
                                        <span className="mt-0.5 block text-xs text-slate-500">{opt.consequence}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <p className="text-xs text-slate-400">
                            Statuts possibles : {Object.entries(queueOutcomeConfig)
                                .map(([, c]) => c.label)
                                .filter((l, i, arr) => arr.indexOf(l) === i)
                                .join(" · ")}
                        </p>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
