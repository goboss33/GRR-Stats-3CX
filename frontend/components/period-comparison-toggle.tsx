"use client";

import { useEffect, useState } from "react";

import { Switch } from "@/components/ui/switch";

/**
 * Toggle « Période précédente » du graphique d'évolution — active la
 * superposition des courbes N-1 en pointillés estompés.
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
}

export function PeriodComparisonToggle({ checked, onCheckedChange }: Props) {
    return (
        <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-sm font-medium text-slate-500">
            Période précédente
            <Switch
                checked={checked}
                onCheckedChange={onCheckedChange}
                className="data-[state=checked]:bg-blue-600"
            />
        </label>
    );
}
