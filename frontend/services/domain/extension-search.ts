// ============================================
// EXTENSION / DDI SEARCH — pure domain helpers
// Normalization, kind detection, bulk parsing, totals.
// No I/O here: importable from both client and server code.
// ============================================

import type {
    ExtensionStats,
    ExtensionStatisticsResponse,
    SearchEntry,
    SearchEntryKind,
} from "@/types/extension-stats.types";

/** Swiss country code used to generate national/international variants of a DDI. */
export const DEFAULT_COUNTRY_CODE = "41";

/**
 * Strips everything but digits from a phone-ish input.
 * "+41 27 484 20 20" → "41274842020"
 */
export function normalizeDigits(input: string): string {
    return input.replace(/\D/g, "");
}

/**
 * Auto-detects the kind of a search entry:
 * - contains "*"            → pattern (wildcard semantics, e.g. "*2020")
 * - digits-only, length ≤ 6 → extension
 * - digits-only, length > 6 → ddi
 * - anything else (a name)  → pattern (exact-match semantics on name fields)
 */
export function detectEntryKind(input: string): SearchEntryKind {
    const trimmed = input.trim();
    if (trimmed.includes("*")) return "pattern";
    const digits = normalizeDigits(trimmed);
    if (digits.length === 0) return "pattern";
    return digits.length >= 7 ? "ddi" : "extension";
}

/**
 * Builds the textual variants of a DDI as it may appear in the CDR
 * (source_participant_trunk_did / destination fields), e.g. for "41274842020":
 * ["41274842020", "+41274842020", "0041274842020", "0274842020"]
 *
 * Variants are matched with plain equality in SQL (index-friendly),
 * so we enumerate storage formats instead of normalizing in the database.
 */
export function buildDdiVariants(digits: string): string[] {
    const variants = new Set<string>();
    if (!digits) return [];

    variants.add(digits);
    variants.add(`+${digits}`);

    const cc = DEFAULT_COUNTRY_CODE;

    if (digits.startsWith("00")) {
        // 0041274842020 → 41274842020 / +41…
        const withoutPrefix = digits.slice(2);
        variants.add(withoutPrefix);
        variants.add(`+${withoutPrefix}`);
        if (withoutPrefix.startsWith(cc) && withoutPrefix.length === cc.length + 9) {
            variants.add(`0${withoutPrefix.slice(cc.length)}`);
        }
    } else if (digits.startsWith(cc) && digits.length === cc.length + 9) {
        // 41274842020 → 0041… / 0274842020
        variants.add(`00${digits}`);
        variants.add(`0${digits.slice(cc.length)}`);
    } else if (digits.startsWith("0") && digits.length === 10) {
        // 0274842020 → 41274842020 / +41… / 0041…
        const international = `${cc}${digits.slice(1)}`;
        variants.add(international);
        variants.add(`+${international}`);
        variants.add(`00${international}`);
    }

    return Array.from(variants);
}

/**
 * Formats a DDI for display: "41274842020" → "+41 27 484 20 20".
 * Returns the input unchanged when it does not look like a Swiss international number.
 */
export function formatDdiDisplay(digits: string): string {
    const cc = DEFAULT_COUNTRY_CODE;
    if (digits.startsWith(cc) && digits.length === cc.length + 9) {
        const national = digits.slice(cc.length);
        const groups = [national.slice(0, 2), national.slice(2, 5), national.slice(5, 7), national.slice(7, 9)];
        return `+${cc} ${groups.join(" ")}`;
    }
    return digits;
}

export type SearchPatternMode = "exact" | "startsWith" | "endsWith" | "contains";

export interface SearchPattern {
    mode: SearchPatternMode;
    value: string;
}

/**
 * Parses a wildcard search input ("*2020", "2020*", "*2020*", "2020").
 * Same semantics as the call-logs page filters.
 */
export function parseSearchPattern(input: string): SearchPattern {
    const trimmed = input.trim();
    const startsWithWildcard = trimmed.startsWith("*");
    const endsWithWildcard = trimmed.endsWith("*");
    let value = trimmed;
    if (startsWithWildcard) value = value.slice(1);
    if (endsWithWildcard) value = value.slice(0, -1);

    if (startsWithWildcard && endsWithWildcard) {
        return { mode: "contains", value };
    } else if (startsWithWildcard) {
        return { mode: "endsWith", value };
    } else if (endsWithWildcard) {
        return { mode: "startsWith", value };
    }
    return { mode: "exact", value };
}

/**
 * Parses a bulk paste (Excel column, CSV-ish text, …) into clean unique entries.
 *
 * Handles the classic phone-number-with-spaces problem:
 * - "+41 27 484 20 20" (one number, groups of varying lengths) → ONE entry
 * - "2020 2021 2022" (several numbers, uniform groups) → one entry PER group
 *
 * Separators: newline, tab, comma, semicolon, pipe.
 * Keeps tokens that contain at least 2 digits or a wildcard.
 */
export function parseBulkInput(text: string): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    const pushToken = (token: string) => {
        const trimmed = token.trim();
        if (!trimmed) return;
        const digits = normalizeDigits(trimmed);
        const hasWildcard = trimmed.includes("*");
        if (!hasWildcard && digits.length < 2) return;
        if (seen.has(trimmed)) return;
        seen.add(trimmed);
        result.push(trimmed);
    };

    const fragments = text.split(/[\n\r,;|\t]+/);

    for (const fragment of fragments) {
        const trimmed = fragment.trim();
        if (!trimmed) continue;

        // Starts with "+" → a single phone number (e.g. "+41 27 484 20 20")
        if (/^\+[\d][\d\s]*$/.test(trimmed)) {
            pushToken(trimmed);
            continue;
        }

        const groups = trimmed.split(/\s+/);
        const allNumeric = groups.every((g) => /^\d+$/.test(g));

        if (allNumeric && groups.length > 1) {
            // Uniform groups ("2020 2021 2022") → separate numbers.
            // Varying groups ("027 484 20 20") → one phone number with spaces.
            const uniform = groups.every((g) => g.length === groups[0].length);
            if (uniform) {
                groups.forEach(pushToken);
            } else {
                pushToken(trimmed);
            }
            continue;
        }

        groups.forEach(pushToken);
    }

    return result;
}

/** Converts raw user inputs into typed search entries (kind auto-detected). */
export function toSearchEntries(inputs: string[]): SearchEntry[] {
    return inputs.map((input) => ({ input: input.trim(), kind: detectEntryKind(input) }));
}

/** Display label for an entry: pretty DDI when possible, raw input otherwise. */
export function getEntryDisplayLabel(entry: Pick<SearchEntry, "input" | "kind">): string {
    if (entry.kind === "ddi") {
        const digits = normalizeDigits(entry.input);
        return formatDdiDisplay(digits);
    }
    return entry.input;
}

/**
 * Finds the extension associated with a DDI: the longest known extension number
 * that is a suffix of the DDI digits ("41274842020" + ["2020","20"] → "2020").
 */
export function findAssociatedExtension(ddiDigits: string, knownExtensions: string[]): string | null {
    let best: string | null = null;
    for (const ext of knownExtensions) {
        if (ext.length < 2) continue;
        if (ddiDigits.endsWith(ext) && (best === null || ext.length > best.length)) {
            best = ext;
        }
    }
    return best;
}

/**
 * Aggregates totals across all entries for the summary cards.
 */
export function computeTotals(extensions: ExtensionStats[]): ExtensionStatisticsResponse["totals"] {
    const totalCalls = extensions.reduce((sum, e) => sum + e.totalCalls, 0);
    const totalInbound = extensions.reduce((sum, e) => sum + e.inbound.total, 0);
    const totalOutbound = extensions.reduce((sum, e) => sum + e.outbound.total, 0);
    const totalAnswered = extensions.reduce((sum, e) => sum + e.inbound.answered, 0);
    const totalMissed = extensions.reduce((sum, e) => sum + e.inbound.missed, 0);
    const totalDurationSeconds = extensions.reduce((sum, e) => sum + e.duration.totalSeconds, 0);
    const averageDurationSeconds = totalCalls > 0
        ? Math.round(totalDurationSeconds / totalCalls)
        : 0;
    const overallAnswerRate = totalInbound > 0
        ? Math.round((totalAnswered / totalInbound) * 100)
        : 0;
    const previousTotalCalls = extensions.some((e) => e.previousPeriod !== null)
        ? extensions.reduce((sum, e) => sum + (e.previousPeriod?.totalCalls ?? 0), 0)
        : null;

    return {
        totalCalls,
        totalInbound,
        totalOutbound,
        totalAnswered,
        totalMissed,
        overallAnswerRate,
        totalDurationSeconds,
        averageDurationSeconds,
        previousTotalCalls,
    };
}

/**
 * Merges the per-day trend of several entries into a single series
 * for the global chart.
 */
export function mergeTrends(extensions: ExtensionStats[]): { date: string; inbound: number; outbound: number }[] {
    const byDate = new Map<string, { date: string; inbound: number; outbound: number }>();
    for (const ext of extensions) {
        for (const point of ext.trend) {
            const existing = byDate.get(point.date);
            if (existing) {
                existing.inbound += point.inbound;
                existing.outbound += point.outbound;
            } else {
                byDate.set(point.date, { date: point.date, inbound: point.inbound, outbound: point.outbound });
            }
        }
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}
