
        WITH call_aggregates AS (
            SELECT
                call_history_id,
                COUNT(*) as segment_count,
                MIN(cdr_started_at) as first_started_at,
                MAX(cdr_ended_at) as last_ended_at,
                MIN(cdr_answered_at) as first_answered_at
            FROM cdroutput
            WHERE cdr_started_at >= '2026-02-28T23:00:00.000Z' AND cdr_started_at <= '2026-03-31T21:59:59.999Z'
            GROUP BY call_history_id
        ),
        first_segments AS (
            SELECT DISTINCT ON (c.call_history_id)
                c.call_history_id,
                c.source_dn_number,
                c.source_participant_phone_number,
                c.source_participant_name,
                c.source_dn_name,
                c.source_dn_type,
                c.source_presentation,
                c.destination_dn_number as first_dest_number,
                c.destination_participant_phone_number as first_dest_participant_phone,
                c.destination_participant_name as first_dest_participant_name,
                c.destination_dn_name as first_dest_dn_name,
                c.destination_dn_type
            FROM cdroutput c
            WHERE cdr_started_at >= '2026-02-28T23:00:00.000Z' AND cdr_started_at <= '2026-03-31T21:59:59.999Z'
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            ORDER BY c.call_history_id, c.cdr_started_at ASC
        ),
        last_segments AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                destination_dn_number,
                destination_participant_phone_number,
                destination_participant_name,
                destination_dn_name,
                destination_dn_type as last_dest_type,
                destination_entity_type as last_dest_entity_type,
                cdr_answered_at,
                cdr_started_at as last_started_at,
                cdr_ended_at as last_ended_at,
                termination_reason,
                termination_reason_details
            FROM cdroutput
            WHERE cdr_started_at >= '2026-02-28T23:00:00.000Z' AND cdr_started_at <= '2026-03-31T21:59:59.999Z'
            ORDER BY call_history_id, cdr_ended_at DESC
        ),
        answered_segments AS (
            SELECT DISTINCT ON (c.call_history_id)
                c.call_history_id,
                c.destination_dn_number as answered_dest_number,
                c.destination_participant_name as answered_dest_name,
                c.destination_dn_name as answered_dn_name,
                c.destination_dn_type as answered_dest_type,
                c.cdr_answered_at as answered_at,
                c.cdr_ended_at as answered_ended_at,
                EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_answered_at)) as talk_duration_seconds
            FROM cdroutput c
            WHERE cdr_started_at >= '2026-02-28T23:00:00.000Z' AND cdr_started_at <= '2026-03-31T21:59:59.999Z'
              AND c.cdr_answered_at IS NOT NULL
              AND c.destination_dn_type = 'extension'
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            ORDER BY c.call_history_id, c.cdr_answered_at ASC
        ),
        handled_by AS (
            SELECT
                c.call_history_id,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'number', c.destination_dn_number,
                        'name', COALESCE(c.destination_dn_name, c.destination_participant_name, c.destination_dn_number)
                    ) ORDER BY c.cdr_answered_at DESC
                ) as agents,
                SUM(EXTRACT(EPOCH FROM (c.cdr_ended_at - c.cdr_answered_at))) as total_talk_seconds,
                COUNT(*) as agent_count
            FROM cdroutput c
            WHERE cdr_started_at >= '2026-02-28T23:00:00.000Z' AND cdr_started_at <= '2026-03-31T21:59:59.999Z'
              AND c.cdr_answered_at IS NOT NULL
              AND c.destination_dn_type = 'extension'
              AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            GROUP BY c.call_history_id
        ),
        call_queues AS (
            SELECT
                dq.call_history_id,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'number', dq.destination_dn_number,
                        'name', dq.queue_name
                    )
                ) as queues,
                COUNT(*) as queue_count
            FROM (
                SELECT DISTINCT
                    c.call_history_id,
                    c.destination_dn_number,
                    COALESCE(c.destination_dn_name, c.destination_dn_number) as queue_name
                FROM cdroutput c
                WHERE cdr_started_at >= '2026-02-28T23:00:00.000Z' AND cdr_started_at <= '2026-03-31T21:59:59.999Z'
                  AND c.destination_dn_type = 'queue'
                  AND c.call_history_id IN (SELECT call_history_id FROM call_aggregates)
            ) dq
            GROUP BY dq.call_history_id
        ),
        queue_outcome AS (
            SELECT DISTINCT ON (p.originating_cdr_id)
                p.originating_cdr_id,
                p.destination_dn_name as agent_name,
                p.destination_dn_number as agent_number
            FROM cdroutput p
            WHERE cdr_started_at >= '2026-02-28T23:00:00.000Z' AND cdr_started_at <= '2026-03-31T21:59:59.999Z'
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
                        'agent', j.agent_name,
                        'agentNumber', j.agent_number
                    ) ORDER BY j.step_order
                ) as journey
            FROM (
                SELECT * FROM (
                    SELECT
                        c.call_history_id,
                        c.cdr_started_at as step_order,
                        CASE
                            WHEN c.destination_entity_type = 'voicemail' THEN 'voicemail'
                            WHEN c.destination_dn_type = 'queue' THEN 'queue'
                            ELSE 'direct'
                        END as step_type,
                        c.destination_dn_number as step_label,
                        CASE
                            WHEN c.destination_entity_type = 'voicemail' THEN 'Messagerie ' || COALESCE(c.destination_dn_name, c.destination_dn_number)
                            WHEN c.destination_dn_type = 'queue' THEN COALESCE(c.destination_dn_name, c.destination_dn_number)
                            ELSE COALESCE(c.destination_dn_name, c.destination_dn_number)
                        END as step_detail,
                        CASE
                            WHEN c.destination_dn_type = 'queue' THEN COALESCE(qo.agent_name, qo.agent_number)
                            WHEN c.destination_dn_type = 'extension' THEN COALESCE(c.destination_dn_name, c.destination_dn_number)
                            ELSE NULL
                        END as agent_name,
                        CASE
                            WHEN c.destination_dn_type = 'queue' THEN qo.agent_number
                            WHEN c.destination_dn_type = 'extension' THEN c.destination_dn_number
                            ELSE NULL
                        END as agent_number,
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
                        END as step_result,
                        ROW_NUMBER() OVER (PARTITION BY c.call_history_id ORDER BY c.cdr_started_at) as step_num
                    FROM cdroutput c
                    LEFT JOIN queue_outcome qo ON c.cdr_id = qo.originating_cdr_id
                    WHERE cdr_started_at >= '2026-02-28T23:00:00.000Z' AND cdr_started_at <= '2026-03-31T21:59:59.999Z'
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
                ) all_steps
                WHERE all_steps.step_num <= 15
            ) j
            GROUP BY j.call_history_id
        )
        SELECT
            ca.call_history_id,
            ca.segment_count,
            ca.first_started_at,
            ca.last_ended_at,
            ca.first_answered_at,
            fs.source_dn_number,
            fs.source_participant_phone_number,
            fs.source_participant_name,
            fs.source_dn_name,
            fs.source_dn_type,
            fs.source_presentation,
            fs.first_dest_number,
            fs.first_dest_participant_phone,
            fs.first_dest_participant_name,
            fs.first_dest_dn_name,
            fs.destination_dn_type as first_dest_type,
            ls.destination_dn_number,
            ls.destination_participant_phone_number,
            ls.destination_participant_name,
            ls.destination_dn_name,
            ls.last_dest_type,
            ls.last_dest_entity_type,
            ls.cdr_answered_at as last_answered_at,
            ls.last_started_at,
            ls.last_ended_at,
            ls.termination_reason,
            ls.termination_reason_details,
            ans.answered_dest_number,
            ans.answered_dest_name,
            ans.answered_dn_name,
            ans.answered_dest_type,
            ans.answered_at,
            ans.answered_ended_at,
            ans.talk_duration_seconds,
            hb.agents as handled_by_agents,
            hb.total_talk_seconds as handled_by_total_talk,
            hb.agent_count as handled_by_count,
            cq.queues as call_queues,
            cq.queue_count,
            cj.journey as call_journey
        FROM call_aggregates ca
        JOIN first_segments fs ON ca.call_history_id = fs.call_history_id
        JOIN last_segments ls ON ca.call_history_id = ls.call_history_id
        LEFT JOIN answered_segments ans ON ca.call_history_id = ans.call_history_id
        LEFT JOIN handled_by hb ON ca.call_history_id = hb.call_history_id
        LEFT JOIN call_queues cq ON ca.call_history_id = cq.call_history_id
        LEFT JOIN call_journey cj ON ca.call_history_id = cj.call_history_id
        
        WHERE 
                    EXISTS (
                        SELECT 1 FROM jsonb_array_elements(cj.journey::jsonb) elem
                        WHERE elem->>'type' = 'queue' AND elem->>'label' = '993'
                    )
                
        ORDER BY ca.first_started_at DESC
        LIMIT 50 OFFSET 0
    