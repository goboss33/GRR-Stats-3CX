import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "../auth";
import { getPrismaCdr, ServerId } from "@/lib/prisma-cdr";
import { getDefaultServer, isValidServer } from "@/lib/servers";
import { parseDateParam } from "@/lib/date-params";
import { logger } from "@/lib/logger";
import { resolveApiKeyScope, isQueueInScope } from "@/lib/access-scope";
import {
    buildTeamCTEChain,
    cdrTable,
    type CallOrigin,
} from "@/services/domain/call-classification";
import { SQL_REAL_PARTY_DEST_TYPES } from "@/services/domain/call-aggregation";
import { DEPARTED_OUTCOMES } from "@/services/domain/destinations-appels";
import { getClassificationRules } from "@/lib/classification-rules";
import { resolveRosterForRules } from "@/services/xapi-journal.service";

export async function GET(request: NextRequest) {
    const authResult = await validateApiKey(request);
    if (!authResult.valid) return authResult.response;

    try {
        const url = new URL(request.url);
        const serverParam = url.searchParams.get("server");
        const serverId: ServerId = serverParam && isValidServer(serverParam) 
            ? serverParam as ServerId 
            : getDefaultServer();
        
        const prisma = getPrismaCdr(serverId);
        
        // La clé API hérite du périmètre de son propriétaire : sans cela, un
        // manager créerait une clé et lirait toutes les files via l'API.
        const scope = await resolveApiKeyScope(authResult.apiKeyId, serverId);

        const queueNumber = url.searchParams.get("queueNumber");
        logger.debug("[queue/route] Received queueNumber:", queueNumber);
        if (!queueNumber) {
            return NextResponse.json({ error: "queueNumber parameter is required" }, { status: 400 });
        }
        if (!isQueueInScope(scope, queueNumber)) {
            return NextResponse.json({ error: "Cette file d'attente n'est pas dans votre périmètre" }, { status: 403 });
        }

        const start = parseDateParam(url.searchParams.get("start"), new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
        const end = parseDateParam(url.searchParams.get("end"), new Date());
        logger.debug("[queue/route] Date range:", { start, end });

        // Les KPIs et le filtre de parcours des logs consomment désormais LE MÊME
        // socle de classement (services/domain/call-classification.ts). C'est ce
        // qui garantit qu'un clic sur un KPI ramène exactement autant de lignes
        // que le chiffre affiché — auparavant les deux SQL divergeaient.
        const rules = await getClassificationRules();
        // Règle « source de l'équipe » : roster FERMÉ du journal XAPI quand la
        // fenêtre est sous son régime, sinon null = roster déduit de l'activité.
        const rosterMembers = await resolveRosterForRules(rules, serverId, queueNumber, start, end);

        // Provenance des appels (toggle Externe / Interne / Les deux).
        const originParam = url.searchParams.get("origin");
        const origin: CallOrigin = originParam === "internal" || originParam === "external"
            ? originParam : "both";

        // Sorts « partis » (transféré, débordé) en littéraux SQL, depuis la
        // constante partagée avec la carte des destinations.
        const departedList = DEPARTED_OUTCOMES.map((o) => `'${o}'`).join(", ");

        // Requête paramétrée : $1 = queueNumber (texte), $2 = start, $3 = end (Date).
        const query = `
            WITH ${buildTeamCTEChain(rules, { queueExpr: "$1", startExpr: "$2", endExpr: "$3", origin, rosterMembers })},
            queue_kpis AS (
                SELECT
                    COUNT(*) as unique_calls,
                    COUNT(*) FILTER (WHERE outcome = 'answered') as unique_answered,
                    COUNT(*) FILTER (WHERE outcome = 'abandoned') as unique_abandoned,
                    COUNT(*) FILTER (WHERE outcome = 'short_abandon') as unique_short_abandon,
                    COUNT(*) FILTER (WHERE outcome = 'overflow') as unique_overflow,
                    COUNT(*) FILTER (WHERE outcome = 'handed_off') as unique_handed_off,
                    COUNT(*) FILTER (WHERE outcome = 'voicemail') as unique_voicemail,
                    ROUND(AVG(answer_wait_seconds)::numeric, 1) as avg_wait_time,
                    ROUND(AVG(talk_seconds) FILTER (WHERE outcome = 'answered')::numeric, 1) as avg_talk_time
                FROM queue_calls
            ),
            passage_count AS (SELECT COUNT(*) as n FROM queue_passages),
            -- Hors horaires : exclus de queue_calls par construction ; comptés
            -- ici à titre d'information (API, Excel), jamais dans une vignette.
            hors_horaires AS (SELECT COUNT(*) as n FROM call_queue_outcomes WHERE outcome = 'out_of_hours'),
            direct_calls_stats AS (
                SELECT
                    COUNT(*) as direct_received,
                    COUNT(*) FILTER (WHERE outcome = 'answered') as direct_answered,
                    COUNT(*) FILTER (WHERE outcome = 'handed_off') as direct_handed_off,
                    COUNT(*) FILTER (WHERE outcome = 'overflow') as direct_overflow
                FROM direct_calls
            ),
            overflow_destinations AS (
                SELECT
                    other_q.destination_dn_number as destination,
                    COALESCE(other_q.destination_dn_name, other_q.destination_dn_number) as destination_name,
                    COUNT(DISTINCT qc.call_history_id) as count
                FROM queue_calls qc
                -- Corrélation par appel : même grain que queue_calls, sinon les
                -- segments des jambes fusionnées échapperaient à la jointure.
                JOIN ${cdrTable(rules)} other_q ON other_q.call_history_id = qc.call_history_id
                    AND other_q.destination_dn_type = 'queue'
                    AND other_q.destination_dn_number != $1
                WHERE qc.outcome IN ('overflow', 'handed_off')
                GROUP BY other_q.destination_dn_number, other_q.destination_dn_name
                ORDER BY count DESC
                LIMIT 10
            ),
            -- « D'où viennent nos appels » : les appels reçus ici PARCE QU'une
            -- autre équipe ne les a pas pris, par file d'origine (la file
            -- sollicitée juste avant la nôtre, cf. from_queue du socle).
            -- Population = queue_calls, donc les mêmes règles que les
            -- vignettes : la somme est un sous-ensemble exact de « Reçus ».
            -- Le nom retenu est le plus récent de la période — une file
            -- renommée reste la même équipe ; le service superpose ensuite
            -- l'annuaire du PBX quand il la connaît.
            inbound_sources AS (
                SELECT
                    qc.from_queue AS queue_number,
                    (ARRAY_AGG(qc.from_queue_name ORDER BY qc.cdr_started_at DESC))[1] AS queue_name,
                    COUNT(*) AS calls
                FROM queue_calls qc
                WHERE qc.from_queue IS NOT NULL
                GROUP BY qc.from_queue
            ),
            -- « Où partent nos appels » : les appels transférés (décrochés ici,
            -- servis ailleurs) et débordés (partis sans décroché), file ET
            -- directs — la même population que les vignettes Transférés +
            -- Débordés. Pour chacun, la PREMIÈRE destination après nous : une
            -- file (débordement, transfert vers la file, ligne directe renvoyée
            -- dans une file), une personne jointe sur sa ligne directe, un
            -- numéro externe, ou rien. Une personne jointe par la distribution
            -- d'une file est rattachée à cette file ; jointe sur sa ligne
            -- directe, le service la rattache à son équipe principale.
            departures AS (
                SELECT call_history_id, outcome, cdr_started_at AS left_after FROM queue_calls
                WHERE outcome IN (${departedList})
                UNION ALL
                SELECT call_history_id, outcome, started_at FROM direct_calls
                WHERE outcome IN (${departedList})
            ),
            exits_raw AS (
                SELECT d.outcome,
                       -- Le PREMIER SAUT après nous, dans l'ordre du temps : la
                       -- ligne directe visée par un transfert (qu'elle réponde
                       -- ou non), sinon la file sollicitée, sinon la personne
                       -- qui a fini par décrocher. Prendre la ligne directe même
                       -- sans réponse est décisif : un transfert non pris
                       -- retombe dans la file de l'équipe du destinataire, et
                       -- l'appel paraissait alors « parti vers cette file »
                       -- alors qu'il était parti vers QUELQU'UN (mesuré le
                       -- 8 sept. 2026 : les 64 départs du Service Client rangés
                       -- sous une file visaient tous une ligne directe).
                       CASE WHEN dir.extension IS NOT NULL
                                 AND (nxt.queue_number IS NULL OR dir.started_at <= nxt.started_at) THEN 'person'
                            WHEN nxt.queue_number IS NOT NULL
                                 AND (fo.extension IS NULL OR nxt.started_at <= fo.started_at) THEN 'queue'
                            WHEN fo.dest_type = 'extension' THEN 'person'
                            WHEN fo.dest_type IS NOT NULL THEN 'external'
                            ELSE 'none' END AS first_hop,
                       nxt.queue_number, nxt.queue_name, nxt.started_at AS queue_at,
                       dir.extension AS dir_extension, dir.person_name AS dir_person_name, dir.started_at AS dir_at,
                       fo.extension, fo.person_name, fo.via_queue
                FROM departures d
                LEFT JOIN LATERAL (
                    -- Première autre file sollicitée après notre passage.
                    SELECT o.destination_dn_number AS queue_number,
                           COALESCE(NULLIF(o.destination_dn_name, ''), o.destination_dn_number) AS queue_name,
                           o.cdr_started_at AS started_at
                    FROM ${cdrTable(rules)} o
                    WHERE o.call_history_id = d.call_history_id
                      AND o.destination_dn_type = 'queue'
                      AND o.destination_dn_number <> $1
                      AND o.cdr_started_at > d.left_after
                    ORDER BY o.cdr_started_at ASC
                    LIMIT 1
                ) nxt ON TRUE
                LEFT JOIN LATERAL (
                    -- Premier correspondant HORS équipe qui a décroché après nous,
                    -- mêmes critères que le « dernier décroché humain » du socle
                    -- (buildServedInTeamSQL), et la file dont la distribution
                    -- l'a atteint quand c'est le cas (sonnerie « polling »).
                    SELECT la.destination_dn_type AS dest_type,
                           la.destination_dn_number AS extension,
                           COALESCE(NULLIF(la.destination_dn_name, ''), NULLIF(la.destination_participant_name, ''), la.destination_dn_number) AS person_name,
                           q.destination_dn_number AS via_queue,
                           la.cdr_started_at AS started_at
                    FROM ${cdrTable(rules)} la
                    LEFT JOIN ${cdrTable(rules)} q
                           ON (la.creation_forward_reason = 'polling' OR la.creation_method = 'transfer')
                          AND q.cdr_id = la.originating_cdr_id
                          AND q.destination_dn_type = 'queue'
                    WHERE la.call_history_id = d.call_history_id
                      AND la.cdr_answered_at IS NOT NULL
                      AND la.destination_dn_type IN (${SQL_REAL_PARTY_DEST_TYPES})
                      AND COALESCE(la.destination_entity_type, '') <> 'voicemail'
                      AND la.destination_dn_number NOT IN (SELECT extension FROM queue_agents)
                      AND la.cdr_started_at > d.left_after
                      AND la.cdr_started_at <= $3
                    ORDER BY la.cdr_answered_at ASC, la.cdr_id ASC
                    LIMIT 1
                ) fo ON TRUE
                LEFT JOIN LATERAL (
                    -- Première LIGNE DIRECTE visée hors de l'équipe, répondue ou
                    -- non : le transfert que l'agent a fait. Les sonneries de
                    -- file (« polling ») sont exclues — elles ne visent
                    -- personne en particulier —, ainsi que la messagerie et les
                    -- segments trop courts pour être une vraie sollicitation.
                    SELECT la.destination_dn_number AS extension,
                           COALESCE(NULLIF(la.destination_dn_name, ''), NULLIF(la.destination_participant_name, ''), la.destination_dn_number) AS person_name,
                           la.cdr_started_at AS started_at
                    FROM ${cdrTable(rules)} la
                    WHERE la.call_history_id = d.call_history_id
                      AND la.destination_dn_type = 'extension'
                      AND COALESCE(la.destination_entity_type, '') <> 'voicemail'
                      AND la.creation_forward_reason IS DISTINCT FROM 'polling'
                      AND la.destination_dn_number NOT IN (SELECT extension FROM queue_agents)
                      AND la.cdr_started_at > d.left_after
                      AND la.cdr_started_at <= $3
                      AND (la.cdr_answered_at IS NOT NULL
                           OR EXTRACT(EPOCH FROM (la.cdr_ended_at - la.cdr_started_at)) >= ${rules.minSignificantDurationSeconds})
                    ORDER BY la.cdr_started_at ASC, la.cdr_id ASC
                    LIMIT 1
                ) dir ON TRUE
            ),
            exits AS (
                SELECT outcome, first_hop, queue_number,
                       -- Une file renommée sur la période reste la même équipe :
                       -- son nom le plus récent. Un poste réattribué, lui, reste
                       -- deux personnes : le nom d'époque fait partie de la clé.
                       (ARRAY_AGG(queue_name ORDER BY queue_at DESC NULLS LAST))[1] AS queue_name,
                       extension, person_name,
                       COUNT(*) AS calls
                FROM (
                    SELECT outcome, first_hop,
                           CASE WHEN first_hop = 'queue' THEN queue_number END AS queue_number,
                           CASE WHEN first_hop = 'queue' THEN queue_name END AS queue_name,
                           queue_at,
                           -- Le visage : la personne à qui l'appel a été passé
                           -- (transfert vers sa ligne directe, répondu ou non),
                           -- ou celle qui a décroché DANS la file de destination.
                           CASE WHEN first_hop = 'person' THEN COALESCE(dir_extension, extension)
                                WHEN first_hop = 'queue' AND via_queue = queue_number THEN extension END AS extension,
                           CASE WHEN first_hop = 'person' THEN COALESCE(dir_person_name, person_name)
                                WHEN first_hop = 'queue' AND via_queue = queue_number THEN person_name END AS person_name
                    FROM exits_raw
                ) x
                GROUP BY 1, 2, 3, 5, 6
            ),
            -- Appartenance et volume par file des personnes qui apparaissent
            -- dans les sorties : SONNERIES seulement — « membre = sonné par la
            -- file » (décision 1.19). Sert deux fois : départager l'équipe
            -- principale d'une personne jointe sur sa ligne directe, et
            -- vérifier qu'un visage appartient bien à la file sous laquelle il
            -- s'affiche. Compter aussi les transferts ferait passer pour
            -- membre de la réception quiconque reçoit d'elle un appel.
            person_teams AS (
                SELECT a.destination_dn_number AS extension,
                       q.destination_dn_number AS queue_number,
                       (ARRAY_AGG(COALESCE(NULLIF(q.destination_dn_name, ''), q.destination_dn_number) ORDER BY a.cdr_started_at DESC))[1] AS queue_name,
                       COUNT(*) AS calls,
                       MAX(a.cdr_started_at) AS last_at
                FROM ${cdrTable(rules)} a
                JOIN ${cdrTable(rules)} q ON q.cdr_id = a.originating_cdr_id AND q.destination_dn_type = 'queue'
                WHERE a.creation_method = 'route_to'
                  AND a.creation_forward_reason = 'polling'
                  AND a.destination_dn_type = 'extension'
                  AND a.destination_dn_number IN (SELECT DISTINCT e.extension FROM exits e WHERE e.extension IS NOT NULL)
                  AND a.cdr_started_at >= $2 AND a.cdr_started_at <= $3
                GROUP BY 1, 2
            ),
            queue_name AS (
                SELECT COALESCE(destination_dn_name, destination_dn_number) as name
                FROM cdroutput
                WHERE destination_dn_number = $1 AND destination_dn_type = 'queue'
                LIMIT 1
            )
            SELECT
                qn.name as queue_name,
                qk.unique_calls,
                qk.unique_answered,
                qk.unique_abandoned,
                qk.unique_short_abandon,
                qk.unique_overflow,
                qk.unique_handed_off,
                qk.unique_voicemail,
                pc.n as total_passages,
                hh.n as hors_horaires,
                qk.avg_wait_time,
                qk.avg_talk_time,
                COALESCE(dcs.direct_received, 0) as direct_received,
                COALESCE(dcs.direct_answered, 0) as direct_answered,
                COALESCE(dcs.direct_handed_off, 0) as direct_handed_off,
                COALESCE(dcs.direct_overflow, 0) as direct_overflow,
                COALESCE(
                    (SELECT json_agg(json_build_object('destination', od.destination, 'destinationName', od.destination_name, 'count', od.count))
                     FROM overflow_destinations od),
                    '[]'
                ) as overflow_destinations,
                COALESCE(
                    (SELECT json_agg(json_build_object('queueNumber', s.queue_number, 'queueName', s.queue_name, 'calls', s.calls)
                                     ORDER BY s.calls DESC, s.queue_number)
                     FROM inbound_sources s),
                    '[]'
                ) as inbound_sources,
                COALESCE(
                    (SELECT json_agg(json_build_object(
                        'outcome', e.outcome, 'firstHop', e.first_hop,
                        'queueNumber', e.queue_number, 'queueName', e.queue_name,
                        'extension', e.extension, 'personName', e.person_name, 'calls', e.calls))
                     FROM exits e),
                    '[]'
                ) as outbound_exits,
                COALESCE(
                    (SELECT json_agg(json_build_object(
                        'extension', t.extension, 'queueNumber', t.queue_number, 'queueName', t.queue_name,
                        'calls', t.calls, 'lastAt', t.last_at))
                     FROM person_teams t),
                    '[]'
                ) as person_teams
            FROM queue_kpis qk
            CROSS JOIN queue_name qn
            CROSS JOIN passage_count pc
            CROSS JOIN hors_horaires hh
            CROSS JOIN direct_calls_stats dcs
        `;


        logger.debug("[queue/route] Executing query with queueNumber:", queueNumber);
        const rawResults = await prisma.$queryRawUnsafe(query, queueNumber, start, end);
        logger.debug("[queue/route] Query returned results");
        const row = (rawResults as any[])[0];

        if (!row) {
            return NextResponse.json({ error: "No data found for this queue" }, { status: 404 });
        }

        const totalPassages = Number(row.total_passages);
        const uniqueCalls = Number(row.unique_calls);
        const pingPongCount = totalPassages - uniqueCalls;
        const pingPongPercentage = totalPassages > 0 ? (pingPongCount / totalPassages) * 100 : 0;

        logger.debug("[queue/route] Returning queue stats:", {
            queueNumber,
            queueName: row.queue_name,
            callsReceived: uniqueCalls,
            callsAnswered: Number(row.unique_answered),
        });
        // Équipes d'origine (« D'où viennent nos appels »), triées par volume.
        // COUNT(*) est un bigint côté SQL : json_agg le sérialise en nombre,
        // on normalise par prudence.
        const inboundRows: Array<{ queueNumber: string; queueName: string | null; calls: number | string }> =
            (typeof row.inbound_sources === 'string' ? JSON.parse(row.inbound_sources) : row.inbound_sources) ?? [];
        // Sorties brutes et activité des personnes jointes en direct : le
        // service compose les lignes par équipe (journal XAPI, périmètre,
        // photos) — la route ne rend que les faits.
        const parseJsonCol = <T,>(value: unknown): T[] =>
            (typeof value === 'string' ? JSON.parse(value) : value) ?? [];
        const outboundRows = parseJsonCol<{
            outcome: string; firstHop: string; queueNumber: string | null; queueName: string | null;
            extension: string | null; personName: string | null; calls: number | string;
        }>(row.outbound_exits);
        const personTeamRows = parseJsonCol<{
            extension: string; queueNumber: string; queueName: string | null; calls: number | string; lastAt: string;
        }>(row.person_teams);
        return NextResponse.json({
            queueNumber,
            queueName: row.queue_name,
            callsReceived: uniqueCalls,
            callsAnswered: Number(row.unique_answered),
            // « Perdus » n'inclut plus les abandons courts ni les messageries :
            // ce sont désormais des catégories distinctes, mutuellement
            // exclusives, dont la somme avec les autres redonne le total.
            callsAbandoned: Number(row.unique_abandoned),
            callsShortAbandon: Number(row.unique_short_abandon),
            callsToVoicemail: Number(row.unique_voicemail),
            // Compteurs fins : l'ecran les regroupe en quatre vignettes, mais
            // ils restent disponibles pour le detail et les reglages a venir.
            outcomeCounts: {
                answered: Number(row.unique_answered),
                handed_off: Number(row.unique_handed_off),
                overflow: Number(row.unique_overflow),
                voicemail: Number(row.unique_voicemail),
                short_abandon: Number(row.unique_short_abandon),
                abandoned: Number(row.unique_abandoned),
                // Jamais dans une vignette (regroupement null) : information seule.
                out_of_hours: Number(row.hors_horaires),
            },
            abandonedBefore10s: Number(row.unique_short_abandon),
            abandonedAfter10s: Number(row.unique_abandoned),
            callsOverflow: Number(row.unique_overflow),
            // Transferts accomplis de la file : décrochés ici, servis ailleurs.
            callsHandedOff: Number(row.unique_handed_off),
            classificationRules: rules,
            totalPassages,
            pingPongCount,
            pingPongPercentage: Math.round(pingPongPercentage * 10) / 10,
            avgWaitTimeSeconds: Number(row.avg_wait_time) || 0,
            avgTalkTimeSeconds: Number(row.avg_talk_time) || 0,
            directReceived: Number(row.direct_received),
            directAnswered: Number(row.direct_answered),
            // Un appel direct répondu ici mais servi ailleurs est « Transféré »
            // (règle answeredThenTransferred) : ni répondu, ni perdu.
            directHandedOff: Number(row.direct_handed_off),
            // Non répondu et reparti vers la file d'une autre équipe : Débordé
            // (règle unansweredDirectOverflow) — dans les Débordements, pas les Perdus.
            directOverflow: Number(row.direct_overflow),
            directLost: Number(row.direct_received) - Number(row.direct_answered)
                - Number(row.direct_handed_off) - Number(row.direct_overflow),
            overflowDestinations: typeof row.overflow_destinations === 'string'
                ? JSON.parse(row.overflow_destinations)
                : row.overflow_destinations,
            inboundSources: inboundRows.map((s) => ({
                queueNumber: String(s.queueNumber),
                queueName: s.queueName || String(s.queueNumber),
                calls: Number(s.calls),
            })),
            outboundExits: outboundRows.map((e) => ({
                outcome: e.outcome,
                firstHop: e.firstHop,
                queueNumber: e.queueNumber ?? null,
                queueName: e.queueName ?? null,
                extension: e.extension ?? null,
                personName: e.personName ?? null,
                calls: Number(e.calls),
            })),
            personTeams: personTeamRows.map((t) => ({
                extension: String(t.extension),
                queueNumber: String(t.queueNumber),
                queueName: t.queueName || String(t.queueNumber),
                calls: Number(t.calls),
                lastAt: t.lastAt,
            })),
        });
    } catch (error) {
        logger.error("[queue/route] Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
