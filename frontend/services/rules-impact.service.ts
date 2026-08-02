"use server";

import { getPrismaCdr, ServerId } from "@/lib/prisma-cdr";
import { requireActionRole } from "@/lib/auth-guard";
import { getClassificationRules } from "@/lib/classification-rules";
import {
    buildTeamCTEChain,
    sumBucket,
    type ClassificationRules,
    type PassageOutcome,
} from "@/services/domain/call-classification";

/**
 * Mesure de l'effet d'un réglage avant de l'enregistrer.
 *
 * Les règles de classement sont des abstractions tant qu'on n'en voit pas la
 * conséquence chiffrée. Cette mesure rejoue le calcul sur une file et une
 * période réelles, avec les règles enregistrées puis avec celles envisagées, et
 * rend les deux résultats côte à côte.
 *
 * Elle interroge la base CDR à chaque appel : d'où la période volontairement
 * courte proposée par l'écran.
 */

export interface RulesImpactCounts {
    received: number;
    answered: number;
    lost: number;
    overflow: number;
    /** Appels repassant plusieurs fois dans la file : le volume en jeu. */
    multiPassageCalls: number;
}

export interface RulesImpact {
    queueNumber: string;
    current: RulesImpactCounts;
    candidate: RulesImpactCounts;
}

async function countWithRules(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date,
    rules: ClassificationRules,
): Promise<RulesImpactCounts> {
    const prisma = getPrismaCdr(serverId);

    const rows = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(
        `WITH ${buildTeamCTEChain(rules, { queueExpr: "$1", startExpr: "$2", endExpr: "$3" })}
         SELECT
             (SELECT COUNT(*) FROM queue_calls WHERE outcome = 'answered')      AS answered,
             (SELECT COUNT(*) FROM queue_calls WHERE outcome = 'handed_off')    AS handed_off,
             (SELECT COUNT(*) FROM queue_calls WHERE outcome = 'overflow')      AS overflow,
             (SELECT COUNT(*) FROM queue_calls WHERE outcome = 'voicemail')     AS voicemail,
             (SELECT COUNT(*) FROM queue_calls WHERE outcome = 'short_abandon') AS short_abandon,
             (SELECT COUNT(*) FROM queue_calls WHERE outcome = 'abandoned')     AS abandoned,
             (SELECT COUNT(*) FROM direct_calls)                                AS direct_total,
             (SELECT COUNT(*) FROM direct_calls WHERE outcome = 'answered')     AS direct_answered,
             (SELECT COUNT(*) FROM direct_calls WHERE outcome = 'handed_off')   AS direct_handed_off,
             (SELECT COUNT(*) FROM (
                  SELECT call_history_id FROM queue_passages
                  GROUP BY call_history_id HAVING COUNT(*) > 1
              ) m)                                                              AS multi_passage`,
        queueNumber, startDate, endDate,
    );

    const r = rows[0];
    const counts: Partial<Record<PassageOutcome, number>> = {
        answered: Number(r.answered),
        handed_off: Number(r.handed_off),
        overflow: Number(r.overflow),
        voicemail: Number(r.voicemail),
        short_abandon: Number(r.short_abandon),
        abandoned: Number(r.abandoned),
    };

    const directTotal = Number(r.direct_total);
    const directAnswered = Number(r.direct_answered);
    const directHandedOff = Number(r.direct_handed_off);

    // Mêmes regroupements que les vignettes : ce sont ces quatre chiffres que
    // l'administrateur reconnaîtra sur l'écran de statistiques.
    return {
        received: sumBucket(counts, "received") + directTotal,
        answered: sumBucket(counts, "answered") + directAnswered,
        lost: sumBucket(counts, "lost") + (directTotal - directAnswered - directHandedOff),
        overflow: sumBucket(counts, "overflow") + directHandedOff,
        multiPassageCalls: Number(r.multi_passage),
    };
}

/**
 * Compare les chiffres d'une file sous les règles enregistrées et sous celles
 * envisagées. Réservé à l'ADMIN : c'est un accès aux données de toutes les
 * files, indépendamment du périmètre.
 */
export async function measureRulesImpact(
    serverId: ServerId,
    queueNumber: string,
    startDate: Date,
    endDate: Date,
    candidate: ClassificationRules,
): Promise<RulesImpact> {
    await requireActionRole(["ADMIN"]);

    // Garde-fou : une période longue ferait une requête très coûteuse sur la
    // base de production, déclenchée par un simple clic.
    const days = (endDate.getTime() - startDate.getTime()) / 86_400_000;
    if (days > 62) {
        throw new Error("La mesure d'impact est limitée à deux mois de données.");
    }

    const current = await getClassificationRules();
    const [currentCounts, candidateCounts] = await Promise.all([
        countWithRules(serverId, queueNumber, startDate, endDate, current),
        countWithRules(serverId, queueNumber, startDate, endDate, candidate),
    ]);

    return { queueNumber, current: currentCounts, candidate: candidateCounts };
}

/**
 * Impact d'UNE règle, toutes choses égales par ailleurs : on compare les
 * réglages en cours d'édition à eux-mêmes, cette règle seule basculée sur son
 * autre valeur. Répond à « qu'est-ce que CE choix change ? », là où la mesure
 * globale répond à « qu'est-ce que mes modifications changent ? ».
 *
 * Renvoie une phrase prête à afficher — les écarts sur les quatre vignettes.
 */
export async function measureSingleRule(
    serverId: ServerId,
    queueNumber: string,
    days: number,
    editing: ClassificationRules,
    alternative: ClassificationRules,
): Promise<string> {
    await requireActionRole(["ADMIN"]);

    const end = new Date();
    const start = new Date(end.getTime() - Math.min(days, 62) * 86_400_000);
    const [a, b] = await Promise.all([
        countWithRules(serverId, queueNumber, start, end, editing),
        countWithRules(serverId, queueNumber, start, end, alternative),
    ]);

    const parts: string[] = [];
    const diff = (label: string, x: number, y: number) => {
        const d = x - y;
        if (d !== 0) parts.push(`${d > 0 ? "+" : ""}${d} ${label}`);
    };
    diff("reçus", a.received, b.received);
    diff("répondus", a.answered, b.answered);
    diff("perdus", a.lost, b.lost);
    diff("redirigés", a.overflow, b.overflow);

    if (parts.length === 0) return "Ce choix ne change aucun chiffre sur cette période.";
    return `Par rapport à l'autre option : ${parts.join(" · ")} (30 derniers jours).`;
}
