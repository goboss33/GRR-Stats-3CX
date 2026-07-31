import { startOfMonth, endOfMonth, startOfDay, endOfDay, parseISO, format, isValid } from "date-fns";

/**
 * Période consultée, partagée entre les écrans — SANS état partagé.
 *
 * Chaque écran garde sa période en état local, comme avant. Ce module ne
 * partage qu'une VALEUR : il la lit au montage et la conserve quand elle
 * change. Passer des statistiques aux journaux retrouve donc la même période,
 * sans qu'aucun écran ait à se coordonner avec un autre.
 *
 * ⚠️ Une première tentative plaçait la période dans un contexte React au-dessus
 * des pages. Elle a été retirée : un état partagé impose de coordonner le
 * moment où la valeur devient juste, et cette coordination a produit trois
 * défauts successifs — deux requêtes concurrentes dont la plus ancienne
 * pouvait gagner, l'adoption de l'URL écrasée parce que React exécute les
 * effets enfants avant ceux du parent, puis des écrans qui ne chargeaient plus
 * du tout en attendant un signal.
 *
 * D'où ce module volontairement passif : deux fonctions, aucun état, aucun
 * rendu. Il ne peut pas désynchroniser ce qu'il ne détient pas.
 */

export interface Period {
    startDate: Date;
    endDate: Date;
}

const STORAGE_KEY = "grr.period";

/** Mois en cours — ce que consulte un manager neuf fois sur dix. */
function defaultPeriod(): Period {
    const now = new Date();
    return { startDate: startOfMonth(now), endDate: endOfMonth(now) };
}

/** Deux dates ISO vers une période, ou `null` si l'une ne tient pas debout. */
function fromIso(start: string | null | undefined, end: string | null | undefined): Period | null {
    if (!start || !end) return null;
    const startDate = startOfDay(parseISO(start));
    const endDate = endOfDay(parseISO(end));
    if (!isValid(startDate) || !isValid(endDate) || startDate > endDate) return null;
    return { startDate, endDate };
}

/**
 * Période à adopter au montage d'un écran.
 *
 * Ordre de priorité : un lien explicite l'emporte sur l'habitude, qui l'emporte
 * sur le mois en cours. Un lien de vignette porte `start` et `end` — il reste
 * ainsi interprétable une fois partagé par courriel — et c'est ici qu'ils sont
 * pris en compte.
 *
 * À appeler dans l'initialiseur d'un `useState`, donc de façon synchrone : la
 * période est juste dès le premier rendu, et l'écran n'a rien à attendre.
 */
export function readInitialPeriod(): Period {
    // Rendu serveur : ni URL ni stockage. Le mois en cours fait l'affaire, le
    // premier rendu client rectifiera si besoin.
    if (typeof window === "undefined") return defaultPeriod();

    try {
        const params = new URLSearchParams(window.location.search);
        const fromUrl = fromIso(params.get("start"), params.get("end"));
        if (fromUrl) return fromUrl;
    } catch {
        // URL illisible : on continue avec les sources suivantes.
    }

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const { start, end } = JSON.parse(raw) as { start?: string; end?: string };
            const stored = fromIso(start, end);
            if (stored) return stored;
        }
    } catch {
        // Valeur corrompue ou stockage indisponible : on retombe sur le défaut
        // plutôt que de propager des dates douteuses.
    }

    return defaultPeriod();
}

/**
 * Conserve la période choisie, pour que l'écran suivant la retrouve.
 *
 * N'échoue jamais : en navigation privée la période reste simplement valable
 * pour la session en cours.
 */
export function rememberPeriod(period: Period): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            start: format(period.startDate, "yyyy-MM-dd"),
            end: format(period.endDate, "yyyy-MM-dd"),
        }));
    } catch {
        // Stockage indisponible : rien à faire, et rien de grave.
    }
}
