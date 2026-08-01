import { prismaAuth } from "@/lib/prisma-auth";
import {
    DEFAULT_CLASSIFICATION_RULES,
    type ClassificationRules,
} from "@/services/domain/call-classification";

/**
 * Chargement des règles de classement depuis les réglages globaux.
 *
 * Ces règles entrent dans la construction du SQL de CHAQUE requête de
 * statistiques et de logs. Les relire en base à chaque appel ajouterait un
 * aller-retour sur la base d'authentification au cœur des chemins les plus
 * sollicités — d'où ce cache mémoire.
 *
 * Conséquence assumée : une modification met jusqu'à `TTL_MS` à se propager, et
 * chaque instance a son propre cache. L'écran de réglages le dit à l'utilisateur
 * plutôt que de laisser croire à un effet immédiat.
 */
const TTL_MS = 30_000;

let cache: { rules: ClassificationRules; expiresAt: number } | null = null;

/** Vide le cache — appelé après une écriture pour que l'auteur voie son effet. */
export function invalidateClassificationRules(): void {
    cache = null;
}

/** Normalise une valeur venue de la base ; toute valeur inconnue retombe sur le défaut. */
function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
}

export async function getClassificationRules(): Promise<ClassificationRules> {
    if (cache && cache.expiresAt > Date.now()) return cache.rules;

    let rules = DEFAULT_CLASSIFICATION_RULES;
    try {
        const row = await prismaAuth.appSettings.findUnique({
            where: { id: "global" },
            select: {
                ruleMultiPassage: true,
                ruleOverflow: true,
                ruleShortAbandonSec: true,
                ruleDirectAndQueue: true,
                ruleVoicemail: true,
                ruleOutOfScopeFinalStatus: true,
                ruleMinAnswerSec: true,
                ruleCallGrain: true,
                ruleAnsweredThenTransferred: true,
                ruleAgentCredit: true,
                ruleHandedOffInPerformance: true,
            },
        });

        if (row) {
            rules = {
                multiPassage: pick(row.ruleMultiPassage, ["best", "last", "each"] as const, "best"),
                overflow: pick(row.ruleOverflow, ["neutral", "lost", "answered"] as const, "neutral"),
                // `null` est une valeur légitime : elle désactive la règle.
                shortAbandonThresholdSeconds: row.ruleShortAbandonSec ?? null,
                directAndQueue: pick(row.ruleDirectAndQueue, ["firstContact", "queueWins", "both"] as const, "firstContact"),
                voicemail: pick(row.ruleVoicemail, ["separate", "lost", "answered", "excluded"] as const, "separate"),
                outOfScopeFinalStatus: pick(row.ruleOutOfScopeFinalStatus, ["name", "anonymize", "hide"] as const, "name"),
                minAnswerSeconds: typeof row.ruleMinAnswerSec === "number" ? row.ruleMinAnswerSec : 1,
                callGrain: pick(row.ruleCallGrain, ["leg", "merged"] as const, "leg"),
                answeredThenTransferred: pick(row.ruleAnsweredThenTransferred, ["overflow", "answered"] as const, "overflow"),
                agentCredit: pick(row.ruleAgentCredit, ["lastAnswer", "each"] as const, "lastAnswer"),
                handedOffInPerformance: pick(row.ruleHandedOffInPerformance, ["success", "neutral"] as const, "success"),
            };
        }
    } catch {
        // Une base indisponible ne doit pas faire tomber les statistiques : on
        // sert les valeurs par défaut, qui sont celles arbitrées avec le métier.
        rules = DEFAULT_CLASSIFICATION_RULES;
    }

    cache = { rules, expiresAt: Date.now() + TTL_MS };
    return rules;
}
