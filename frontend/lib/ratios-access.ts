/**
 * Niveau d'affichage des ratios (dénominateurs « 85/111 ») du tableau de
 * performance des agents.
 *
 * `agentRatiosLevel` est NULLABLE : null = « non arbitré », et le défaut se
 * calcule alors par RÔLE — tout visible pour les rôles globaux (ADMIN,
 * MODERATOR), rien pour les managers : les dénominateurs (sollicitations,
 * appels reçus) parlent aux analystes mais brouillent la lecture des
 * managers. Un ADMIN peut ensuite trancher au cas par cas depuis la fiche
 * utilisateur : la valeur explicite l'emporte.
 *
 * Ce droit ne touche que l'AFFICHAGE d'une décomposition ; les chiffres
 * principaux restent identiques pour tout le monde.
 */

export type AgentRatiosLevel = "none" | "totals" | "all";

export function effectiveAgentRatiosLevel(user: {
    role: string;
    agentRatiosLevel: string | null;
}): AgentRatiosLevel {
    if (user.agentRatiosLevel === "none" || user.agentRatiosLevel === "totals" || user.agentRatiosLevel === "all") {
        return user.agentRatiosLevel;
    }
    return user.role === "ADMIN" || user.role === "MODERATOR" ? "all" : "none";
}
