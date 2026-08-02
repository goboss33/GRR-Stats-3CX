"use server";

import { ServerId, getPrismaCdr } from "@/lib/prisma-cdr";
import { requireActionRole } from "@/lib/auth-guard";
import { getClassificationRules } from "@/lib/classification-rules";
import { cdrTable, type ClassificationRules } from "@/services/domain/call-classification";
import type { CaseKind } from "@/components/settings/rules-config";

/**
 * Explorateur de cas réels de l'écran Règles métier.
 *
 * Pour chaque règle, on va chercher en base des appels DISCRIMINANTS : des
 * appels dont le sort change selon l'option choisie. L'administrateur tranche
 * alors sur pièce (« cet appel doit-il compter ? ») au lieu de lire de la
 * doctrine. La modale affiche ensuite le déroulement via getCallChain — le
 * même rendu que les logs.
 *
 * Réservé à l'ADMIN, comme la mesure d'impact : c'est un accès aux appels de
 * toutes les files, indépendamment du périmètre.
 */

export interface ExemplarCase {
    callHistoryId: string;
    startedAt: string;
}

const LIMIT = 5;

/** Fragment : les agents de la file (mêmes critères que le socle). */
function agentsCTE(cdr: string): string {
    return `agents AS (
        SELECT DISTINCT child.destination_dn_number AS extension
        FROM ${cdr} child
        JOIN ${cdr} parent ON child.originating_cdr_id = parent.cdr_id
        WHERE child.creation_method = 'route_to'
          AND child.creation_forward_reason = 'polling'
          AND parent.destination_dn_type = 'queue'
          AND parent.destination_dn_number = $1
          AND child.cdr_started_at >= $2 AND child.cdr_started_at <= $3
    )`;
}

/**
 * SQL de recherche des cas discriminants.
 *
 * Exporté (async, contrainte des modules "use server") pour être exerçable par
 * les scripts de vérification : ces requêtes ne sont couvertes par aucun test
 * unitaire, seule une exécution réelle prouve qu'elles tiennent.
 */
export async function buildFinderSQLForTests(kind: CaseKind, rules: ClassificationRules): Promise<string> {
    return buildFinderSQL(kind, rules);
}

function buildFinderSQL(kind: CaseKind, rules: ClassificationRules): string {
    const cdr = cdrTable(rules);
    // La recherche du cas « grain » lit TOUJOURS la vue fusionnée : le cas
    // sert précisément à choisir le grain, il faut voir les jambes reliées.
    const merged = "cdroutput_merged";

    switch (kind) {
        case "handoff":
            // Décroché par un agent du groupe, mais dernier décroché humain
            // hors du groupe : le transfert accompli.
            return `WITH ${agentsCTE(cdr)},
            team_answers AS (
                SELECT DISTINCT c.call_history_id, MIN(c.cdr_started_at) AS started_at
                FROM ${cdr} c
                WHERE c.cdr_answered_at IS NOT NULL
                  AND c.destination_dn_type = 'extension'
                  AND c.destination_dn_number IN (SELECT extension FROM agents)
                  AND c.cdr_started_at >= $2 AND c.cdr_started_at <= $3
                GROUP BY c.call_history_id
            ),
            last_answer AS (
                SELECT DISTINCT ON (c.call_history_id)
                    c.call_history_id, c.destination_dn_type AS t, c.destination_dn_number AS n
                FROM ${cdr} c
                WHERE c.cdr_answered_at IS NOT NULL
                  AND c.destination_dn_type IN ('extension', 'provider', 'external_line')
                  AND COALESCE(c.destination_entity_type, '') != 'voicemail'
                  AND c.cdr_started_at >= $2 AND c.cdr_started_at <= $3
                ORDER BY c.call_history_id, c.cdr_ended_at DESC, c.cdr_started_at DESC, c.cdr_id DESC
            )
            SELECT ta.call_history_id, ta.started_at
            FROM team_answers ta
            JOIN last_answer la USING (call_history_id)
            WHERE NOT (la.t = 'extension' AND la.n IN (SELECT extension FROM agents))
            ORDER BY ta.started_at DESC
            LIMIT ${LIMIT}`;

        case "voicemail":
            // Passé par la file, jamais décroché par un humain, fini sur la
            // messagerie : le cas dont la présence dans les « reçus » se discute.
            return `WITH passages AS (
                SELECT c.call_history_id, MIN(c.cdr_started_at) AS started_at
                FROM ${cdr} c
                WHERE c.destination_dn_type = 'queue' AND c.destination_dn_number = $1
                  AND c.cdr_started_at >= $2 AND c.cdr_started_at <= $3
                GROUP BY c.call_history_id
            )
            SELECT p.call_history_id, p.started_at
            FROM passages p
            WHERE EXISTS (
                    SELECT 1 FROM ${cdr} v
                    WHERE v.call_history_id = p.call_history_id
                      AND COALESCE(v.destination_entity_type, '') = 'voicemail')
              AND NOT EXISTS (
                    SELECT 1 FROM ${cdr} a
                    WHERE a.call_history_id = p.call_history_id
                      AND a.cdr_answered_at IS NOT NULL
                      AND a.destination_dn_type = 'extension'
                      AND COALESCE(a.destination_entity_type, '') != 'voicemail'
                      AND a.cdr_started_at >= $2 AND a.cdr_started_at <= $3)
            ORDER BY p.started_at DESC
            LIMIT ${LIMIT}`;

        case "grain":
            // Un appel fusionné composé de PLUSIEURS jambes 3CX touchant la file
            // ou ses agents : le cas qui matérialise le choix du grain.
            return `WITH ${agentsCTE(merged)},
            touched AS (
                SELECT c.call_history_id,
                       MIN(c.cdr_started_at) AS started_at,
                       COUNT(DISTINCT c.leg_call_history_id) AS legs
                FROM ${merged} c
                WHERE c.cdr_started_at >= $2 AND c.cdr_started_at <= $3
                  AND ((c.destination_dn_type = 'queue' AND c.destination_dn_number = $1)
                       OR (c.destination_dn_type = 'extension'
                           AND c.destination_dn_number IN (SELECT extension FROM agents)))
                GROUP BY c.call_history_id
            )
            SELECT call_history_id, started_at
            FROM touched
            WHERE legs > 1
            ORDER BY started_at DESC
            LIMIT ${LIMIT}`;

        case "pingpong":
            // Au moins deux passages dans la même file, dont un décroché : le
            // cas qui matérialise « une fois ou deux fois ? ».
            return `WITH passages AS (
                SELECT c.call_history_id, c.cdr_id, MIN(c.cdr_started_at) AS started_at,
                       bool_or(EXISTS (
                           SELECT 1 FROM ${cdr} p
                           WHERE p.originating_cdr_id = c.cdr_id
                             AND p.creation_forward_reason = 'polling'
                             AND p.destination_dn_type = 'extension'
                             AND p.cdr_answered_at IS NOT NULL)) AS answered
                FROM ${cdr} c
                WHERE c.destination_dn_type = 'queue' AND c.destination_dn_number = $1
                  AND c.cdr_started_at >= $2 AND c.cdr_started_at <= $3
                GROUP BY c.call_history_id, c.cdr_id
            )
            SELECT call_history_id, MIN(started_at) AS started_at
            FROM passages
            GROUP BY call_history_id
            HAVING COUNT(*) >= 2 AND bool_or(answered)
            ORDER BY MIN(started_at) DESC
            LIMIT ${LIMIT}`;

        case "short_abandon":
            // Passage en file très court, sans décroché ni débordement ni
            // messagerie : l'abandon express dont le comptage se discute.
            return `SELECT c.call_history_id, MIN(c.cdr_started_at) AS started_at
            FROM ${cdr} c
            WHERE c.destination_dn_type = 'queue' AND c.destination_dn_number = $1
              AND c.cdr_started_at >= $2 AND c.cdr_started_at <= $3
              AND EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_started_at)) < COALESCE(${rules.shortAbandonThresholdSeconds ?? 10}, 10)
              AND NOT EXISTS (
                    SELECT 1 FROM ${cdr} p
                    WHERE p.originating_cdr_id = c.cdr_id
                      AND p.creation_forward_reason = 'polling'
                      AND p.cdr_answered_at IS NOT NULL)
              AND NOT EXISTS (
                    SELECT 1 FROM ${cdr} o
                    WHERE o.call_history_id = c.call_history_id
                      AND o.destination_dn_type = 'queue'
                      AND o.destination_dn_number <> $1
                      AND o.cdr_started_at > c.cdr_started_at)
              AND NOT EXISTS (
                    SELECT 1 FROM ${cdr} v
                    WHERE v.call_history_id = c.call_history_id
                      AND COALESCE(v.destination_entity_type, '') = 'voicemail')
            GROUP BY c.call_history_id
            ORDER BY MIN(c.cdr_started_at) DESC
            LIMIT ${LIMIT}`;
    }
}

/**
 * Cherche des appels discriminants pour une règle, dans une file et sur les
 * 30 derniers jours (assez récent pour parler, assez large pour trouver).
 */
export async function findExemplarCases(
    serverId: ServerId,
    kind: CaseKind,
    queueNumber: string,
): Promise<ExemplarCase[]> {
    await requireActionRole(["ADMIN"]);

    const prisma = getPrismaCdr(serverId);
    const rules = await getClassificationRules();
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    const rows = await prisma.$queryRawUnsafe<{ call_history_id: string; started_at: Date }[]>(
        buildFinderSQL(kind, rules), queueNumber, start, end,
    );

    return rows.map((r) => ({
        callHistoryId: r.call_history_id,
        startedAt: r.started_at.toISOString(),
    }));
}
