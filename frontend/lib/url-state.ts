"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams, usePathname, type ReadonlyURLSearchParams } from "next/navigation";
import { startOfMonth, endOfMonth, startOfDay, endOfDay, parseISO, format, isValid } from "date-fns";

/**
 * L'URL EST l'état de consultation.
 *
 * Ce que l'utilisateur regarde — la période, et demain le groupe — se lit dans
 * l'URL et nulle part ailleurs. Changer de période, c'est naviguer.
 *
 * ⚠️ Deux tentatives précédentes gardaient cet état en React et écrivaient
 * l'URL après coup : deux sources pour la même chose, donc une synchronisation
 * à maintenir. C'est elle qui a produit des journaux de juillet sous un en-tête
 * de juin, puis des écrans qui ne chargeaient plus. Avec une seule source, il
 * n'y a plus rien à synchroniser.
 *
 * Trois bénéfices en découlent, au-delà de la simplicité :
 *   - un sélecteur unique dans l'en-tête devient trivial : il navigue, et tous
 *     les écrans relisent ;
 *   - le rendu serveur voit la même URL que le client, donc plus d'écart
 *     d'hydratation sur l'affichage de la période ;
 *   - les liens sont partageables et le bouton Retour fonctionne.
 *
 * Frontière volontaire : seul le CONTEXTE de consultation passe par l'URL. Les
 * filtres propres à un écran — les vingt colonnes des journaux — restent en
 * état local, sans quoi chaque frappe deviendrait une navigation.
 */

export interface Period {
    startDate: Date;
    endDate: Date;
}

/** Mois en cours — ce que consulte un manager neuf fois sur dix. */
function defaultPeriod(): Period {
    const now = new Date();
    return { startDate: startOfMonth(now), endDate: endOfMonth(now) };
}

/**
 * Période décrite par deux dates ISO.
 *
 * Prend des CHAÎNES et non l'objet de paramètres : ce sont des primitives, donc
 * utilisables telles quelles comme dépendances de `useMemo`. Sans cela, chaque
 * rendu reconstruirait des `Date` d'identité neuve, les effets qui en dépendent
 * se redéclencheraient sans fin, et l'écran bouclerait sur ses requêtes.
 *
 * Fonction pure : serveur et client en tirent le même résultat.
 */
export function periodFromIso(start: string | null, end: string | null): Period {
    if (!start || !end) return defaultPeriod();

    const startDate = startOfDay(parseISO(start));
    const endDate = endOfDay(parseISO(end));
    // Des dates illisibles ou inversées ne doivent pas rendre l'écran inutilisable.
    if (!isValid(startDate) || !isValid(endDate) || startDate > endDate) return defaultPeriod();

    return { startDate, endDate };
}

/** Écrit une période dans des paramètres d'URL, au format court et lisible. */
export function applyPeriodToParams(params: URLSearchParams, period: Period): void {
    params.set("start", format(period.startDate, "yyyy-MM-dd"));
    params.set("end", format(period.endDate, "yyyy-MM-dd"));
}

/**
 * Période courante et moyen d'en changer.
 *
 * `setPeriod` remplace l'entrée d'historique plutôt que d'en empiler une :
 * ajuster une période n'est pas une étape de navigation, et le bouton Retour
 * doit ramener à l'écran précédent, pas à la période précédente.
 */
export function useUrlPeriod(): Period & { setPeriod: (period: Period) => void } {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    // Les deux paramètres sont des chaînes : tant qu'ils ne changent pas, les
    // `Date` conservent leur identité et les effets qui en dépendent restent au
    // repos. C'est la propriété essentielle de ce module.
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const period = useMemo(() => periodFromIso(start, end), [start, end]);

    const query = searchParams.toString();
    const setPeriod = useCallback((next: Period) => {
        const params = new URLSearchParams(query);
        applyPeriodToParams(params, next);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, [router, pathname, query]);

    return useMemo(() => ({ ...period, setPeriod }), [period, setPeriod]);
}

// ============================================
// PROVENANCE (Externe / Interne / Les deux)
// ============================================

import type { CallOrigin } from "@/services/domain/call-classification";

/**
 * « Externe » par défaut : la lecture client, celle qu'on vient chercher neuf
 * fois sur dix — arbitrage d'août 2026, aligné sur tous les écrans.
 */
const DEFAULT_ORIGIN: CallOrigin = "external";

/** Provenance décrite par un paramètre d'URL ; toute valeur inconnue retombe sur le défaut. */
export function originFromParam(raw: string | null): CallOrigin {
    return raw === "internal" || raw === "external" || raw === "both" ? raw : DEFAULT_ORIGIN;
}

/**
 * Provenance courante et moyen d'en changer — le pendant de `useUrlPeriod`.
 *
 * Comme la période, la provenance est un CONTEXTE de consultation, pas un
 * filtre d'écran : elle vit dans l'URL, le toggle du header l'écrit, et chaque
 * écran concerné (tableau de bord, statistiques de groupe, journaux) la relit.
 * Un seul état, plusieurs poignées — impossible de faire mentir le header.
 */
export function useUrlOrigin(): { origin: CallOrigin; setOrigin: (origin: CallOrigin) => void } {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const origin = originFromParam(searchParams.get("origin"));

    const query = searchParams.toString();
    const setOrigin = useCallback((next: CallOrigin) => {
        const params = new URLSearchParams(query);
        params.set("origin", next);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, [router, pathname, query]);

    return useMemo(() => ({ origin, setOrigin }), [origin, setOrigin]);
}

/**
 * Ajoute le contexte de consultation courant — période ET provenance — à un
 * lien de navigation.
 *
 * Sans cela, passer des statistiques aux journaux par la barre latérale
 * repartirait sur le mois en cours : le contexte se perdrait au moment même où
 * l'on en a le plus besoin.
 */
export function withPeriod(href: string, searchParams: URLSearchParams | ReadonlyURLSearchParams): string {
    const parts: string[] = [];
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    if (start && end) parts.push(`start=${start}`, `end=${end}`);
    const origin = searchParams.get("origin");
    if (origin) parts.push(`origin=${origin}`);
    if (parts.length === 0) return href;
    const separator = href.includes("?") ? "&" : "?";
    return `${href}${separator}${parts.join("&")}`;
}
