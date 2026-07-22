"use client";

import { useEffect, useState } from "react";
import { Bookmark, BookmarkPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    listSearchPresets,
    saveSearchPreset,
    deleteSearchPreset,
} from "@/services/search-presets.service";
import type { SearchEntry, SearchPreset } from "@/types/extension-stats.types";

interface PresetMenuProps {
    currentEntries: SearchEntry[];
    onApplyPreset: (entries: SearchEntry[]) => void;
    disabled?: boolean;
}

/**
 * Saved search presets (per user, stored in the auth DB).
 * Renders nothing when the feature is unavailable (migration not applied yet).
 */
export function PresetMenu({ currentEntries, onApplyPreset, disabled }: PresetMenuProps) {
    const [presets, setPresets] = useState<SearchPreset[]>([]);
    const [available, setAvailable] = useState(false);
    const [saveDialogOpen, setSaveDialogOpen] = useState(false);
    const [presetName, setPresetName] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        listSearchPresets().then((result) => {
            if (result.ok) {
                setPresets(result.presets);
                setAvailable(true);
            }
        });
    }, []);

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        const result = await saveSearchPreset(presetName, currentEntries);
        setIsSaving(false);
        if (!result.ok) {
            setError(result.error ?? "Erreur lors de la sauvegarde");
            return;
        }
        setPresets((prev) => {
            const others = prev.filter((p) => p.id !== result.preset!.id);
            return [...others, result.preset!].sort((a, b) => a.name.localeCompare(b.name));
        });
        setSaveDialogOpen(false);
        setPresetName("");
    };

    const handleDelete = async (id: string) => {
        const result = await deleteSearchPreset(id);
        if (result.ok) {
            setPresets((prev) => prev.filter((p) => p.id !== id));
        }
    };

    if (!available) return null;

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="h-10" disabled={disabled}>
                        <Bookmark className="h-4 w-4 mr-2" />
                        Presets
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                    <DropdownMenuLabel>Mes recherches sauvegardées</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {presets.length === 0 && (
                        <div className="px-2 py-3 text-sm text-slate-400 text-center">
                            Aucun preset enregistré
                        </div>
                    )}
                    {presets.map((preset) => (
                        <DropdownMenuItem
                            key={preset.id}
                            className="flex items-center justify-between cursor-pointer"
                            onSelect={() => onApplyPreset(preset.entries)}
                        >
                            <span className="truncate flex-1">
                                {preset.name}
                                <span className="text-xs text-slate-400 ml-2">({preset.entries.length})</span>
                            </span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-slate-400 hover:text-red-500 flex-shrink-0"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(preset.id);
                                }}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        disabled={currentEntries.length === 0}
                        onSelect={() => setSaveDialogOpen(true)}
                        className="cursor-pointer"
                    >
                        <BookmarkPlus className="h-4 w-4 mr-2" />
                        Sauvegarder la sélection ({currentEntries.length})
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Sauvegarder le preset</DialogTitle>
                        <DialogDescription>
                            Enregistre la liste actuelle de {currentEntries.length} numéro(s) pour une réutilisation ultérieure.
                        </DialogDescription>
                    </DialogHeader>
                    <Input
                        placeholder="Nom du preset (ex: Équipe Gérance Pully)"
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSave()}
                        maxLength={60}
                    />
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>Annuler</Button>
                        <Button onClick={handleSave} disabled={!presetName.trim() || isSaving}>
                            {isSaving ? "Sauvegarde..." : "Sauvegarder"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
