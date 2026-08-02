"use client";

import { useState } from "react";
import { BarChart3, Eye, Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { RuleCaseModal } from "@/components/settings/rule-case-modal";
import { findExemplarCases } from "@/services/rule-cases.service";
import type { ClassificationRules } from "@/services/domain/call-classification";
import type { QueueInfo } from "@/types/queues.types";
import type { ChoiceOption, RuleSpec } from "@/components/settings/rules-config";

/**
 * Carte d'une règle — une question, des options, une conséquence.
 *
 * Compacte par défaut : le détail long se replie derrière « En savoir plus »,
 * et deux actions ouvrent la profondeur quand on la veut — un cas réel tiré de
 * la base, et l'impact chiffré de CETTE règle.
 */

interface Props {
    spec: RuleSpec;
    rules: ClassificationRules;
    onChange: (rules: ClassificationRules) => void;
    /** true quand la valeur diffère de celle enregistrée. */
    dirty: boolean;
    queues: QueueInfo[];
    selectedQueue: string | null;
    /** Mesure l'impact de cette règle seule ; absent = bouton masqué. */
    onMeasure?: (spec: RuleSpec) => void;
    measuring?: boolean;
    measureResult?: string | null;
}

function OptionButtons({ options, value, onPick }: {
    options: readonly ChoiceOption[]; value: string; onPick: (v: string) => void;
}) {
    return (
        <div className="flex flex-wrap gap-2" role="group">
            {options.map((opt) => {
                const selected = opt.value === value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onPick(opt.value)}
                        className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                            selected
                                ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                                : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:text-slate-900"
                        }`}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}

export function RuleCard({
    spec, rules, onChange, dirty, queues, selectedQueue, onMeasure, measuring, measureResult,
}: Props) {
    const [caseOpen, setCaseOpen] = useState(false);

    // Valeur et options affichées, quelle que soit la forme de la règle.
    const value = spec.kind === "shortAbandon"
        ? String(rules.shortAbandonDisposition)
        : spec.kind === "choice" ? String(rules[spec.key]) : "";
    const options = spec.kind === "choice" || spec.kind === "shortAbandon" ? spec.options : [];
    const activeOption = options.find((o) => o.value === value);

    const pick = (v: string) => {
        if (spec.kind === "shortAbandon") onChange({ ...rules, shortAbandonDisposition: v as ClassificationRules["shortAbandonDisposition"] });
        else if (spec.kind === "choice") onChange({ ...rules, [spec.key]: v } as ClassificationRules);
    };

    const caseKind = spec.kind !== "number" ? spec.caseKind : undefined;
    const caseQuestion = spec.kind !== "number" ? spec.caseQuestion : undefined;

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
                <h3 className="text-[15px] font-semibold leading-snug text-slate-900">{spec.question}</h3>
                {dirty && (
                    <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                        modifié
                    </span>
                )}
            </div>

            {/* Seuils numériques : le champ précède la conséquence. */}
            {spec.kind === "number" && (
                <div className="mb-3 flex items-center gap-2">
                    <Input
                        type="number"
                        min={spec.min}
                        max={spec.max}
                        className="w-28"
                        value={rules[spec.key]}
                        onChange={(e) => onChange({
                            ...rules,
                            [spec.key]: Math.max(spec.min, Math.min(spec.max, parseInt(e.target.value) || 0)),
                        })}
                    />
                    <span className="text-sm text-slate-500">{spec.unit}</span>
                </div>
            )}

            {spec.kind === "shortAbandon" && (
                <div className="mb-3 flex items-center gap-2">
                    <Input
                        type="number"
                        min={0}
                        max={300}
                        className="w-28"
                        placeholder="désactivé"
                        value={rules.shortAbandonThresholdSeconds ?? ""}
                        onChange={(e) => onChange({
                            ...rules,
                            shortAbandonThresholdSeconds: e.target.value === "" ? null : Number(e.target.value),
                        })}
                    />
                    <span className="text-sm text-slate-500">seconde(s)</span>
                </div>
            )}

            {(spec.kind === "number" || spec.kind === "shortAbandon") && (
                <p className="mb-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
                    {spec.consequence}
                </p>
            )}

            {spec.kind === "shortAbandon" && (
                <p className="mb-2 text-[13px] font-medium text-slate-700">{spec.dispositionQuestion}</p>
            )}

            {options.length > 0 && (
                <>
                    <OptionButtons options={options} value={value} onPick={pick} />
                    {activeOption && (
                        <p className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
                            → {activeOption.consequence}
                        </p>
                    )}
                </>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
                {caseKind && (
                    <button
                        type="button"
                        onClick={() => setCaseOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                    >
                        <Eye className="h-3.5 w-3.5" />
                        Voir un cas réel
                    </button>
                )}
                {onMeasure && (
                    <button
                        type="button"
                        onClick={() => onMeasure(spec)}
                        disabled={measuring}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
                    >
                        {measuring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
                        Mesurer l&apos;impact
                    </button>
                )}
                {measureResult && (
                    <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                        {measureResult}
                    </span>
                )}
            </div>

            {spec.kind !== "shortAbandon" && spec.more && (
                <details className="mt-3 border-t border-slate-100 pt-2.5">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-400 hover:text-slate-600">
                        En savoir plus
                    </summary>
                    <p className="mt-2 max-w-[66ch] text-[13px] leading-relaxed text-slate-600">{spec.more}</p>
                </details>
            )}

            {caseKind && caseQuestion && (
                <RuleCaseModal
                    open={caseOpen}
                    onClose={() => setCaseOpen(false)}
                    question={caseQuestion}
                    options={options}
                    current={value}
                    onChoose={pick}
                    queues={queues}
                    initialQueue={selectedQueue}
                    findCases={(serverId, queueNumber) => findExemplarCases(serverId, caseKind, queueNumber)}
                />
            )}
        </div>
    );
}
