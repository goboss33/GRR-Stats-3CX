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
    /** Action « Actualiser » de la page affichée ; null = pas d'actualisation ici. */
    refresh: (() => void) | null;
    refreshing: boolean;
    reportRefresh: (handler: (() => void) | null, refreshing: boolean) => void;
}

const HeaderScopeContext = createContext<HeaderScopeValue>({
    loadedOrigins: null,
    reportLoadedOrigins: () => undefined,
    refresh: null,
    refreshing: false,
    reportRefresh: () => undefined,
});

export function HeaderScopeProvider({ children }: { children: React.ReactNode }) {
    const [loadedOrigins, setLoadedOrigins] = useState<CallOrigin[] | null>(null);
    const [refreshState, setRefreshState] = useState<{ handler: (() => void) | null; refreshing: boolean }>({
        handler: null,
        refreshing: false,
    });
    const reportLoadedOrigins = useCallback((origins: CallOrigin[] | null) => {
        setLoadedOrigins(origins);
    }, []);
    const reportRefresh = useCallback((handler: (() => void) | null, refreshing: boolean) => {
        setRefreshState({ handler, refreshing });
    }, []);
    const value = useMemo(
        () => ({
            loadedOrigins,
            reportLoadedOrigins,
            refresh: refreshState.handler,
            refreshing: refreshState.refreshing,
            reportRefresh,
        }),
        [loadedOrigins, reportLoadedOrigins, refreshState, reportRefresh],
    );
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

/**
 * Côté page : déclare l'action « Actualiser » du header (et son état de
 * rotation). À l'unmount, le bouton du header redevient grisé.
 */
export function useRegisterHeaderRefresh(handler: () => void, refreshing: boolean): void {
    const { reportRefresh } = useContext(HeaderScopeContext);
    useEffect(() => {
        reportRefresh(handler, refreshing);
        return () => reportRefresh(null, false);
    }, [handler, refreshing, reportRefresh]);
}
