"use server";

import { auth } from "@/lib/auth";
import { prismaAuth } from "@/lib/prisma-auth";
import { Prisma } from "@prisma/auth-client";
import type { SearchEntry, SearchPreset } from "@/types/extension-stats.types";

/**
 * Per-user saved search presets (statistics-extension page).
 *
 * The SearchPreset table is additive (prisma db push). Every function
 * degrades gracefully (ok: false / unavailable) when the table has not
 * been created yet, so the feature simply disappears instead of crashing.
 */

const PRESET_PAGE = "statistics-extension";
const MAX_PRESETS_PER_USER = 20;
const MAX_PRESET_NAME_LENGTH = 60;
const MAX_ENTRIES_PER_PRESET = 100;

interface PresetListResult {
    ok: boolean;
    unavailable?: boolean;
    presets: SearchPreset[];
}

interface PresetMutationResult {
    ok: boolean;
    unavailable?: boolean;
    error?: string;
    preset?: SearchPreset;
}

function isValidEntry(entry: unknown): entry is SearchEntry {
    if (typeof entry !== "object" || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return (
        typeof e.input === "string" &&
        e.input.length > 0 &&
        e.input.length <= 100 &&
        (e.kind === "extension" || e.kind === "ddi" || e.kind === "pattern")
    );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPreset(row: any): SearchPreset {
    return {
        id: String(row.id),
        name: String(row.name),
        entries: Array.isArray(row.entries) ? (row.entries as SearchEntry[]).filter(isValidEntry) : [],
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    };
}

export async function listSearchPresets(): Promise<PresetListResult> {
    try {
        const session = await auth();
        if (!session?.user?.id) return { ok: false, presets: [] };

        const rows = await prismaAuth.searchPreset.findMany({
            where: { userId: session.user.id, page: PRESET_PAGE },
            orderBy: { createdAt: "asc" },
        });

        return { ok: true, presets: rows.map(toPreset) };
    } catch (error) {
        console.error("❌ Error listing search presets:", error);
        return { ok: false, unavailable: true, presets: [] };
    }
}

export async function saveSearchPreset(name: string, entries: SearchEntry[]): Promise<PresetMutationResult> {
    try {
        const session = await auth();
        if (!session?.user?.id) return { ok: false, error: "Non authentifié" };

        const trimmedName = name.trim().slice(0, MAX_PRESET_NAME_LENGTH);
        if (!trimmedName) return { ok: false, error: "Le nom du preset est requis" };

        const validEntries = (entries ?? []).filter(isValidEntry).slice(0, MAX_ENTRIES_PER_PRESET);
        if (validEntries.length === 0) return { ok: false, error: "Le preset doit contenir au moins un numéro" };

        const count = await prismaAuth.searchPreset.count({
            where: { userId: session.user.id, page: PRESET_PAGE },
        });
        if (count >= MAX_PRESETS_PER_USER) {
            return { ok: false, error: `Maximum ${MAX_PRESETS_PER_USER} presets atteint` };
        }

        const existing = await prismaAuth.searchPreset.findFirst({
            where: { userId: session.user.id, page: PRESET_PAGE, name: trimmedName },
        });

        const entriesJson = validEntries as unknown as Prisma.InputJsonValue;

        const row = existing
            ? await prismaAuth.searchPreset.update({
                where: { id: existing.id },
                data: { entries: entriesJson },
            })
            : await prismaAuth.searchPreset.create({
                data: {
                    userId: session.user.id,
                    page: PRESET_PAGE,
                    name: trimmedName,
                    entries: entriesJson,
                },
            });

        return { ok: true, preset: toPreset(row) };
    } catch (error) {
        console.error("❌ Error saving search preset:", error);
        return { ok: false, unavailable: true, error: "Sauvegarde impossible (migration requise ?)" };
    }
}

export async function deleteSearchPreset(id: string): Promise<PresetMutationResult> {
    try {
        const session = await auth();
        if (!session?.user?.id) return { ok: false, error: "Non authentifié" };

        await prismaAuth.searchPreset.deleteMany({
            where: { id, userId: session.user.id },
        });

        return { ok: true };
    } catch (error) {
        console.error("❌ Error deleting search preset:", error);
        return { ok: false, unavailable: true, error: "Suppression impossible" };
    }
}
