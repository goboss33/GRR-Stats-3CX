// ============================================
// TYPES — Statistiques par Extension / DDI
// ============================================

export type SearchEntryKind = "extension" | "ddi" | "pattern";

/**
 * A single searched number as entered by the user.
 * `kind` is auto-detected (see services/domain/extension-search.ts)
 * and can be overridden by the user in the UI.
 */
export interface SearchEntry {
    /** Raw user input, e.g. "2020", "+41 27 484 20 20", "*2020" */
    input: string;
    kind: SearchEntryKind;
}

/** Optional advanced filters applied to the statistics queries. */
export interface ExtensionStatsOptions {
    /** ISO days of week to keep (1 = Monday … 7 = Sunday). Empty/undefined = all. */
    weekdays?: number[];
    /** Keep only calls starting at/after this local time ("HH:mm"). */
    timeStart?: string;
    /** Keep only calls starting before this local time ("HH:mm"). */
    timeEnd?: string;
    /** Keep only calls whose total duration is at least this many seconds. */
    minDurationSeconds?: number;
    /** Which directions to compute. Default: both. */
    directions?: Array<"inbound" | "outbound">;
    /** Also compute previous-period totals (N-1 comparison). Default: true. */
    includePreviousPeriod?: boolean;
}

export interface ExtensionTrendPoint {
    /** yyyy-MM-dd in the server timezone */
    date: string;
    inbound: number;
    outbound: number;
}

export interface ExtensionPeriodStats {
    totalCalls: number;
    inbound: number;
    outbound: number;
}

export interface ExtensionStats {
    /** The entry as displayed (raw user input, pretty-printed for DDIs) */
    extension: string;
    /** The raw user input (used to build pre-filtered links to the logs page) */
    input: string;
    kind: SearchEntryKind;
    /** Person name (extension) or DDI label, resolved from the CDR */
    displayName: string | null;
    /** For DDIs: the extension found by number-suffix matching, if any */
    associatedExtension: string | null;
    /** Person name of the associated extension */
    associatedName: string | null;

    totalCalls: number;
    inbound: {
        total: number;
        answered: number;
        missed: number;
        voicemail: number;
        busy: number;
        answerRate: number;
    };
    outbound: {
        total: number;
        successful: number;
        failed: number;
    };
    duration: {
        totalSeconds: number;
        averageSeconds: number;
        maxSeconds: number;
        totalFormatted: string;
        averageFormatted: string;
        maxFormatted: string;
    };

    /** Previous equivalent period totals (null when comparison is disabled) */
    previousPeriod: ExtensionPeriodStats | null;
    /** Per-day call volumes over the period */
    trend: ExtensionTrendPoint[];
}

export interface ExtensionStatisticsResponse {
    extensions: ExtensionStats[];
    period: {
        start: string;
        end: string;
    };
    totals: {
        totalCalls: number;
        totalInbound: number;
        totalOutbound: number;
        totalAnswered: number;
        totalMissed: number;
        overallAnswerRate: number;
        totalDurationSeconds: number;
        averageDurationSeconds: number;
        /** Sum of previous-period calls (null when comparison is disabled) */
        previousTotalCalls: number | null;
    };
}

/** Directory entry used for autocomplete and name resolution. */
export interface DirectoryEntry {
    number: string;
    name: string | null;
}

export interface ExtensionDirectory {
    extensions: DirectoryEntry[];
    ddis: DirectoryEntry[];
}

/** A named, per-user saved list of search entries. */
export interface SearchPreset {
    id: string;
    name: string;
    entries: SearchEntry[];
    createdAt: string;
}
