"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2, Printer, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { QueueAgentPicker } from "@/components/queue-agent-picker";
import { RuleCard } from "@/components/settings/rule-card";
import {
    GLOSSARY, RULE_SPECS, SECTIONS, buildSummary,
    type RuleSpec, type SectionId,
} from "@/components/settings/rules-config";
import { getScopedQueueOptions } from "@/services/queues.service";
import { measureRulesImpact, measureSingleRule, type RulesImpact } from "@/services/rules-impact.service";
import { getSelectedServer } from "@/lib/selected-server";
import type { QueueInfo } from "@/types/queues.types";
import type { ClassificationRules } from "@/services/domain/call-classification";

/**
 * Écran « Règles métier » — la gouvernance des statistiques.
 *
 * L'écran raconte la vie d'un appel en cinq questions (cf. rules-config), là
 * où il exposait auparavant une liste de mécanismes regroupés par couche
 * technique. Trois partis pris :
 *
 * 1. Un RÉSUMÉ EXÉCUTIF en tête, en français, qui se réécrit à chaque choix :
 *    c'est le document à présenter et à imprimer.
 * 2. Chaque règle est une QUESTION, avec une seule ligne de conséquence ; le
 *    détail se replie. On lit l'écran en survol, on l'approfondit au besoin.
 * 3. Chaque règle peut se trancher sur un CAS RÉEL tiré de la base — décider
 *    sur pièce plutôt que sur doctrine.
 */

interface Props {
    rules: ClassificationRules;
    onChange: (rules: ClassificationRules) => void;
    /** Réglages enregistrés, pour signaler ce qui a été modifié. */
    saved: ClassificationRules;
}

/** Valeur d'une règle, quelle que soit sa forme — pour comparer à l'enregistré. */
function ruleValue(spec: RuleSpec, rules: ClassificationRules): unknown {
    if (spec.kind === "number") return rules[spec.key];
    if (spec.kind === "shortAbandon") return `${rules.shortAbandonThresholdSeconds}|${rules.shortAbandonDisposition}`;
    return rules[spec.key];
}

/** Réglages où CETTE règle bascule sur son autre valeur (pour l'impact ciblé). */
function withAlternative(spec: RuleSpec, rules: ClassificationRules): ClassificationRules | null {
    if (spec.kind === "number") return null;
    const current = spec.kind === "shortAbandon" ? rules.shortAbandonDisposition : rules[spec.key];
    const other = spec.options.find((o) => o.value !== current);
    if (!other) return null;
    if (spec.kind === "shortAbandon") {
        return { ...rules, shortAbandonDisposition: other.value as ClassificationRules["shortAbandonDisposition"] };
    }
    return { ...rules, [spec.key]: other.value } as ClassificationRules;
}

export function ClassificationRulesCard({ rules, onChange, saved }: Props) {
    const [queues, setQueues] = useState<QueueInfo[]>([]);
    const [queue, setQueue] = useState<string | null>(null);
    const [activeSection, setActiveSection] = useState<SectionId>(1);

    // Mesure ciblée (par règle) et mesure globale (toutes modifications).
    const [measuringKey, setMeasuringKey] = useState<string | null>(null);
    const [measures, setMeasures] = useState<Record<string, string>>({});
    const [globalBusy, setGlobalBusy] = useState(false);
    const [globalImpact, setGlobalImpact] = useState<RulesImpact | null>(null);

    useEffect(() => {
        getScopedQueueOptions(getSelectedServer())
            .then((options) => {
                setQueues(options.queues);
                setQueue((current) => current ?? options.queues[0]?.queueNumber ?? null);
            })
            .catch(() => undefined);
    }, []);

    // Surlignage de la section visible pendant le défilement.
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        const id = Number(entry.target.getAttribute("data-section")) as SectionId;
                        if (id) setActiveSection(id);
                    }
                }
            },
            { rootMargin: "-15% 0px -70% 0px" },
        );
        document.querySelectorAll("[data-section]").forEach((el) => observer.observe(el));
        return () => observer.disconnect();
    }, []);

    const summary = useMemo(() => buildSummary(rules), [rules]);
    const bySection = useMemo(() => {
        const map = new Map<SectionId | "advanced", RuleSpec[]>();
        for (const spec of RULE_SPECS) {
            const list = map.get(spec.section) ?? [];
            list.push(spec);
            map.set(spec.section, list);
        }
        return map;
    }, []);

    const measureRule = async (spec: RuleSpec) => {
        if (!queue) { toast.error("Choisissez d'abord un groupe à observer."); return; }
        const alternative = withAlternative(spec, rules);
        if (!alternative) return;
        const key = spec.key;
        setMeasuringKey(key);
        try {
            const phrase = await measureSingleRule(getSelectedServer(), queue, 30, rules, alternative);
            setMeasures((m) => ({ ...m, [key]: phrase }));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Mesure impossible");
        } finally {
            setMeasuringKey(null);
        }
    };

    const measureGlobal = async () => {
        if (!queue) return;
        setGlobalBusy(true); setGlobalImpact(null);
        try {
            const end = new Date();
            const start = new Date(end.getTime() - 30 * 86_400_000);
            setGlobalImpact(await measureRulesImpact(getSelectedServer(), queue, start, end, rules));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Mesure impossible");
        } finally {
            setGlobalBusy(false);
        }
    };

    const renderSection = (id: SectionId) => {
        const section = SECTIONS.find((s) => s.id === id)!;
        const specs = bySection.get(id) ?? [];
        return (
            <section key={id} id={`regles-section-${id}`} data-section={id} className="scroll-mt-4 space-y-3">
                <div className="flex items-baseline gap-3">
                    <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-bold tabular-nums text-blue-700">
                        {id}
                    </span>
                    <div>
                        <h3 className="text-lg font-semibold tracking-tight text-slate-900">{section.title}</h3>
                        <p className="text-[13px] text-slate-500">{section.subtitle}</p>
                    </div>
                </div>
                {specs.map((spec) => (
                    <RuleCard
                        key={spec.key}
                        spec={spec}
                        rules={rules}
                        onChange={onChange}
                        dirty={ruleValue(spec, rules) !== ruleValue(spec, saved)}
                        queues={queues}
                        selectedQueue={queue}
                        onMeasure={spec.kind === "number" ? undefined : measureRule}
                        measuring={measuringKey === spec.key}
                        measureResult={measures[spec.key] ?? null}
                    />
                ))}
            </section>
        );
    };

    const delta = (before: number, after: number) => {
        const d = after - before;
        if (d === 0) return <span className="text-slate-400">inchangé</span>;
        return <span className={d > 0 ? "text-emerald-700" : "text-red-700"}>{d > 0 ? "+" : ""}{d}</span>;
    };

    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
            {/* Sommaire — les cinq questions, dans l'ordre de la vie d'un appel. */}
            <nav className="hidden lg:block">
                <div className="sticky top-4 space-y-1">
                    {SECTIONS.map((s) => (
                        <a
                            key={s.id}
                            href={`#regles-section-${s.id}`}
                            className={`flex items-baseline gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors ${
                                activeSection === s.id
                                    ? "border-slate-200 bg-white font-semibold text-slate-900"
                                    : "border-transparent text-slate-500 hover:bg-white"
                            }`}
                        >
                            <span className={`w-3 text-[11px] tabular-nums ${activeSection === s.id ? "text-blue-600" : "text-slate-400"}`}>
                                {s.id}
                            </span>
                            {s.title}
                        </a>
                    ))}
                    <p className="px-3 pt-3 text-[11px] leading-relaxed text-slate-400">
                        Ces règles s&apos;appliquent au calcul, pas au stockage : les modifier change
                        rétroactivement les chiffres des périodes passées.
                    </p>
                </div>
            </nav>

            <div className="min-w-0 space-y-8">
                {/* Résumé exécutif — le document de référence. */}
                <Card className="border-slate-200">
                    <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <FileText className="h-4 w-4 text-blue-600" />
                                Comment compte-t-on aujourd&apos;hui ?
                            </CardTitle>
                            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}>
                                <Printer className="h-3.5 w-3.5" />
                                Imprimer
                            </Button>
                        </div>
                        <CardDescription>
                            Une phrase par règle active — ce résumé se met à jour à chaque choix.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-1.5 pt-0">
                        {summary.map((phrase, i) => (
                            <p key={i} className="flex gap-2 text-[13.5px] text-slate-600">
                                <span className="font-bold text-blue-600">·</span>
                                {phrase}
                            </p>
                        ))}
                    </CardContent>
                </Card>

                {/* Glossaire des statuts — le vocabulaire commun. */}
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <span className="mr-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                        Vocabulaire
                    </span>
                    {GLOSSARY.map((g) => (
                        <span
                            key={g.label}
                            title={g.title}
                            className={`cursor-help rounded-full border px-2.5 py-1 text-xs font-semibold ${g.className}`}
                        >
                            {g.label}
                        </span>
                    ))}
                </div>

                {/* Groupe observé : sert aux cas réels ET aux mesures d'impact. */}
                <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="min-w-[260px] flex-1">
                        <Label className="mb-1 block text-xs text-slate-600">
                            Groupe observé — requis pour mesurer, optionnel pour les cas réels
                        </Label>
                        <QueueAgentPicker
                            queues={queues}
                            show="queues"
                            selectedQueueNumber={queue}
                            onSelect={(item) => setQueue(item.queueNumber)}
                            placeholder="Choisir un groupe…"
                            size="compact"
                        />
                    </div>
                    <Button variant="outline" onClick={measureGlobal} disabled={!queue || globalBusy} className="gap-2">
                        {globalBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
                        Mesurer toutes mes modifications
                    </Button>
                </div>

                {globalImpact && (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-100 text-xs text-slate-500">
                                    <th className="px-3 py-2 text-left font-medium">Groupe {globalImpact.queueNumber} · 30 derniers jours</th>
                                    <th className="px-3 py-2 text-right font-medium">Enregistré</th>
                                    <th className="px-3 py-2 text-right font-medium">En cours</th>
                                    <th className="px-3 py-2 text-right font-medium">Écart</th>
                                </tr>
                            </thead>
                            <tbody>
                                {([["Total reçus", "received"], ["Répondus", "answered"], ["Perdus", "lost"], ["Redirigés", "overflow"]] as const).map(
                                    ([label, key]) => (
                                        <tr key={key} className="border-b border-slate-50 last:border-0">
                                            <td className="px-3 py-1.5 text-slate-700">{label}</td>
                                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{globalImpact.current[key]}</td>
                                            <td className="px-3 py-1.5 text-right font-medium tabular-nums">{globalImpact.candidate[key]}</td>
                                            <td className="px-3 py-1.5 text-right tabular-nums">{delta(globalImpact.current[key], globalImpact.candidate[key])}</td>
                                        </tr>
                                    ),
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {SECTIONS.map((s) => renderSection(s.id))}

                {/* Avancé — réglages rarement touchés, repliés. */}
                <details className="rounded-xl border border-slate-200 bg-white px-5">
                    <summary className="cursor-pointer py-4 text-sm font-semibold text-slate-600">
                        Avancé — réglages techniques (rarement modifiés)
                    </summary>
                    <div className="space-y-3 pb-5">
                        {(bySection.get("advanced") ?? []).map((spec) => (
                            <RuleCard
                                key={spec.key}
                                spec={spec}
                                rules={rules}
                                onChange={onChange}
                                dirty={ruleValue(spec, rules) !== ruleValue(spec, saved)}
                                queues={queues}
                                selectedQueue={queue}
                            />
                        ))}
                        <div className="rounded-xl border border-slate-200 p-4">
                            <p className="mb-2 text-[13px] text-slate-600">
                                Types de destinations « système » — jamais comptés comme une réponse humaine :
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {["queue", "ring_group", "ring_group_ring_all", "ivr", "process", "parking", "script"].map((t) => (
                                    <code key={t} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                                        {t}
                                    </code>
                                ))}
                            </div>
                            <p className="mt-3 text-xs text-slate-400">
                                Ces valeurs sont définies dans le code source ; contactez l&apos;administrateur technique pour les modifier.
                            </p>
                        </div>
                    </div>
                </details>
            </div>
        </div>
    );
}
