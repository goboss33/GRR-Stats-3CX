-- =====================================================
-- REQUÊTE 1: RÉPONDUS (Queue 903, résultat = answered)
-- Devrait retourner ~41 appels
-- =====================================================

WITH call_aggregates AS (
    SELECT
        call_history_id,
        COUNT(*) as segment_count,
        MIN(cdr_started_at) as first_started_at,
        MAX(cdr_ended_at) as last_ended_at
    FROM cdroutput
    WHERE cdr_started_at >= '2026-02-01'::timestamp
      AND cdr_started_at <= '2026-02-28 23:59:59'::timestamp
    GROUP BY call_history_id
),
queue_outcome AS (
    SELECT DISTINCT ON (p.originating_cdr_id)
        p.originating_cdr_id,
        p.destination_dn_name as agent_name,
        p.destination_dn_number as agent_number
    FROM cdroutput p
    WHERE p.cdr_started_at >= '2026-02-01'::timestamp
      AND p.cdr_started_at <= '2026-02-28 23:59:59'::timestamp
      AND p.call_history_id IN (SELECT call_history_id FROM call_aggregates)
      AND p.creation_forward_reason = 'polling'
      AND p.cdr_answered_at IS NOT NULL
    ORDER BY p.originating_cdr_id, p.cdr_answered_at ASC
),
call_journey AS (
    SELECT
        j.call_history_id,
        JSON_AGG(
            JSON_BUILD_OBJECT(
                'type', j.step_type,
                'label', j.step_label,
                'detail', j.step_detail,
                'result', j.step_result,
                'agent', j.agent_name
            ) ORDER BY j.step_order
        ) as journey
    FROM (
        SELECT
            c.call_history_id,
            c.cdr_started_at as step_order,
            CASE
                WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                WHEN c.destination_dn_type = 'queue' THEN 'queue'
                ELSE 'direct'
            END as step_type,
            CASE
                WHEN c.destination_entity_type = 'voicemail' THEN c.destination_dn_number
                WHEN c.destination_dn_type = 'queue' THEN c.destination_dn_number
                ELSE c.destination_dn_number
            END as step_label,
            CASE
                WHEN c.destination_entity_type = 'voicemail' THEN 'Messagerie ' || COALESCE(c.destination_dn_name, c.destination_dn_number)
                WHEN c.destination_dn_type = 'queue' THEN COALESCE(c.destination_dn_name, c.destination_dn_number)
                ELSE COALESCE(c.destination_dn_name, c.destination_dn_number)
            END as step_detail,
            COALESCE(qo.agent_name, qo.agent_number) as agent_name,
            CASE
                WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                WHEN c.destination_dn_type = 'queue' THEN
                    CASE
                        WHEN qo.originating_cdr_id IS NOT NULL THEN 'answered'
                        ELSE 'not_answered'
                    END
                ELSE
                    CASE
                        WHEN c.cdr_answered_at IS NOT NULL THEN 'answered'
                        WHEN c.termination_reason_details = 'busy' THEN 'busy'
                        ELSE 'not_answered'
                    END
            END as step_result
        FROM cdroutput c
        LEFT JOIN queue_outcome qo ON c.cdr_id = qo.originating_cdr_id
        WHERE c.cdr_started_at >= '2026-02-01'::timestamp
          AND c.cdr_started_at <= '2026-02-28 23:59:59'::timestamp
          AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
          AND (
              c.destination_entity_type = 'voicemail'
              OR c.destination_dn_type = 'queue'
              OR (
                  c.destination_dn_type = 'extension'
                  AND c.destination_entity_type != 'voicemail'
                  AND c.creation_forward_reason IS DISTINCT FROM 'polling'
                  AND (
                      c.creation_forward_reason = 'by_did'
                      OR NOT (
                          c.cdr_answered_at IS NULL
                          AND EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_started_at)) < 1
                      )
                  )
              )
          )
    ) j
    GROUP BY j.call_history_id
)
SELECT
    ca.call_history_id,
    cj.journey,
    -- Vérification du filtre "Répondus"
    cj.journey::jsonb @> '[{"type":"queue", "label":"903", "result":"answered"}]'::jsonb as matches_filter
FROM call_aggregates ca
LEFT JOIN call_journey cj ON ca.call_history_id = cj.call_history_id
WHERE cj.journey::jsonb @> '[{"type":"queue", "label":"903", "result":"answered"}]'::jsonb
ORDER BY ca.first_started_at DESC
LIMIT 100;


-- =====================================================
-- REQUÊTE 2: ABANDONNÉS (Queue 903, not_answered, no other queues after)
-- Devrait retourner ~11 appels
-- FIX: Ajout du cast ::jsonb pour jsonb_array_elements
-- =====================================================

WITH call_aggregates AS (
    SELECT
        call_history_id,
        COUNT(*) as segment_count,
        MIN(cdr_started_at) as first_started_at,
        MAX(cdr_ended_at) as last_ended_at
    FROM cdroutput
    WHERE cdr_started_at >= '2026-02-01'::timestamp
      AND cdr_started_at <= '2026-02-28 23:59:59'::timestamp
    GROUP BY call_history_id
),
queue_outcome AS (
    SELECT DISTINCT ON (p.originating_cdr_id)
        p.originating_cdr_id,
        p.destination_dn_name as agent_name,
        p.destination_dn_number as agent_number
    FROM cdroutput p
    WHERE p.cdr_started_at >= '2026-02-01'::timestamp
      AND p.cdr_started_at <= '2026-02-28 23:59:59'::timestamp
      AND p.call_history_id IN (SELECT call_history_id FROM call_aggregates)
      AND p.creation_forward_reason = 'polling'
      AND p.cdr_answered_at IS NOT NULL
    ORDER BY p.originating_cdr_id, p.cdr_answered_at ASC
),
call_journey AS (
    SELECT
        j.call_history_id,
        JSON_AGG(
            JSON_BUILD_OBJECT(
                'type', j.step_type,
                'label', j.step_label,
                'detail', j.step_detail,
                'result', j.step_result,
                'agent', j.agent_name
            ) ORDER BY j.step_order
        ) as journey
    FROM (
        SELECT
            c.call_history_id,
            c.cdr_started_at as step_order,
            CASE
                WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                WHEN c.destination_dn_type = 'queue' THEN 'queue'
                ELSE 'direct'
            END as step_type,
            CASE
                WHEN c.destination_entity_type = 'voicemail' THEN c.destination_dn_number
                WHEN c.destination_dn_type = 'queue' THEN c.destination_dn_number
                ELSE c.destination_dn_number
            END as step_label,
            CASE
                WHEN c.destination_entity_type = 'voicemail' THEN 'Messagerie ' || COALESCE(c.destination_dn_name, c.destination_dn_number)
                WHEN c.destination_dn_type = 'queue' THEN COALESCE(c.destination_dn_name, c.destination_dn_number)
                ELSE COALESCE(c.destination_dn_name, c.destination_dn_number)
            END as step_detail,
            COALESCE(qo.agent_name, qo.agent_number) as agent_name,
            CASE
                WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                WHEN c.destination_dn_type = 'queue' THEN
                    CASE
                        WHEN qo.originating_cdr_id IS NOT NULL THEN 'answered'
                        ELSE 'not_answered'
                    END
                ELSE
                    CASE
                        WHEN c.cdr_answered_at IS NOT NULL THEN 'answered'
                        WHEN c.termination_reason_details = 'busy' THEN 'busy'
                        ELSE 'not_answered'
                    END
            END as step_result
        FROM cdroutput c
        LEFT JOIN queue_outcome qo ON c.cdr_id = qo.originating_cdr_id
        WHERE c.cdr_started_at >= '2026-02-01'::timestamp
          AND c.cdr_started_at <= '2026-02-28 23:59:59'::timestamp
          AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
          AND (
              c.destination_entity_type = 'voicemail'
              OR c.destination_dn_type = 'queue'
              OR (
                  c.destination_dn_type = 'extension'
                  AND c.destination_entity_type != 'voicemail'
                  AND c.creation_forward_reason IS DISTINCT FROM 'polling'
                  AND (
                      c.creation_forward_reason = 'by_did'
                      OR NOT (
                          c.cdr_answered_at IS NULL
                          AND EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_started_at)) < 1
                      )
                  )
              )
          )
    ) j
    GROUP BY j.call_history_id
)
SELECT
    ca.call_history_id,
    cj.journey,
    -- Vérification des filtres "Abandonnés"
    cj.journey::jsonb @> '[{"type":"queue", "label":"903", "result":"not_answered"}]'::jsonb as matches_not_answered,
    (SELECT COUNT(DISTINCT elem->>'label')
     FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t(elem, idx)
     WHERE elem->>'type' = 'queue'
       AND elem->>'label' != '903'
       AND idx > (
           SELECT MIN(idx2)
           FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t2(elem2, idx2)
           WHERE elem2->>'type' = 'queue' AND elem2->>'label' = '903'
       )
    ) as queue_count_after_903,
    (SELECT COUNT(DISTINCT elem->>'label')
     FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t(elem, idx)
     WHERE elem->>'type' = 'queue'
       AND elem->>'label' != '903'
       AND idx > (
           SELECT MIN(idx2)
           FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t2(elem2, idx2)
           WHERE elem2->>'type' = 'queue' AND elem2->>'label' = '903'
       )
    ) = 0 as no_queues_after_903
FROM call_aggregates ca
LEFT JOIN call_journey cj ON ca.call_history_id = cj.call_history_id
WHERE cj.journey::jsonb @> '[{"type":"queue", "label":"903", "result":"not_answered"}]'::jsonb
  AND (SELECT COUNT(DISTINCT elem->>'label')
       FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t(elem, idx)
       WHERE elem->>'type' = 'queue'
         AND elem->>'label' != '903'
         AND idx > (
             SELECT MIN(idx2)
             FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t2(elem2, idx2)
             WHERE elem2->>'type' = 'queue' AND elem2->>'label' = '903'
         )
      ) = 0
ORDER BY ca.first_started_at DESC
LIMIT 100;


-- =====================================================
-- REQUÊTE 3: REDIRIGÉS (Queue 903, not_answered, with other queues after)
-- Devrait retourner ~12 appels
-- FIX: Ajout du cast ::jsonb pour jsonb_array_elements
-- =====================================================

WITH call_aggregates AS (
    SELECT
        call_history_id,
        COUNT(*) as segment_count,
        MIN(cdr_started_at) as first_started_at,
        MAX(cdr_ended_at) as last_ended_at
    FROM cdroutput
    WHERE cdr_started_at >= '2026-02-01'::timestamp
      AND cdr_started_at <= '2026-02-28 23:59:59'::timestamp
    GROUP BY call_history_id
),
queue_outcome AS (
    SELECT DISTINCT ON (p.originating_cdr_id)
        p.originating_cdr_id,
        p.destination_dn_name as agent_name,
        p.destination_dn_number as agent_number
    FROM cdroutput p
    WHERE p.cdr_started_at >= '2026-02-01'::timestamp
      AND p.cdr_started_at <= '2026-02-28 23:59:59'::timestamp
      AND p.call_history_id IN (SELECT call_history_id FROM call_aggregates)
      AND p.creation_forward_reason = 'polling'
      AND p.cdr_answered_at IS NOT NULL
    ORDER BY p.originating_cdr_id, p.cdr_answered_at ASC
),
call_journey AS (
    SELECT
        j.call_history_id,
        JSON_AGG(
            JSON_BUILD_OBJECT(
                'type', j.step_type,
                'label', j.step_label,
                'detail', j.step_detail,
                'result', j.step_result,
                'agent', j.agent_name
            ) ORDER BY j.step_order
        ) as journey
    FROM (
        SELECT
            c.call_history_id,
            c.cdr_started_at as step_order,
            CASE
                WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                WHEN c.destination_dn_type = 'queue' THEN 'queue'
                ELSE 'direct'
            END as step_type,
            CASE
                WHEN c.destination_entity_type = 'voicemail' THEN c.destination_dn_number
                WHEN c.destination_dn_type = 'queue' THEN c.destination_dn_number
                ELSE c.destination_dn_number
            END as step_label,
            CASE
                WHEN c.destination_entity_type = 'voicemail' THEN 'Messagerie ' || COALESCE(c.destination_dn_name, c.destination_dn_number)
                WHEN c.destination_dn_type = 'queue' THEN COALESCE(c.destination_dn_name, c.destination_dn_number)
                ELSE COALESCE(c.destination_dn_name, c.destination_dn_number)
            END as step_detail,
            COALESCE(qo.agent_name, qo.agent_number) as agent_name,
            CASE
                WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                WHEN c.destination_dn_type = 'queue' THEN
                    CASE
                        WHEN qo.originating_cdr_id IS NOT NULL THEN 'answered'
                        ELSE 'not_answered'
                    END
                ELSE
                    CASE
                        WHEN c.cdr_answered_at IS NOT NULL THEN 'answered'
                        WHEN c.termination_reason_details = 'busy' THEN 'busy'
                        ELSE 'not_answered'
                    END
            END as step_result
        FROM cdroutput c
        LEFT JOIN queue_outcome qo ON c.cdr_id = qo.originating_cdr_id
        WHERE c.cdr_started_at >= '2026-02-01'::timestamp
          AND c.cdr_started_at <= '2026-02-28 23:59:59'::timestamp
          AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
          AND (
              c.destination_entity_type = 'voicemail'
              OR c.destination_dn_type = 'queue'
              OR (
                  c.destination_dn_type = 'extension'
                  AND c.destination_entity_type != 'voicemail'
                  AND c.creation_forward_reason IS DISTINCT FROM 'polling'
                  AND (
                      c.creation_forward_reason = 'by_did'
                      OR NOT (
                          c.cdr_answered_at IS NULL
                          AND EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_started_at)) < 1
                      )
                  )
              )
          )
    ) j
    GROUP BY j.call_history_id
)
SELECT
    ca.call_history_id,
    cj.journey,
    -- Vérification des filtres "Redirigés"
    cj.journey::jsonb @> '[{"type":"queue", "label":"903", "result":"not_answered"}]'::jsonb as matches_not_answered,
    (SELECT COUNT(DISTINCT elem->>'label')
     FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t(elem, idx)
     WHERE elem->>'type' = 'queue'
       AND elem->>'label' != '903'
       AND idx > (
           SELECT MIN(idx2)
           FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t2(elem2, idx2)
           WHERE elem2->>'type' = 'queue' AND elem2->>'label' = '903'
       )
    ) as queue_count_after_903,
    (SELECT COUNT(DISTINCT elem->>'label')
     FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t(elem, idx)
     WHERE elem->>'type' = 'queue'
       AND elem->>'label' != '903'
       AND idx > (
           SELECT MIN(idx2)
           FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t2(elem2, idx2)
           WHERE elem2->>'type' = 'queue' AND elem2->>'label' = '903'
       )
    ) > 0 as has_queues_after_903
FROM call_aggregates ca
LEFT JOIN call_journey cj ON ca.call_history_id = cj.call_history_id
WHERE cj.journey::jsonb @> '[{"type":"queue", "label":"903", "result":"not_answered"}]'::jsonb
  AND (SELECT COUNT(DISTINCT elem->>'label')
       FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t(elem, idx)
       WHERE elem->>'type' = 'queue'
         AND elem->>'label' != '903'
         AND idx > (
             SELECT MIN(idx2)
             FROM jsonb_array_elements(cj.journey::jsonb) WITH ORDINALITY AS t2(elem2, idx2)
             WHERE elem2->>'type' = 'queue' AND elem2->>'label' = '903'
         )
      ) > 0
ORDER BY ca.first_started_at DESC
LIMIT 100;
