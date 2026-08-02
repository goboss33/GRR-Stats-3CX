"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { CallOrigin } from "@/services/domain/call-classification";

/**
 * Canal page → header pour l'état de préchargement des provenances.
 *
 * Le toggle de provenance vit dans le header (contexte global, comme la
 * période), mais le PRÉCHARGEMENT des variantes est une affaire de page :
 * chaque écran remplit son propre cache. Ce contexte remonte au header la
 * liste des variantes consultables, pour qu'il grise (spinner) celles qui ne
 * le sont pas encore — la mécanique validée sur les statistiques de groupe.
 *
 * `null` = la page ne précharge pas (journaux : chaque bascule recharge) —
 * tout est cliquable.
 */

interface HeaderScopeValue {
    loadedOrigins: CallOrigin[] | null;
    reportLoadedOrigins: (origins: CallOrigin[] | null) => void;
}

const HeaderScopeContext = createContext<HeaderScopeValue>({
    loadedOrigins: null,
    reportLoadedOrigins: () => undefined,
});

export function HeaderScopeProvider({ children }: { children: React.ReactNode }) {
    const [loadedOrigins, setLoadedOrigins] = useState<CallOrigin[] | null>(null);
    const reportLoadedOrigins = useCallback((origins: CallOrigin[] | null) => {
        setLoadedOrigins(origins);
    }, []);
    const value = useMemo(() => ({ loadedOrigins, reportLoadedOrigins }), [loadedOrigins, reportLoadedOrigins]);
    return <HeaderScopeContext.Provider value={value}>{children}</HeaderScopeContext.Provider>;
}

/** Côté header : l'état de préchargement remonté par la page affichée. */
export function useHeaderScope(): HeaderScopeValue {
    return useContext(HeaderScopeContext);
}

/**
 * Côté page : déclare les provenances consultables. À l'unmount, la
 * déclaration est levée (tout redevient cliquable pour la page suivante).
 */
export function useReportLoadedOrigins(origins: CallOrigin[]): void {
    const { reportLoadedOrigins } = useContext(HeaderScopeContext);
    // La liste est passée par sa forme sérialisée : une identité de tableau
    // neuve à chaque rendu ne doit pas re-déclencher l'effet.
    const key = origins.join(",");
    useEffect(() => {
        reportLoadedOrigins(key === "" ? [] : (key.split(",") as CallOrigin[]));
        return () => reportLoadedOrigins(null);
    }, [key, reportLoadedOrigins]);
}
