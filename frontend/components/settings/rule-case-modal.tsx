"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QueueAgentPicker } from "@/components/queue-agent-picker";
import { CallChainTimeline } from "@/components/call-chain-timeline";
import { getSelectedServer } from "@/lib/selected-server";
import type { ExemplarCase } from "@/services/rule-cases.service";
import { getCallChain } from "@/services/logs.service";
import type { QueueInfo } from "@/types/queues.types";
import type { CallChainSegment } from "@/types/logs.types";
import type { ChoiceOption } from "@/components/settings/rules-config";

/**
 * « Voir un cas réel » — on règle une règle en tranchant un VRAI appel.
 *
 * La modale va chercher en base des appels discriminants (dont le sort change
 * selon l'option), affiche le déroulement — le même rendu que la modale des
 * logs (CallChainTimeline) — puis pose la question. Répondre applique
 * l'option : on configure sur pièce, pas sur doctrine.
 *
 * Aucun préalable : sans groupe choisi, la recherche couvre tous les groupes
 * et chaque cas arrive avec le sien. Le sélecteur ne sert qu'à restreindre.
 */

interface Props {
    open: boolean;
    onClose: () => void;
    /** Question posée sous le déroulement ({queue} remplacé par le nom de la file). */
    question: string;
    options: ChoiceOption[];
    /** Valeur active, pour marquer l'option en place. */
    current: string;
    /** Valeur recommandée (RECOMMENDED_RULES), pour l'étiquette « défaut ». */
    recommended?: string;
    onChoose: (value: string) => void;
    queues: QueueInfo[];
    initialQueue: string | null;
    /** Recherche des cas — passée par la carte, avec son type de cas. */
    findCases: (serverId: ReturnType<typeof getSelectedServer>, queueNumber: string | null) => Promise<ExemplarCase[]>;
}

export function RuleCaseModal({
    open, onClose, question, options, current, recommended, onChoose, queues, initialQueue, findCases,
}: Props) {
    const [queue, setQueue] = useState<string | null>(initialQueue);
    const [cases, setCases] = useState<ExemplarCase[] | null>(null);
    const [index, setIndex] = useState(0);
    const [segments, setSegments] = useState<CallChainSegment[]>([]);
    // Deux attentes distinctes : pendant la RECHERCHE des cas, la modale
    // n'affiche qu'un spinner (pas de filtre) ; pendant le chargement du
    // DÉROULEMENT d'un cas, le filtre et la navigation restent en place.
    const [searching, setSearching] = useState(false);
    const [loadingChain, setLoadingChain] = useState(false);

    // Recherche des cas à l'ouverture et à chaque changement de file —
    // y compris sans file : la recherche couvre alors tous les groupes.
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setSearching(true); setCases(null); setSegments([]); setIndex(0);
        findCases(getSelectedServer(), queue)
            .then((found) => { if (!cancelled) setCases(found); })
            .catch(() => { if (!cancelled) setCases([]); })
            .finally(() => { if (!cancelled) setSearching(false); });
        return () => { cancelled = true; };
    }, [open, queue, findCases]);

    // Déroulement de l'appel courant.
    const active = cases && cases.length > 0 ? cases[Math.min(index, cases.length - 1)] : null;
    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        setLoadingChain(true);
        getCallChain(getSelectedServer(), active.callHistoryId)
            .then((segs) => { if (!cancelled) setSegments(segs); })
            .finally(() => { if (!cancelled) setLoadingChain(false); });
        return () => { cancelled = true; };
    }, [active]);

    // Le groupe affiché est celui DU CAS (utile en recherche tous groupes),
    // à défaut celui du filtre.
    const caseQueueNumber = active?.queueNumber ?? queue;
    const caseQueueName = queues.find((q) => q.queueNumber === caseQueueNumber)?.queueName
        ?? caseQueueNumber ?? "ce groupe";

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

                {/* Le filtre n'apparaît qu'une fois la recherche aboutie :
                    à l'ouverture, seul le spinner occupe la modale. */}
                {!searching && cases !== null && (
                <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="min-w-[240px] flex-1">
                        <div className="mb-1 flex items-baseline justify-between">
                            <label className="block text-xs text-slate-600">Restreindre à un groupe</label>
                            {queue && (
                                <button
                                    type="button"
                                    onClick={() => setQueue(null)}
                                    className="text-xs font-medium text-blue-600 hover:underline"
                                >
                                    Tous les groupes
                                </button>
                            )}
                        </div>
                        <QueueAgentPicker
                            queues={queues}
                            show="queues"
                            selectedQueueNumber={queue}
                            onSelect={(item) => setQueue(item.queueNumber)}
                            placeholder="Tous les groupes"
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
                )}

                {(searching || loadingChain) && (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {searching ? "Recherche de cas dans vos appels…" : "Chargement du déroulement…"}
                    </div>
                )}

                {!searching && cases && cases.length === 0 && (
                    <div className="py-8 text-center text-sm text-slate-500">
                        Aucun appel de ce type sur les 30 derniers jours
                        {queue ? " dans ce groupe. Essayez « Tous les groupes »." : "."}
                    </div>
                )}

                {!searching && !loadingChain && active && segments.length > 0 && (
                    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                        <p className="rounded-lg border border-blue-100 bg-blue-50/70 px-4 py-2.5 text-sm text-slate-700">
                            Le{" "}
                            <strong>
                                {format(new Date(active.startedAt), "d MMMM à HH:mm", { locale: fr })}
                            </strong>
                            {caseQueueNumber && (
                                <>, dans le groupe <strong>{caseQueueName}</strong></>
                            )}{" "}
                            — voici ce qui s&apos;est passé :
                        </p>

                        <CallChainTimeline segments={segments} />

                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <p className="mb-3 text-[15px] font-semibold text-slate-900">
                                {question.replace("{queue}", caseQueueName)}
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
                                            {opt.value === recommended && (
                                                <span className="ml-2 rounded-full bg-blue-100 px-1.5 py-px align-middle text-[10px] font-bold uppercase tracking-wide text-blue-700">
                                                    défaut
                                                </span>
                                            )}
                                            {opt.value === current && (
                                                <span className="ml-2 text-xs font-normal text-blue-600">— réglage actuel</span>
                                            )}
                                        </span>
                                        <span className="mt-0.5 block text-xs text-slate-500">{opt.consequence}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
