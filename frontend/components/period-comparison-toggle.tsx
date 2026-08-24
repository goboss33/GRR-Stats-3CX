"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { Tip } from "@/components/ui/tooltip";

/**
 * Toggle « Période précédente » du graphique d'évolution — active la
 * superposition des courbes N-1 en pointillés estompés.
 *
 * Les courbes N-1 se préchargent en tâche de fond avec l'écran (même
 * grammaire que le toggle de provenance du header) : tant qu'elles ne sont
 * pas arrivées, le switch est grisé avec un petit spinner — l'activation est
 * ensuite instantanée, jamais suivie d'un chargement.
 *
 * La préférence est PERSONNELLE et transverse aux écrans : elle vit en
 * localStorage, pas dans l'URL — un lien partagé ne doit pas imposer la
 * superposition à son destinataire, et la période/provenance occupent déjà
 * l'URL comme contexte partageable.
 */

const STORAGE_KEY = "grr-stats.compare-previous-period";

export function usePeriodComparisonPreference(): [boolean, (value: boolean) => void] {
    // Départ à false puis lecture en effet : le rendu serveur ne connaît pas
    // localStorage, initialiser dessus ferait diverger l'hydratation.
    const [enabled, setEnabled] = useState(false);
    useEffect(() => {
        try {
            setEnabled(localStorage.getItem(STORAGE_KEY) === "1");
        } catch {
            // Stockage indisponible (navigation privée stricte) : défaut off.
        }
    }, []);

    const update = (value: boolean) => {
        setEnabled(value);
        try {
            localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
        } catch {
            // Sans stockage, le toggle vaut pour la session en cours.
        }
    };
    return [enabled, update];
}

interface Props {
    checked: boolean;
    onCheckedChange: (value: boolean) => void;
    /** Courbes N-1 pas encore arrivées : switch grisé + spinner. */
    loading?: boolean;
    /** Chargement N-1 en échec : switch grisé, sans spinner. */
    unavailable?: boolean;
}

export function PeriodComparisonToggle({ checked, onCheckedChange, loading = false, unavailable = false }: Props) {
    const disabled = loading || unavailable;
    return (
        <Tip content={loading ? "Chargement en arrière-plan…"
            : unavailable ? "Comparaison indisponible — actualisez pour réessayer"
                : checked ? "Les courbes traitillées reprennent la période précédente de même durée, alignée sur les jours de semaine."
                    : undefined}
        >
            <label className={`flex shrink-0 select-none items-center gap-2 text-sm font-medium ${
                disabled ? "text-slate-400" : "cursor-pointer text-slate-500"
            }`}>
                {/* Échantillon de traitillé : matérialise le lien entre ce
                    toggle et les courbes en pointillés du graphique — la
                    question « les traitillés, c'est quoi ? » ne devrait plus
                    se poser. Neutre en gris : les courbes N-1 reprennent la
                    couleur de leur série, l'échantillon dit juste le STYLE. */}
                {checked && !disabled && (
                    <svg width="22" height="8" aria-hidden className="shrink-0">
                        <line x1="1" y1="4" x2="21" y2="4" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5 3" />
                    </svg>
                )}
                Période précédente
                {loading && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                {/* Span relais : un switch désactivé n'émet pas de survol,
                    l'infobulle vit sur le label qui l'entoure. */}
                <span className="inline-flex">
                    <Switch
                        checked={checked}
                        onCheckedChange={onCheckedChange}
                        disabled={disabled}
                        className="data-[state=checked]:bg-blue-600"
                    />
                </span>
            </label>
        </Tip>
    );
}
