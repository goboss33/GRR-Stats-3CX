// Compare la requête de métriques actuelle à une version qui n'assemble ses
// CTE qu'une seule fois.
//
// Le plan d'exécution montre que `call_aggregates`, `last_segments` et
// `answered_segments` — 406 816 lignes chacune — sont jointes TROIS fois : pour
// `call_outcomes`, pour `answered_calls_data`, puis pour l'agrégat final.
// Chaque assemblage impose un tri complet, d'où l'essentiel des 10 secondes.
//
// Lecture seule. Vérifie que les deux formes rendent les mêmes valeurs.
import { getPrismaCdr } from "@/lib/prisma-cdr";
import {
    SQL_SYSTEM_DEST_TYPES,
    SQL_SYSTEM_ENTITY_TYPES,
} from "@/services/domain/call-aggregation";

const START = new Date(process.argv[2] ?? "2026-01-01T00:00:00.000Z");
const END = new Date(process.argv[3] ?? "2026-08-01T00:00:00.000Z");

/** CTE de base, communes aux deux formes. */
const BASE = `
    call_aggregates AS (
        SELECT call_history_id,
               MIN(cdr_started_at) AS first_started_at,
               MIN(cdr_answered_at) AS first_answered_at
        FROM cdroutput
        WHERE cdr_started_at >= $1 AND cdr_started_at <= $2
        GROUP BY call_history_id
    ),
    last_segments AS (
        SELECT DISTINCT ON (call_history_id)
            call_history_id,
            destination_dn_type AS last_dest_type,
            destination_entity_type AS last_dest_entity_type,
            cdr_answered_at,
            cdr_started_at AS last_started_at,
            cdr_ended_at AS last_ended_at,
            termination_reason_details
        FROM cdroutput
        WHERE cdr_started_at >= $1 AND cdr_started_at <= $2
        ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
    ),
    answered_segments AS (
        SELECT DISTINCT ON (c.call_history_id)
            c.call_history_id, c.cdr_answered_at AS answered_at
        FROM cdroutput c
        WHERE c.cdr_answered_at IS NOT NULL
          AND c.destination_dn_type = 'extension'
          AND c.cdr_started_at >= $1 AND c.cdr_started_at <= $2
        ORDER BY c.call_history_id, c.cdr_answered_at ASC, c.cdr_id ASC
    )`;

const STATUS_CASE = `
    CASE
        WHEN ls_last_dest_type IN ('vmail_console','voicemail') OR ls_last_dest_entity_type = 'voicemail' THEN 'voicemail'
        WHEN ls_termination_reason_details ILIKE '%busy%' THEN 'busy'
        WHEN ls_cdr_answered_at IS NOT NULL
             AND EXTRACT(EPOCH FROM (ls_last_ended_at - ls_last_started_at)) > 1
             AND (
                 (ls_last_dest_type IN (${SQL_SYSTEM_DEST_TYPES}) OR ls_last_dest_entity_type IN (${SQL_SYSTEM_ENTITY_TYPES}))
                 AND answered_at IS NOT NULL
                 OR
                 (ls_last_dest_type NOT IN (${SQL_SYSTEM_DEST_TYPES}) AND ls_last_dest_entity_type NOT IN (${SQL_SYSTEM_ENTITY_TYPES}))
             )
        THEN 'answered'
        ELSE 'missed'
    END`;

const SELECT_FINAL = `
    SELECT
        COUNT(*) AS total_calls,
        COUNT(*) FILTER (WHERE status = 'answered')  AS answered_calls,
        COUNT(*) FILTER (WHERE status = 'missed')    AS missed_calls,
        COUNT(*) FILTER (WHERE status = 'voicemail') AS voicemail_calls,
        COUNT(*) FILTER (WHERE status = 'busy')      AS busy_calls,
        ROUND(AVG(talk_duration)::numeric, 1)   AS avg_human_duration,
        ROUND(AVG(wait_time)::numeric, 1)       AS avg_wait_time,
        ROUND(AVG(agent_count)::numeric, 2)     AS avg_agents_per_call,
        COUNT(*) FILTER (WHERE agent_count = 1)  AS agents_1,
        COUNT(*) FILTER (WHERE agent_count = 2)  AS agents_2,
        COUNT(*) FILTER (WHERE agent_count >= 3) AS agents_3_plus
    FROM enrichi`;

/**
 * Un seul assemblage, puis tout est dérivé en une passe.
 *
 * Les colonnes de `last_segments` sont préfixées `ls_` pour rester lisibles
 * une fois à plat, l'assemblage n'existant plus qu'une fois.
 */
const FUSIONNEE = `
    WITH ${BASE},
    agent_counts AS (
        SELECT c2.call_history_id, COUNT(DISTINCT c2.destination_dn_number) AS agent_count
        FROM cdroutput c2
        WHERE c2.cdr_answered_at IS NOT NULL
          AND c2.destination_dn_type = 'extension'
          AND c2.cdr_started_at >= $1 AND c2.cdr_started_at <= $2
        GROUP BY c2.call_history_id
    ),
    assemble AS (
        SELECT
            ca.call_history_id,
            ca.first_started_at,
            ca.first_answered_at,
            ls.last_dest_type        AS ls_last_dest_type,
            ls.last_dest_entity_type AS ls_last_dest_entity_type,
            ls.cdr_answered_at       AS ls_cdr_answered_at,
            ls.last_started_at       AS ls_last_started_at,
            ls.last_ended_at         AS ls_last_ended_at,
            ls.termination_reason_details AS ls_termination_reason_details,
            ans.answered_at,
            agc.agent_count AS raw_agent_count
        FROM call_aggregates ca
        JOIN last_segments ls ON ls.call_history_id = ca.call_history_id
        LEFT JOIN answered_segments ans ON ans.call_history_id = ca.call_history_id
        LEFT JOIN agent_counts agc ON agc.call_history_id = ca.call_history_id
    ),
    enrichi AS (
        SELECT
            call_history_id,
            ${STATUS_CASE} AS status,
            -- Les trois mesures ne valent que pour un appel dont le dernier
            -- segment a été décroché : c'est la condition que portait le WHERE
            -- de l'ancienne CTE answered_calls_data.
            CASE WHEN ls_cdr_answered_at IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (ls_last_ended_at - ls_cdr_answered_at)) END AS talk_duration,
            CASE WHEN ls_cdr_answered_at IS NOT NULL
                 THEN EXTRACT(EPOCH FROM (COALESCE(answered_at, first_answered_at) - first_started_at)) END AS wait_time,
            CASE WHEN ls_cdr_answered_at IS NOT NULL
                 THEN COALESCE(raw_agent_count, 0) END AS agent_count
        FROM assemble
    )
    ${SELECT_FINAL}`;

/** Forme actuelle : trois assemblages successifs des mêmes CTE. */
const ACTUELLE = `
    WITH ${BASE},
    call_outcomes AS (
        SELECT ca.call_history_id,
            CASE
                WHEN ls.last_dest_type IN ('vmail_console','voicemail') OR ls.last_dest_entity_type = 'voicemail' THEN 'voicemail'
                WHEN ls.termination_reason_details ILIKE '%busy%' THEN 'busy'
                WHEN ls.cdr_answered_at IS NOT NULL
                     AND EXTRACT(EPOCH FROM (ls.last_ended_at - ls.last_started_at)) > 1
                     AND ((ls.last_dest_type IN (${SQL_SYSTEM_DEST_TYPES}) OR ls.last_dest_entity_type IN (${SQL_SYSTEM_ENTITY_TYPES})) AND ans.answered_at IS NOT NULL
                          OR (ls.last_dest_type NOT IN (${SQL_SYSTEM_DEST_TYPES}) AND ls.last_dest_entity_type NOT IN (${SQL_SYSTEM_ENTITY_TYPES})))
                THEN 'answered' ELSE 'missed' END AS status
        FROM call_aggregates ca
        JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
        LEFT JOIN answered_segments ans ON ca.call_history_id = ans.call_history_id
    ),
    answered_calls_data AS (
        SELECT ca.call_history_id,
            EXTRACT(EPOCH FROM (ls.last_ended_at - ls.cdr_answered_at)) AS talk_duration,
            EXTRACT(EPOCH FROM (COALESCE(ans.answered_at, ca.first_answered_at) - ca.first_started_at)) AS wait_time,
            (SELECT COUNT(DISTINCT c2.destination_dn_number) FROM cdroutput c2
             WHERE c2.call_history_id = ca.call_history_id AND c2.cdr_answered_at IS NOT NULL
               AND c2.destination_dn_type = 'extension') AS agent_count
        FROM call_aggregates ca
        JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
        LEFT JOIN answered_segments ans ON ca.call_history_id = ans.call_history_id
        WHERE ls.cdr_answered_at IS NOT NULL
    ),
    enrichi AS (
        SELECT ca.call_history_id, co.status, acd.talk_duration, acd.wait_time, acd.agent_count
        FROM call_aggregates ca
        JOIN call_outcomes co ON ca.call_history_id = co.call_history_id
        LEFT JOIN answered_calls_data acd ON ca.call_history_id = acd.call_history_id
    )
    ${SELECT_FINAL}`;

const CHAMPS = [
    "total_calls", "answered_calls", "missed_calls", "voicemail_calls", "busy_calls",
    "avg_human_duration", "avg_wait_time", "avg_agents_per_call",
    "agents_1", "agents_2", "agents_3_plus",
] as const;

async function main() {
    const prisma = getPrismaCdr("gerofinance");
    console.log(`\nPériode ${START.toISOString().slice(0, 10)} → ${END.toISOString().slice(0, 10)}\n`);

    const res: Record<string, Record<string, unknown>> = {};
    for (const [nom, sql] of [["actuelle", ACTUELLE], ["fusionnée", FUSIONNEE]] as const) {
        const t0 = Date.now();
        const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, START, END);
        res[nom] = rows[0];
        console.log(`  ${nom.padEnd(12)} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }

    console.log("\nValeurs :");
    let diffs = 0;
    for (const c of CHAMPS) {
        const a = String(res["actuelle"][c]);
        const b = String(res["fusionnée"][c]);
        if (a !== b) diffs++;
        console.log(`  ${c.padEnd(22)} ${a.padStart(12)} ${b.padStart(12)}  ${a === b ? "✓" : "✗"}`);
    }
    console.log(diffs === 0
        ? "\n=> Identiques : la fusion ne change aucun chiffre.\n"
        : `\n=> ${diffs} écart(s) — fusion à revoir.\n`);

    process.exit(diffs === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
