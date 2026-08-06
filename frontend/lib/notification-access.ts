/**
 * Droit de voir la cloche d'alertes (anomalies détectées).
 *
 * `canViewNotifications` est NULLABLE : null = « non arbitré », et le défaut
 * se calcule alors par RÔLE — activé pour les rôles globaux (ADMIN,
 * MODERATOR), désactivé pour les managers. Un ADMIN peut ensuite trancher au
 * cas par cas depuis la fiche utilisateur : la valeur explicite l'emporte.
 *
 * Le CONTENU des alertes reste dans tous les cas filtré par le périmètre du
 * lecteur (cf. services/notifications.service) : ce droit n'ouvre aucun
 * nouvel accès aux données, seulement l'affichage du canal.
 */
export function effectiveCanViewNotifications(user: {
    role: string;
    canViewNotifications: boolean | null;
}): boolean {
    return user.canViewNotifications ?? (user.role === "ADMIN" || user.role === "MODERATOR");
}
