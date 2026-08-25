// Densification de la courbe d'évolution.
//
// Le SQL de la courbe (GROUP BY date_trunc(... AT TIME ZONE tz)) ne produit
// AUCUNE ligne pour un jour ou une heure sans appel : les week-ends
// disparaissaient de l'axe et la courbe N-1 se trouait au lieu de descendre
// à zéro. Ce module énumère TOUS les seaux attendus d'une fenêtre, dans le
// fuseau du tenant.
//
// Convention de clé : le « temps mural encodé UTC » — Date.UTC(année, mois,
// jour[, heure]) des composantes LOCALES. C'est exactement ce que produit
// date_trunc(... AT TIME ZONE tz) une fois lu par new Date(row.date_group)
// (le service formate d'ailleurs les libellés via getUTCDate/getUTCHours).
// Dans cet espace purement calendaire, +24 h vaut toujours +1 jour : les
// changements d'heure n'y existent pas.

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// Garde-fou contre une fenêtre aberrante (un an de jours = 366 seaux ;
// deux jours d'heures = 48).
const MAX_BUCKETS = 3000;

/** Composantes locales d'un instant, encodées en millisecondes UTC. */
export function wallClockMs(instant: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(instant);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"), instant.getMilliseconds());
}

/**
 * Tous les seaux (en temps mural encodé UTC) que la fenêtre doit afficher :
 * du début TRONQUÉ au seau, jusqu'au dernier seau qui COMMENCE avant la fin
 * de fenêtre. La comparaison se fait en temps mural, ce qui rend la borne de
 * fin correcte qu'elle soit inclusive (23:59:59.999) ou exclusive (minuit
 * pile du lendemain).
 */
export function enumerateWallBuckets(
    startDate: Date,
    endDate: Date,
    timeZone: string,
    unit: "hour" | "day"
): number[] {
    const step = unit === "hour" ? HOUR_MS : DAY_MS;
    const startWall = wallClockMs(startDate, timeZone);
    const endWall = wallClockMs(endDate, timeZone);
    const first = Math.floor(startWall / step) * step;
    const buckets: number[] = [];
    for (let t = first; t < endWall && buckets.length < MAX_BUCKETS; t += step) {
        buckets.push(t);
    }
    return buckets;
}
