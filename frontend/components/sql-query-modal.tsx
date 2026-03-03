"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";

interface SqlQueryModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sql: string;
    isLoading: boolean;
}

export function SqlQueryModal({ open, onOpenChange, sql, isLoading }: SqlQueryModalProps) {
    const [copied, setCopied] = useState(false);
    const [editedSql, setEditedSql] = useState("");

    // Sync editedSql with sql when modal opens or sql changes
    const displaySql = editedSql || sql;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(displaySql);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback for older browsers
            const textarea = document.createElement("textarea");
            textarea.value = displaySql;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setEditedSql("");
        }
        onOpenChange(open);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Requête SQL</DialogTitle>
                </DialogHeader>
                {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="flex flex-col items-center gap-3">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
                            <p className="text-sm text-slate-500">Génération de la requête...</p>
                        </div>
                    </div>
                ) : (
                    <textarea
                        className="flex-1 min-h-[400px] w-full p-4 font-mono text-xs leading-relaxed bg-slate-950 text-slate-100 rounded-lg border border-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={editedSql || sql}
                        onChange={(e) => setEditedSql(e.target.value)}
                        spellCheck={false}
                    />
                )}
                <DialogFooter className="gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopy}
                        disabled={isLoading || !displaySql}
                        className="gap-2"
                    >
                        {copied ? (
                            <>
                                <Check className="h-4 w-4 text-emerald-600" />
                                Copié !
                            </>
                        ) : (
                            <>
                                <Copy className="h-4 w-4" />
                                Copier
                            </>
                        )}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
                        Fermer
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
