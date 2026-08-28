/**
 * Cadence du relevé nocturne du journal d'équipe.
 *
 * Le relevé doit tomber à 3 h du matin. La première écriture de cette règle
 * disait « au moins 24 h depuis le dernier relevé ET il est au moins 3 h » —
 * ce qui n'impose rien : de 3 h à minuit, la condition d'heure est toujours
 * vraie. Un premier relevé déclenché à 11 h 38 par un redéploiement fixait
 * donc la cadence à 11 h 38, puis 11 h 40, puis 12 h 07 — elle dérivait, et
 * ne revenait jamais vers la nuit.
 *
 * La règle exprime maintenant l'intention directement : le prochain relevé
 * est le PREMIER 3 h qui suit le dernier. Un conteneur endormi à 3 h rattrape
 * dès son réveil, et le relevé suivant retourne à 3 h — la cible est
 * calculée sur le calendrier, pas sur « dernier + 24 h ».
 *
 * Fonctions pures : testables sans base ni horloge réelle.
 */

/** Heure locale visée pour le relevé (serveur). */
export const HEURE_NOCTURNE = 3;

/**
 * Premier passage à `heure` STRICTEMENT après `dernier`, en heure locale.
 *
 * Les changements d'heure sont laissés à la plateforme : `setHours` travaille
 * en heure locale, donc la nuit du passage à l'heure d'été (où 3 h n'existe
 * pas) glisse d'une heure — sans conséquence pour un relevé quotidien.
 */
export function prochainReleveApres(dernier: Date, heure: number = HEURE_NOCTURNE): Date {
    const cible = new Date(dernier);
    cible.setHours(heure, 0, 0, 0);
    if (cible.getTime() <= dernier.getTime()) {
        cible.setDate(cible.getDate() + 1);
    }
    return cible;
}

/**
 * Un relevé est-il attendu ?
 *
 * `null` = jamais relevé : on démarre l'histoire tout de suite, sans attendre
 * la nuit — sinon un tenant qui vient d'activer la surcouche resterait sans
 * journal jusqu'au lendemain.
 */
export function releveAttendu(
    dernier: Date | null,
    maintenant: Date,
    heure: number = HEURE_NOCTURNE,
): boolean {
    if (!dernier) return true;
    return maintenant.getTime() >= prochainReleveApres(dernier, heure).getTime();
}
