"use client";

import { toast } from "sonner";

import { useState, useEffect } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ClassificationRulesCard } from "@/components/settings/classification-rules-card";
import {
    DEFAULT_CLASSIFICATION_RULES,
    type ClassificationRules,
} from "@/services/domain/call-classification";

/**
 * Onglet « Règles métier ».
 *
 * Le contenu (les cinq questions, les cartes, le résumé exécutif) vit dans
 * ClassificationRulesCard ; cet onglet ne garde que l'état, la persistance et
 * l'interrupteur de périmètre, qui n'est pas une règle de calcul mais un
 * interrupteur de sécurité — d'où sa place à part, avant les règles.
 */

/** Traduction base → domaine, en un seul endroit. */
function toRules(data: Record<string, unknown>, current: ClassificationRules): ClassificationRules {
    const pick = <T,>(value: unknown, fallback: T): T => (value === undefined || value === null ? fallback : (value as T));
    return {
        multiPassage: pick(data.ruleMultiPassage, current.multiPassage),
        overflow: pick(data.ruleOverflow, current.overflow),
        // `null` est légitime ici : il désactive la distinction des abandons courts.
        shortAbandonThresholdSeconds: (data.ruleShortAbandonSec as number | null) ?? null,
        directAndQueue: pick(data.ruleDirectAndQueue, current.directAndQueue),
        voicemail: pick(data.ruleVoicemail, current.voicemail),
        outOfScopeFinalStatus: pick(data.ruleOutOfScopeFinalStatus, current.outOfScopeFinalStatus),
        minAnswerSeconds: pick(data.ruleMinAnswerSec, current.minAnswerSeconds),
        callGrain: pick(data.ruleCallGrain, current.callGrain),
        answeredThenTransferred: pick(data.ruleAnsweredThenTransferred, current.answeredThenTransferred),
        agentCredit: pick(data.ruleAgentCredit, current.agentCredit),
        handedOffInPerformance: pick(data.ruleHandedOffInPerformance, current.handedOffInPerformance),
        minSignificantDurationSeconds: pick(data.minSignificantDurationSec, current.minSignificantDurationSeconds),
        shortAbandonDisposition: pick(data.ruleShortAbandonDisposition, current.shortAbandonDisposition),
    };
}

export function BusinessRulesTab() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [perimeterEnforcementEnabled, setPerimeterEnforcementEnabled] = useState(false);
    const [togglingPerimeter, setTogglingPerimeter] = useState(false);
    // Règles en cours d'édition, et dernier état ENREGISTRÉ : la différence
    // entre les deux pilote les badges « modifié » et le bouton Enregistrer.
    const [rules, setRules] = useState<ClassificationRules>(DEFAULT_CLASSIFICATION_RULES);
    const [saved, setSaved] = useState<ClassificationRules>(DEFAULT_CLASSIFICATION_RULES);

    useEffect(() => {
        fetch("/api/admin/settings")
            .then((res) => res.json())
            .then((data) => {
                if (data.perimeterEnforcementEnabled !== undefined) {
                    setPerimeterEnforcementEnabled(data.perimeterEnforcementEnabled);
                }
                setRules((current) => {
                    const next = toRules(data, current);
                    setSaved(next);
                    return next;
                });
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const dirty = JSON.stringify(rules) !== JSON.stringify(saved);

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch("/api/admin/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                // Traduction vers les noms de colonnes, faite ici pour que le
                // reste de l'application ne connaisse que le vocabulaire métier.
                body: JSON.stringify({
                    minSignificantDurationSec: rules.minSignificantDurationSeconds,
                    ruleMultiPassage: rules.multiPassage,
                    ruleOverflow: rules.overflow,
                    ruleShortAbandonSec: rules.shortAbandonThresholdSeconds,
                    ruleDirectAndQueue: rules.directAndQueue,
                    ruleVoicemail: rules.voicemail,
                    ruleOutOfScopeFinalStatus: rules.outOfScopeFinalStatus,
                    ruleMinAnswerSec: rules.minAnswerSeconds,
                    ruleCallGrain: rules.callGrain,
                    ruleAnsweredThenTransferred: rules.answeredThenTransferred,
                    ruleAgentCredit: rules.agentCredit,
                    ruleHandedOffInPerformance: rules.handedOffInPerformance,
                    ruleShortAbandonDisposition: rules.shortAbandonDisposition,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(data.error || "Erreur lors de la sauvegarde");
            } else {
                setSaved(rules);
                toast.success("Règles enregistrées — les chiffres des périodes passées sont recalculés");
            }
        } catch {
            toast.error("Erreur lors de la sauvegarde");
        } finally {
            setSaving(false);
        }
    };

    const togglePerimeter = async (enabled: boolean) => {
        setTogglingPerimeter(true);
        const previous = perimeterEnforcementEnabled;
        setPerimeterEnforcementEnabled(enabled);
        try {
            const res = await fetch("/api/admin/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ perimeterEnforcementEnabled: enabled }),
            });
            if (!res.ok) throw new Error((await res.json()).error || "Erreur lors de la sauvegarde");
            toast.success(enabled ? "Filtrage par périmètre activé" : "Filtrage par périmètre désactivé");
        } catch (e) {
            setPerimeterEnforcementEnabled(previous);
            toast.error(e instanceof Error ? e.message : "Erreur lors de la sauvegarde");
        } finally {
            setTogglingPerimeter(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                <span className="ml-2 text-slate-500">Chargement des règles métier…</span>
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-24">
            {/* Interrupteur de sécurité — pas une règle de calcul, d'où sa
                position à part et son traitement immédiat (pas d'Enregistrer). */}
            <div className={`rounded-xl border p-4 ${perimeterEnforcementEnabled ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-sm font-semibold text-slate-900">
                            Filtrage par périmètre — {perimeterEnforcementEnabled ? "actif" : "inactif (mode observation)"}
                        </p>
                        <p className="text-xs text-slate-500">
                            {perimeterEnforcementEnabled
                                ? "Chaque manager ne voit que ses groupes et ses agents. Les ADMIN et MODERATOR gardent un accès global."
                                : "Tout le monde voit l'ensemble des données. À activer une fois les groupes classés et les périmètres attribués."}
                        </p>
                    </div>
                    <Switch
                        checked={perimeterEnforcementEnabled}
                        onCheckedChange={togglePerimeter}
                        disabled={togglingPerimeter}
                    />
                </div>
            </div>

            <ClassificationRulesCard rules={rules} onChange={setRules} saved={saved} />

            {/* Barre d'enregistrement — collante, toujours atteignable. */}
            <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-md backdrop-blur">
                <p className={`text-xs ${dirty ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                    {dirty
                        ? "Modifications non enregistrées — effet rétroactif sur les périodes passées"
                        : "Aucune modification"}
                </p>
                <Button onClick={handleSave} disabled={saving || !dirty}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Enregistrer les règles
                </Button>
            </div>
        </div>
    );
}
