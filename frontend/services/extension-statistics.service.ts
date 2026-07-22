"use server";

import { ServerId } from "@/lib/prisma-cdr";
import { getServerTimezone } from "@/lib/servers";
import {
    getInboundDayStats,
    getOutboundDayStats,
    getDirectory,
    getEntryHeatmap,
    type StatsMatcherInput,
    type DayStatsRow,
    type StatsQueryOptions,
} from "@/services/repositories/extension-stats.repository";
import {
    normalizeDigits,
    buildDdiVariants,
    findAssociatedExtension,
    getEntryDisplayLabel,
    parseSearchPattern,
} from "@/services/domain/extension-search";
import { formatDuration } from "@/services/domain/call-aggregation";
import type { HeatmapDataPoint } from "@/services/domain/call.types";
import type {
    ExtensionDirectory,
    ExtensionStats,
    ExtensionStatsOptions,
    ExtensionTrendPoint,
    SearchEntry,
} from "@/types/extension-stats.types";

/**
 * Statistics for a list of extensions / DDIs.
 *
 * Architecture (performance):
 * - The client sends entries in small chunks; each chunk triggers ONE grouped
 *   SQL query per direction (inbound + outbound) instead of 2 queries per
 *   entry. This is what allows large requests (e.g. 20 DDIs over a month)
 *   without exhausting the Prisma connection pool.
 * - Status definitions (answered / missed / voicemail / busy) are identical
 *   to the call-logs page, which is the data source of truth.
 */

// --------------------------------------------
// Directory (autocomplete + name resolution)
// --------------------------------------------

export async function getExtensionDirectory(serverId: ServerId): Promise<ExtensionDirectory> {
    try {
        return await getDirectory(serverId);
    } catch (error) {
        console.error("❌ Error loading extension directory:", error);
        return { extensions: [], ddis: [] };
    }
}

// --------------------------------------------
// Matcher building (entry → SQL matcher)
// --------------------------------------------

function buildMatcher(entry: SearchEntry, directory: ExtensionDirectory): StatsMatcherInput {
    if (entry.kind === "extension") {
        return {
            entryId: entry.input,
            extNumber: entry.input.trim(),
            ddiVariants: null,
            assocExt: null,
            patMode: null,
            patValue: null,
        };
    }

    if (entry.kind === "ddi") {
        const digits = normalizeDigits(entry.input);
        const knownExtensions = directory.extensions.map((e) => e.number);
        return {
            entryId: entry.input,
            extNumber: null,
            ddiVariants: buildDdiVariants(digits),
            assocExt: findAssociatedExtension(digits, knownExtensions),
            patMode: null,
            patValue: null,
        };
    }

    // pattern (wildcards or free text)
    const pattern = parseSearchPattern(entry.input);
    return {
        entryId: entry.input,
        extNumber: null,
        ddiVariants: null,
        assocExt: null,
        patMode: pattern.mode,
        patValue: pattern.value,
    };
}

// --------------------------------------------
// Row aggregation helpers
// --------------------------------------------

interface AggregatedDirection {
    total: number;
    answered: number;
    missed: number;
    voicemail: number;
    busy: number;
    totalDurationSeconds: number;
    maxDurationSeconds: number;
    perDay: Map<string, number>;
}

function aggregateRows(rows: DayStatsRow[], entryId: string): AggregatedDirection {
    const result: AggregatedDirection = {
        total: 0,
        answered: 0,
        missed: 0,
        voicemail: 0,
        busy: 0,
        totalDurationSeconds: 0,
        maxDurationSeconds: 0,
        perDay: new Map<string, number>(),
    };

    for (const row of rows) {
        if (row.entryId !== entryId) continue;
        result.total += row.totalCount;
        result.answered += row.answeredCount;
        result.missed += row.missedCount;
        result.voicemail += row.voicemailCount;
        result.busy += row.busyCount;
        result.totalDurationSeconds += row.totalDurationSeconds;
        result.maxDurationSeconds = Math.max(result.maxDurationSeconds, row.maxDurationSeconds);
        if (row.totalCount > 0) {
            result.perDay.set(row.day, (result.perDay.get(row.day) ?? 0) + row.totalCount);
        }
    }

    return result;
}

function resolveName(entry: SearchEntry, matcher: StatsMatcherInput, directory: ExtensionDirectory): {
    displayName: string | null;
    associatedExtension: string | null;
    associatedName: string | null;
} {
    if (entry.kind === "extension") {
        const found = directory.extensions.find((e) => e.number === entry.input.trim());
        return { displayName: found?.name ?? null, associatedExtension: null, associatedName: null };
    }

    if (entry.kind === "ddi") {
        const variants = new Set(matcher.ddiVariants ?? []);
        const found = directory.ddis.find((d) => variants.has(d.number));
        const associatedName = matcher.assocExt
            ? directory.extensions.find((e) => e.number === matcher.assocExt)?.name ?? null
            : null;
        return {
            displayName: found?.name ?? null,
            associatedExtension: matcher.assocExt,
            associatedName,
        };
    }

    return { displayName: null, associatedExtension: null, associatedName: null };
}

// --------------------------------------------
// Main entry point: statistics for one chunk of entries
// --------------------------------------------

export async function getExtensionStatisticsChunk(
    serverId: ServerId,
    entries: SearchEntry[],
    startISO: string,
    endISO: string,
    options?: ExtensionStatsOptions
): Promise<ExtensionStats[]> {
    if (!entries || entries.length === 0) return [];

    const startDate = new Date(startISO);
    const endDate = new Date(endISO);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error("Période invalide");
    }

    const timezone = await getServerTimezone(serverId);
    const directory = await getDirectory(serverId);
    const matchers = entries.map((entry) => buildMatcher(entry, directory));

    const directions = options?.directions ?? ["inbound", "outbound"];
    const includePrevious = options?.includePreviousPeriod ?? true;
    const queryOptions: StatsQueryOptions = {
        weekdays: options?.weekdays,
        timeStart: options?.timeStart,
        timeEnd: options?.timeEnd,
        minDurationSeconds: options?.minDurationSeconds,
    };

    // Current period queries (grouped, one per direction)
    const currentQueries: Promise<DayStatsRow[]>[] = [];
    if (directions.includes("inbound")) {
        currentQueries.push(getInboundDayStats(serverId, matchers, startDate, endDate, timezone, queryOptions));
    } else {
        currentQueries.push(Promise.resolve([]));
    }
    if (directions.includes("outbound")) {
        currentQueries.push(getOutboundDayStats(serverId, matchers, startDate, endDate, timezone, queryOptions));
    } else {
        currentQueries.push(Promise.resolve([]));
    }

    // Previous equivalent period (N-1 comparison)
    let prevInboundRows: DayStatsRow[] = [];
    let prevOutboundRows: DayStatsRow[] = [];
    const durationMs = endDate.getTime() - startDate.getTime();
    const prevEnd = new Date(startDate.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - durationMs);

    const prevQueries: Promise<void>[] = [];
    if (includePrevious) {
        if (directions.includes("inbound")) {
            prevQueries.push(
                getInboundDayStats(serverId, matchers, prevStart, prevEnd, timezone, queryOptions)
                    .then((rows) => { prevInboundRows = rows; })
            );
        }
        if (directions.includes("outbound")) {
            prevQueries.push(
                getOutboundDayStats(serverId, matchers, prevStart, prevEnd, timezone, queryOptions)
                    .then((rows) => { prevOutboundRows = rows; })
            );
        }
    }

    const [inboundRows, outboundRows] = await Promise.all(currentQueries);
    await Promise.all(prevQueries);

    // Assemble one result per entry
    return entries.map((entry, index) => {
        const matcher = matchers[index];
        const inbound = aggregateRows(inboundRows, matcher.entryId);
        const outbound = aggregateRows(outboundRows, matcher.entryId);
        const prevInbound = aggregateRows(prevInboundRows, matcher.entryId);
        const prevOutbound = aggregateRows(prevOutboundRows, matcher.entryId);
        const names = resolveName(entry, matcher, directory);

        const totalCalls = inbound.total + outbound.total;
        const totalDurationSeconds = inbound.totalDurationSeconds + outbound.totalDurationSeconds;
        const avgDurationSeconds = totalCalls > 0 ? Math.round(totalDurationSeconds / totalCalls) : 0;
        const maxDurationSeconds = Math.max(inbound.maxDurationSeconds, outbound.maxDurationSeconds);
        const answerRate = inbound.total > 0 ? Math.round((inbound.answered / inbound.total) * 100) : 0;

        // Merge per-day trend (inbound + outbound)
        const daySet = new Set<string>([...inbound.perDay.keys(), ...outbound.perDay.keys()]);
        const trend: ExtensionTrendPoint[] = Array.from(daySet)
            .sort()
            .map((date) => ({
                date,
                inbound: inbound.perDay.get(date) ?? 0,
                outbound: outbound.perDay.get(date) ?? 0,
            }));

        return {
            extension: getEntryDisplayLabel(entry),
            input: entry.input,
            kind: entry.kind,
            displayName: names.displayName,
            associatedExtension: names.associatedExtension,
            associatedName: names.associatedName,
            totalCalls,
            inbound: {
                total: inbound.total,
                answered: inbound.answered,
                missed: inbound.missed,
                voicemail: inbound.voicemail,
                busy: inbound.busy,
                answerRate,
            },
            outbound: {
                total: outbound.total,
                successful: outbound.answered,
                failed: outbound.total - outbound.answered,
            },
            duration: {
                totalSeconds: totalDurationSeconds,
                averageSeconds: avgDurationSeconds,
                maxSeconds: maxDurationSeconds,
                totalFormatted: formatDuration(totalDurationSeconds),
                averageFormatted: formatDuration(avgDurationSeconds),
                maxFormatted: formatDuration(maxDurationSeconds),
            },
            previousPeriod: includePrevious
                ? {
                    totalCalls: prevInbound.total + prevOutbound.total,
                    inbound: prevInbound.total,
                    outbound: prevOutbound.total,
                }
                : null,
            trend,
        } satisfies ExtensionStats;
    });
}

// --------------------------------------------
// Heatmap for a single entry (drill-down panel)
// --------------------------------------------

export async function getExtensionEntryHeatmap(
    serverId: ServerId,
    entry: SearchEntry,
    startISO: string,
    endISO: string,
    options?: ExtensionStatsOptions
): Promise<HeatmapDataPoint[]> {
    const startDate = new Date(startISO);
    const endDate = new Date(endISO);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return [];

    try {
        const timezone = await getServerTimezone(serverId);
        const directory = await getDirectory(serverId);
        const matcher = buildMatcher(entry, directory);
        return await getEntryHeatmap(serverId, matcher, startDate, endDate, timezone, {
            weekdays: options?.weekdays,
            timeStart: options?.timeStart,
            timeEnd: options?.timeEnd,
            minDurationSeconds: options?.minDurationSeconds,
        });
    } catch (error) {
        console.error("❌ Error loading entry heatmap:", error);
        return [];
    }
}
