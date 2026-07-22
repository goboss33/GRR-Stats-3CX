"use client";

import { useMemo, useRef, useState, KeyboardEvent } from "react";
import { Plus, X, Hash, ClipboardPaste, Phone, Globe, Asterisk } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    detectEntryKind,
    parseBulkInput,
    normalizeDigits,
    getEntryDisplayLabel,
} from "@/services/domain/extension-search";
import type { ExtensionDirectory, SearchEntry, SearchEntryKind } from "@/types/extension-stats.types";

interface ExtensionSearchTableProps {
    entries: SearchEntry[];
    onEntriesChange: (entries: SearchEntry[]) => void;
    directory: ExtensionDirectory;
    disabled?: boolean;
}

interface Suggestion {
    input: string;
    kind: SearchEntryKind;
    label: string;
    name: string | null;
}

const MAX_SUGGESTIONS = 8;

function KindBadge({ kind, onToggle }: { kind: SearchEntryKind; onToggle?: () => void }) {
    if (kind === "ddi") {
        return (
            <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 border-sky-300 text-sky-700 bg-sky-50 ${onToggle ? "cursor-pointer hover:bg-sky-100" : ""}`}
                onClick={onToggle}
                title={onToggle ? "Cliquer pour traiter comme une extension" : undefined}
            >
                <Globe className="h-3 w-3 mr-1" />
                DDI
            </Badge>
        );
    }
    if (kind === "pattern") {
        return (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-300 text-violet-700 bg-violet-50">
                <Asterisk className="h-3 w-3 mr-1" />
                Modèle
            </Badge>
        );
    }
    return (
        <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 border-emerald-300 text-emerald-700 bg-emerald-50 ${onToggle ? "cursor-pointer hover:bg-emerald-100" : ""}`}
            onClick={onToggle}
            title={onToggle ? "Cliquer pour traiter comme une DDI" : undefined}
        >
            <Phone className="h-3 w-3 mr-1" />
            Ext.
        </Badge>
    );
}

export function ExtensionSearchTable({ entries, onEntriesChange, directory, disabled }: ExtensionSearchTableProps) {
    const [inputValue, setInputValue] = useState("");
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkText, setBulkText] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    const addEntries = (newEntries: SearchEntry[]) => {
        const existingInputs = new Set(entries.map((e) => e.input));
        const unique = newEntries.filter((e) => e.input.trim() && !existingInputs.has(e.input.trim()));
        if (unique.length === 0) return;
        onEntriesChange([...entries, ...unique.map((e) => ({ input: e.input.trim(), kind: e.kind }))]);
    };

    const addRawInput = (raw: string, forcedKind?: SearchEntryKind) => {
        const trimmed = raw.trim();
        if (!trimmed) return;
        addEntries([{ input: trimmed, kind: forcedKind ?? detectEntryKind(trimmed) }]);
        setInputValue("");
        setShowSuggestions(false);
        inputRef.current?.focus();
    };

    const removeEntry = (input: string) => {
        onEntriesChange(entries.filter((e) => e.input !== input));
    };

    const toggleKind = (input: string) => {
        onEntriesChange(
            entries.map((e) => {
                if (e.input !== input || e.kind === "pattern") return e;
                return { ...e, kind: e.kind === "ddi" ? "extension" : "ddi" };
            })
        );
    };

    // Suggestions filtered from the directory (extensions + DDIs, matched on number or name)
    const suggestions = useMemo((): Suggestion[] => {
        const query = inputValue.trim().toLowerCase();
        if (query.length < 2) return [];
        const digits = normalizeDigits(query);
        const existingInputs = new Set(entries.map((e) => e.input));

        const extSuggestions: Suggestion[] = directory.extensions
            .filter((e) =>
                !existingInputs.has(e.number) &&
                (e.number.toLowerCase().includes(query) ||
                    (digits.length >= 2 && e.number.includes(digits)) ||
                    (e.name && e.name.toLowerCase().includes(query)))
            )
            .map((e) => ({ input: e.number, kind: "extension" as const, label: e.number, name: e.name }));

        const ddiSuggestions: Suggestion[] = directory.ddis
            .filter((d) =>
                !existingInputs.has(d.number) &&
                (d.number.toLowerCase().includes(query) ||
                    (digits.length >= 4 && normalizeDigits(d.number).includes(digits)) ||
                    (d.name && d.name.toLowerCase().includes(query)))
            )
            .map((d) => ({ input: d.number, kind: "ddi" as const, label: getEntryDisplayLabel({ input: d.number, kind: "ddi" }), name: d.name }));

        return [...extSuggestions, ...ddiSuggestions].slice(0, MAX_SUGGESTIONS);
    }, [inputValue, directory, entries]);

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (showSuggestions && suggestions.length > 0 && highlightedIndex >= 0) {
                const s = suggestions[highlightedIndex];
                addRawInput(s.input, s.kind);
            } else {
                addRawInput(inputValue);
            }
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlightedIndex((i) => Math.min(i + 1, suggestions.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlightedIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === "Escape") {
            setShowSuggestions(false);
        }
    };

    // Bulk import parsing (live preview)
    const bulkParsed = useMemo(() => {
        if (!bulkText.trim()) return [];
        const existingInputs = new Set(entries.map((e) => e.input));
        return parseBulkInput(bulkText)
            .filter((t) => !existingInputs.has(t))
            .map((t) => ({ input: t, kind: detectEntryKind(t) }));
    }, [bulkText, entries]);

    const handleBulkImport = () => {
        addEntries(bulkParsed);
        setBulkOpen(false);
        setBulkText("");
    };

    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 z-10" />
                    <Input
                        ref={inputRef}
                        type="text"
                        placeholder="Extension, DDI ou modèle (ex: 101, +41274842020, *2020)..."
                        value={inputValue}
                        onChange={(e) => {
                            setInputValue(e.target.value);
                            setShowSuggestions(true);
                            setHighlightedIndex(0);
                        }}
                        onFocus={() => setShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                        onKeyDown={handleKeyDown}
                        className="pl-9"
                        disabled={disabled}
                    />
                    {showSuggestions && suggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-50 overflow-hidden">
                            {suggestions.map((s, index) => (
                                <button
                                    key={`${s.kind}-${s.input}`}
                                    type="button"
                                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${index === highlightedIndex ? "bg-slate-100" : ""}`}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        addRawInput(s.input, s.kind);
                                    }}
                                    onMouseEnter={() => setHighlightedIndex(index)}
                                >
                                    <KindBadge kind={s.kind} />
                                    <span className="font-mono">{s.label}</span>
                                    {s.name && <span className="text-slate-500 truncate">— {s.name}</span>}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <Button
                    onClick={() => addRawInput(inputValue)}
                    disabled={!inputValue.trim() || disabled}
                    size="icon"
                    className="h-10 w-10 flex-shrink-0"
                    title="Ajouter"
                >
                    <Plus className="h-4 w-4" />
                </Button>
                <Button
                    variant="outline"
                    onClick={() => setBulkOpen(true)}
                    disabled={disabled}
                    className="h-10 flex-shrink-0"
                    title="Importer une liste (copier-coller)"
                >
                    <ClipboardPaste className="h-4 w-4 mr-2" />
                    Import en masse
                </Button>
            </div>

            {entries.length > 0 ? (
                <div className="border rounded-lg">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[50px]">#</TableHead>
                                <TableHead className="w-[90px]">Type</TableHead>
                                <TableHead>Numéro</TableHead>
                                <TableHead className="w-[80px] text-right">Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {entries.map((entry, index) => (
                                <TableRow key={entry.input}>
                                    <TableCell className="text-slate-500">{index + 1}</TableCell>
                                    <TableCell>
                                        <KindBadge kind={entry.kind} onToggle={() => toggleKind(entry.input)} />
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="secondary" className="font-mono text-sm px-3 py-1">
                                            {getEntryDisplayLabel(entry)}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-slate-400 hover:text-red-500"
                                            onClick={() => removeEntry(entry.input)}
                                            disabled={disabled}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            ) : (
                <div className="border border-dashed rounded-lg p-8 text-center text-slate-400">
                    <Hash className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Ajoutez un ou plusieurs numéros pour lancer la recherche</p>
                    <p className="text-xs mt-1">Extensions, DDI (ex: +41274842020) ou modèles avec * (ex: *2020)</p>
                </div>
            )}

            <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Import en masse</DialogTitle>
                        <DialogDescription>
                            Collez une liste de numéros (colonne Excel, texte libre...). Les doublons sont ignorés automatiquement.
                        </DialogDescription>
                    </DialogHeader>
                    <Textarea
                        placeholder={"41274842010\n41274842011\n41274842012\n..."}
                        value={bulkText}
                        onChange={(e) => setBulkText(e.target.value)}
                        rows={8}
                        className="font-mono text-sm"
                    />
                    {bulkParsed.length > 0 && (
                        <div className="border rounded-lg p-3 max-h-40 overflow-y-auto">
                            <p className="text-xs text-slate-500 mb-2">{bulkParsed.length} numéro(s) détecté(s) :</p>
                            <div className="flex flex-wrap gap-1.5">
                                {bulkParsed.map((p) => (
                                    <span key={p.input} className="inline-flex items-center gap-1">
                                        <KindBadge kind={p.kind} />
                                        <span className="font-mono text-xs">{p.input}</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBulkOpen(false)}>Annuler</Button>
                        <Button onClick={handleBulkImport} disabled={bulkParsed.length === 0}>
                            Importer {bulkParsed.length > 0 ? `(${bulkParsed.length})` : ""}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
