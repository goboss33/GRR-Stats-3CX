/**
 * Parse un paramètre de requête (chaîne ISO ou `null`) en `Date`.
 * Retourne `defaultDate` si le paramètre est absent ou invalide.
 */
export function parseDateParam(param: string | null, defaultDate: Date): Date {
    if (!param) return defaultDate;
    const parsed = new Date(param);
    return isNaN(parsed.getTime()) ? defaultDate : parsed;
}
