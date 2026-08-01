"use client";

import { Loader2 } from "lucide-react";
import type { CallOrigin } from "@/services/domain/call-classification";

/**
 * Sélecteur de provenance des appels — Externe / Interne / Les deux.
 *
 * Le critère est celui du socle de classement (buildOriginConditionSQL) : la
 * SOURCE DU PREMIER SEGMENT de l'appel. « Externe » = un client appelle
 * (provider, ligne externe, bridge) ; « Interne » = un collègue appelle depuis
 * son poste. Le choix filtre TOUT l'écran — vignettes, tableau par agent,
 * courbe, heatmap — et voyage jusqu'aux logs via les liens des vignettes.
 */

const OPTIONS: Array<{ value: CallOrigin; label: string; title: string }> = [
    { value: "external", label: "Externe", title: "Appels venus de l'extérieur (clients)" },
    { value: "internal", label: "Interne", title: "Appels venus d'un poste interne (collègues)" },
    { value: "both", label: "Les deux", title: "Toutes provenances confondues" },
];

interface OriginToggleProps {
    value: CallOrigin;
    onChange: (origin: CallOrigin) => void;
    /**
     * Variantes dont les données sont déjà en cache. Celles qui n'y sont pas
     * encore (préchargement en cours) sont grisées, non cliquables, avec un
     * petit spinner. Absent = tout est cliquable (pas de préchargement).
     */
    loadedOrigins?: CallOrigin[];
    disabled?: boolean;
}

export function OriginToggle({ value, onChange, loadedOrigins, disabled = false }: OriginToggleProps) {
    return (
        <div
            role="group"
            aria-label="Provenance des appels"
            className="inline-flex items-center rounded-full bg-slate-200/70 p-1"
        >
            {OPTIONS.map((opt) => {
                const selected = value === opt.value;
                // La variante affichée est réputée chargée : c'est elle qu'on regarde.
                const loaded = selected || !loadedOrigins || loadedOrigins.includes(opt.value);
                return (
                    <button
                        key={opt.value}
                        type="button"
                        title={loaded ? opt.title : "Chargement en arrière-plan…"}
                        aria-pressed={selected}
                        aria-busy={!loaded}
                        disabled={disabled || !loaded}
                        onClick={() => onChange(opt.value)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                            selected
                                ? "bg-blue-600 text-white shadow-sm"
                                : loaded
                                    ? "text-slate-600 hover:text-slate-900"
                                    : "cursor-not-allowed text-slate-400"
                        }`}
                    >
                        {opt.label}
                        {!loaded && <Loader2 className="h-3 w-3 animate-spin" />}
                    </button>
                );
            })}
        </div>
    );
}
