"use server";

import { prisma } from "@/lib/prisma";
import { getGlobalMetrics } from "@/services/stats.service";
import { determineCallStatus } from "@/services/domain/call-aggregation";

export interface DiagnosticResult {
    period: { start: string; end: string };
    summary: {
        totalCalls: number;
        dashboardAnswered: number;
        logsAnswered: number;
        dashboardMissed: number;
        logsMissed: number;
        dashboardVoicemail: number;
        logsVoicemail: number;
        dashboardBusy: number;
        logsBusy: number;
        divergences: number;
        matchRate: string;
    };
    divergences: DivergenceDetail[];
}

export interface DivergenceDetail {
    callHistoryId: string;
    callHistoryIdShort: string;
    startedAt: string;
    segmentCount: number;
    dashboardStatus: string;
    logsStatus: string;
    lastDestType: string | null;
    lastDestEntityType: string | null;
    lastAnsweredAt: string | null;
    lastStartedAt: string | null;
    lastEndedAt: string | null;
    lastDurationSeconds: number;
    lastDurationSecondsSql: number;
    humanAnsweredAt: string | null;
    terminationReasonDetails: string | null;
    allSegments: SegmentSummary[];
}

export interface SegmentSummary {
    cdrId: string;
    destType: string | null;
    destEntityType: string | null;
    startedAt: string;
    endedAt: string | null;
    answeredAt: string | null;
    durationSeconds: number;
    terminationReasonDetails: string | null;
}

export async function runDiagnostic(
    startDate: Date,
    endDate: Date
): Promise<DiagnosticResult> {
    // Step 1: Real Dashboard metrics
    const dashboardMetrics = await getGlobalMetrics(startDate, endDate);

    // Step 2: All call aggregates
    const callAggregates = await prisma.$queryRaw<
        Array<{ call_history_id: string; first_started_at: Date; segment_count: bigint }>
    >`
        SELECT call_history_id,
               MIN(cdr_started_at) AS first_started_at,
               COUNT(*) AS segment_count
        FROM cdroutput
        WHERE cdr_started_at >= ${startDate}
          AND cdr_started_at <= ${endDate}
        GROUP BY call_history_id
    `;

    const callIds = callAggregates.map(c => c.call_history_id);
    const totalCalls = callAggregates.length;

    if (totalCalls === 0) {
        return {
            period: { start: startDate.toISOString(), end: endDate.toISOString() },
            summary: {
                totalCalls: 0, dashboardAnswered: 0, logsAnswered: 0,
                dashboardMissed: 0, logsMissed: 0,
                dashboardVoicemail: 0, logsVoicemail: 0,
                dashboardBusy: 0, logsBusy: 0,
                divergences: 0, matchRate: "N/A"
            },
            divergences: [],
        };
    }

    // Step 3: Get last_segments for ALL calls
    const lastSegments = await prisma.$queryRaw<
        Array<{
            call_history_id: string;
            destination_dn_type: string | null;
            destination_entity_type: string | null;
            cdr_answered_at: Date | null;
            cdr_started_at: Date | null;
            cdr_ended_at: Date | null;
            termination_reason_details: string | null;
        }>
    >`
        SELECT DISTINCT ON (call_history_id)
            call_history_id,
            destination_dn_type,
            destination_entity_type,
            cdr_answered_at,
            cdr_started_at,
            cdr_ended_at,
            termination_reason_details
        FROM cdroutput
        WHERE call_history_id = ANY(${callIds}::uuid[])
        ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
    `;

    // Step 4: Get answered_segments
    const answeredSegments = await prisma.$queryRaw<
        Array<{ call_history_id: string; cdr_answered_at: Date }>
    >`
        SELECT DISTINCT ON (call_history_id)
            call_history_id,
            cdr_answered_at
        FROM cdroutput
        WHERE call_history_id = ANY(${callIds}::uuid[])
          AND cdr_answered_at IS NOT NULL
          AND destination_dn_type = 'extension'
        ORDER BY call_history_id, cdr_answered_at ASC, cdr_id ASC
    `;

    const answeredMap = new Map<string, Date>();
    answeredSegments.forEach(s => answeredMap.set(s.call_history_id, s.cdr_answered_at));

    // Step 5: Compute Dashboard outcomes via SQL (same CASE as repository)
    const sqlOutcomes = await prisma.$queryRaw<
        Array<{ call_history_id: string; outcome: string }>
    >`
        WITH last_segments AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                destination_dn_type AS last_dest_type,
                destination_entity_type AS last_dest_entity_type,
                cdr_answered_at AS last_answered_at,
                cdr_started_at AS last_started_at,
                cdr_ended_at AS last_ended_at,
                termination_reason_details
            FROM cdroutput
            WHERE call_history_id = ANY(${callIds}::uuid[])
            ORDER BY call_history_id, cdr_ended_at DESC, cdr_started_at DESC, cdr_id DESC
        ),
        answered_segments AS (
            SELECT DISTINCT ON (call_history_id)
                call_history_id,
                cdr_answered_at AS answered_at
            FROM cdroutput
            WHERE call_history_id = ANY(${callIds}::uuid[])
              AND cdr_answered_at IS NOT NULL
              AND destination_dn_type = 'extension'
            ORDER BY call_history_id, cdr_answered_at ASC, cdr_id ASC
        )
        SELECT
            ls.call_history_id,
            CASE
                WHEN ls.last_dest_type IN ('vmail_console', 'voicemail') OR ls.last_dest_entity_type = 'voicemail'
                    THEN 'voicemail'
                WHEN LOWER(COALESCE(ls.termination_reason_details, '')) LIKE '%busy%'
                    THEN 'busy'
                WHEN ls.last_answered_at IS NOT NULL
                     AND EXTRACT(EPOCH FROM (ls.last_ended_at - ls.last_started_at)) > 1
                    THEN CASE
                        WHEN ls.last_dest_type IN ('queue', 'ring_group', 'ring_group_ring_all', 'ivr', 'process', 'parking', 'script')
                             OR ls.last_dest_entity_type IN ('queue', 'ivr')
                            THEN CASE WHEN ans.answered_at IS NOT NULL THEN 'answered' ELSE 'abandoned' END
                        ELSE 'answered'
                        END
                ELSE 'abandoned'
            END AS outcome
        FROM last_segments ls
        LEFT JOIN answered_segments ans ON ans.call_history_id = ls.call_history_id
    `;

    const sqlOutcomeMap = new Map<string, string>();
    sqlOutcomes.forEach(r => sqlOutcomeMap.set(r.call_history_id, r.outcome));

    // Step 6: Compute TypeScript outcomes (Logs logic) using the SAME domain function
    const tsOutcomeMap = new Map<string, string>();
    const lastSegMap = new Map<string, typeof lastSegments[0]>();
    lastSegments.forEach(s => lastSegMap.set(s.call_history_id, s));

    for (const seg of lastSegments) {
        const humanAnsweredAt = answeredMap.get(seg.call_history_id) || null;
        const outcome = determineCallStatus({
            lastDestType: seg.destination_dn_type,
            lastDestEntityType: seg.destination_entity_type,
            lastAnsweredAt: seg.cdr_answered_at,
            lastStartedAt: seg.cdr_started_at,
            lastEndedAt: seg.cdr_ended_at,
            terminationReasonDetails: seg.termination_reason_details,
            humanAnsweredAt,
        });
        tsOutcomeMap.set(seg.call_history_id, outcome);
    }

    // Step 7: Find divergences between SQL (Dashboard) and TS (Logs)
    const divergences: DivergenceDetail[] = [];
    const callAggMap = new Map<string, typeof callAggregates[0]>();
    callAggregates.forEach(c => callAggMap.set(c.call_history_id, c));

    for (const seg of lastSegments) {
        const sqlOutcome = sqlOutcomeMap.get(seg.call_history_id) || 'unknown';
        const tsOutcome = tsOutcomeMap.get(seg.call_history_id) || 'unknown';

        if (sqlOutcome !== tsOutcome) {
            const allSegs = await prisma.$queryRaw<
                Array<{
                    cdr_id: string;
                    destination_dn_type: string | null;
                    destination_entity_type: string | null;
                    cdr_started_at: Date | null;
                    cdr_ended_at: Date | null;
                    cdr_answered_at: Date | null;
                    termination_reason_details: string | null;
                }>
            >`
                SELECT cdr_id, destination_dn_type, destination_entity_type,
                       cdr_started_at, cdr_ended_at, cdr_answered_at, termination_reason_details
                FROM cdroutput
                WHERE call_history_id = ${seg.call_history_id}::uuid
                ORDER BY cdr_started_at ASC, cdr_id ASC
            `;

            const segmentSummaries: SegmentSummary[] = allSegs.map(s => ({
                cdrId: s.cdr_id,
                destType: s.destination_dn_type,
                destEntityType: s.destination_entity_type,
                startedAt: s.cdr_started_at?.toISOString() || '',
                endedAt: s.cdr_ended_at?.toISOString() || null,
                answeredAt: s.cdr_answered_at?.toISOString() || null,
                durationSeconds: s.cdr_started_at && s.cdr_ended_at
                    ? Math.round((new Date(s.cdr_ended_at).getTime() - new Date(s.cdr_started_at).getTime()) / 1000 * 10) / 10
                    : 0,
                terminationReasonDetails: s.termination_reason_details,
            }));

            const callAgg = callAggMap.get(seg.call_history_id);
            const lastStarted = seg.cdr_started_at ? new Date(seg.cdr_started_at) : null;
            const lastEnded = seg.cdr_ended_at ? new Date(seg.cdr_ended_at) : null;
            const lastDurationSecondsTs = lastStarted && lastEnded
                ? (lastEnded.getTime() - lastStarted.getTime()) / 1000
                : 0;
            const lastDurationSecondsSql = seg.cdr_started_at && seg.cdr_ended_at
                ? Number(seg.cdr_ended_at) - Number(seg.cdr_started_at)
                : 0;

            const humanAnsweredAt = answeredMap.get(seg.call_history_id) || null;

            divergences.push({
                callHistoryId: seg.call_history_id,
                callHistoryIdShort: seg.call_history_id.slice(-4).toUpperCase(),
                startedAt: callAgg?.first_started_at?.toISOString() || '',
                segmentCount: Number(callAgg?.segment_count || 0),
                dashboardStatus: sqlOutcome,
                logsStatus: tsOutcome,
                lastDestType: seg.destination_dn_type,
                lastDestEntityType: seg.destination_entity_type,
                lastAnsweredAt: seg.cdr_answered_at?.toISOString() || null,
                lastStartedAt: seg.cdr_started_at?.toISOString() || null,
                lastEndedAt: seg.cdr_ended_at?.toISOString() || null,
                lastDurationSeconds: Math.round(lastDurationSecondsTs * 10) / 10,
                lastDurationSecondsSql: Math.round(lastDurationSecondsSql * 1000) / 1000,
                humanAnsweredAt: humanAnsweredAt?.toISOString() || null,
                terminationReasonDetails: seg.termination_reason_details,
                allSegments: segmentSummaries,
            });
        }
    }

    // Aggregate counts
    let dashboardAnswered = 0, dashboardMissed = 0, dashboardVoicemail = 0, dashboardBusy = 0;
    let logsAnswered = 0, logsMissed = 0, logsVoicemail = 0, logsBusy = 0;

    for (const r of sqlOutcomes) {
        const sql = r.outcome;
        const ts = tsOutcomeMap.get(r.call_history_id) || 'unknown';

        if (sql === 'answered') dashboardAnswered++;
        if (sql === 'abandoned') dashboardMissed++;
        if (sql === 'voicemail') dashboardVoicemail++;
        if (sql === 'busy') dashboardBusy++;

        if (ts === 'answered') logsAnswered++;
        if (ts === 'abandoned') logsMissed++;
        if (ts === 'voicemail') logsVoicemail++;
        if (ts === 'busy') logsBusy++;
    }

    const matchRate = totalCalls > 0
        ? (((totalCalls - divergences.length) / totalCalls) * 100).toFixed(4) + '%'
        : 'N/A';

    return {
        period: { start: startDate.toISOString(), end: endDate.toISOString() },
        summary: {
            totalCalls,
            dashboardAnswered,
            logsAnswered,
            dashboardMissed,
            logsMissed,
            dashboardVoicemail,
            logsVoicemail,
            dashboardBusy,
            logsBusy,
            divergences: divergences.length,
            matchRate,
        },
        divergences,
    };
}
