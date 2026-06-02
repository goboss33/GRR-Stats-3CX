"use client";

import { useState, KeyboardEvent } from "react";
import { Plus, X, Hash } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

interface ExtensionSearchTableProps {
    extensions: string[];
    onExtensionsChange: (extensions: string[]) => void;
}

export function ExtensionSearchTable({ extensions, onExtensionsChange }: ExtensionSearchTableProps) {
    const [inputValue, setInputValue] = useState("");

    const addExtension = () => {
        const trimmed = inputValue.trim();
        if (!trimmed) return;
        if (extensions.includes(trimmed)) {
            setInputValue("");
            return;
        }
        onExtensionsChange([...extensions, trimmed]);
        setInputValue("");
    };

    const removeExtension = (ext: string) => {
        onExtensionsChange(extensions.filter((e) => e !== ext));
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addExtension();
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                        type="text"
                        placeholder="Entrer un numéro ou une extension (ex: 101, 0123456789)..."
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="pl-9"
                    />
                </div>
                <Button
                    onClick={addExtension}
                    disabled={!inputValue.trim()}
                    size="icon"
                    className="h-10 w-10 flex-shrink-0"
                >
                    <Plus className="h-4 w-4" />
                </Button>
            </div>

            {extensions.length > 0 ? (
                <div className="border rounded-lg">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[60px]">#</TableHead>
                                <TableHead>Numéro / Extension</TableHead>
                                <TableHead className="w-[80px] text-right">Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {extensions.map((ext, index) => (
                                <TableRow key={ext}>
                                    <TableCell className="text-slate-500">{index + 1}</TableCell>
                                    <TableCell>
                                        <Badge variant="secondary" className="font-mono text-sm px-3 py-1">
                                            {ext}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-slate-400 hover:text-red-500"
                                            onClick={() => removeExtension(ext)}
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
                </div>
            )}
        </div>
    );
}
