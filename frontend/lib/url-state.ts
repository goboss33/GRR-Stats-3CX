"use client";

import { useCallback } from "react";
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
 * Période décrite par des paramètres d'URL.
 *
 * Fonction pure : le serveur et le client en tirent le même résultat, ce qui
 * est exactement la propriété qui manquait auparavant.
 */
export function periodFromParams(params: URLSearchParams | ReadonlyURLSearchParams): Period {
    const start = params.get("start");
    const end = params.get("end");
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

    const period = periodFromParams(searchParams);

    const setPeriod = useCallback((next: Period) => {
        const params = new URLSearchParams(searchParams.toString());
        applyPeriodToParams(params, next);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, [router, pathname, searchParams]);

    return { ...period, setPeriod };
}

/**
 * Ajoute la période courante à un lien de navigation.
 *
 * Sans cela, passer des statistiques aux journaux par la barre latérale
 * repartirait sur le mois en cours : le contexte se perdrait au moment même où
 * l'on en a le plus besoin.
 */
export function withPeriod(href: string, searchParams: URLSearchParams | ReadonlyURLSearchParams): string {
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    if (!start || !end) return href;
    const separator = href.includes("?") ? "&" : "?";
    return `${href}${separator}start=${start}&end=${end}`;
}
