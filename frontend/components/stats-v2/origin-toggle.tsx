"use client";

import { Building2, Globe, Layers, Loader2, type LucideIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
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

// Les icônes remplacent les libellés quand la fenêtre devient étroite
// (1000–1129px, cf. les classes min-/max- sur le rendu) : Globe = extérieur,
// Building2 = poste interne, Layers = les deux provenances. L'infobulle
// (opt.title) garde alors le texte accessible au survol.
const OPTIONS: Array<{ value: CallOrigin; label: string; title: string; Icon: LucideIcon }> = [
    { value: "external", label: "Externe", title: "Appels venus de l'extérieur (clients)", Icon: Globe },
    { value: "internal", label: "Interne", title: "Appels venus d'un poste interne (collègues)", Icon: Building2 },
    { value: "both", label: "Les deux", title: "Toutes provenances confondues", Icon: Layers },
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
            className="inline-flex shrink-0 items-center rounded-full bg-slate-200/70 p-1 max-[999px]:order-1"
        >
            {OPTIONS.map((opt) => {
                const selected = value === opt.value;
                // La variante affichée est réputée chargée : c'est elle qu'on regarde.
                const loaded = selected || !loadedOrigins || loadedOrigins.includes(opt.value);
                return (
                    // Span intermédiaire : une variante en préchargement est
                    // désactivée, et un bouton disabled n'émet pas de survol —
                    // sans lui, l'infobulle « Chargement… » ne s'ouvrirait pas.
                    <Tip key={opt.value} content={loaded ? opt.title : "Chargement en arrière-plan…"}>
                        <span className="inline-flex">
                            <button
                                type="button"
                                aria-pressed={selected}
                                aria-busy={!loaded}
                                // Le libellé disparaît en mode icône (fenêtre
                                // étroite) : le nom accessible doit survivre.
                                aria-label={opt.label}
                                disabled={disabled || !loaded}
                                onClick={() => onChange(opt.value)}
                                // whitespace-nowrap : un libellé qui passe à la ligne
                                // (« Les / deux ») fait « gonfler » le toggle quand le
                                // header se compresse.
                                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors min-[1000px]:max-[1129px]:px-3 ${
                                    selected
                                        ? "bg-blue-600 text-white shadow-sm"
                                        : loaded
                                            ? "text-slate-600 hover:text-slate-900"
                                            : "cursor-not-allowed text-slate-400"
                                }`}
                            >
                                {/* Icône visible UNIQUEMENT en mode étroit (1000–
                                    1129px) ; le libellé texte prend le relais en
                                    dehors de cette zone, y compris en mode 2 lignes. */}
                                <opt.Icon aria-hidden className="hidden h-4 w-4 min-[1000px]:max-[1129px]:block" />
                                <span className="min-[1000px]:max-[1129px]:hidden">{opt.label}</span>
                                {!loaded && <Loader2 className="h-3 w-3 animate-spin" />}
                            </button>
                        </span>
                    </Tip>
                );
            })}
        </div>
    );
}
