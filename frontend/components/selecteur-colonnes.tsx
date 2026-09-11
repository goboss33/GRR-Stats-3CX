"use client";

import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";

/**
 * Le menu « Colonnes visibles » : la même icône et la même liste à cocher que
 * les journaux d'appels, extraites pour servir à plusieurs tableaux. Le
 * composant ne mémorise rien lui-même — c'est l'écran qui décide où le
 * choix vit.
 */
export function SelecteurColonnes<K extends string>({ colonnes, visibles, onBasculer }: {
    colonnes: readonly { cle: K; libelle: string }[];
    visibles: ReadonlySet<K>;
    onBasculer: (cle: K) => void;
}) {
    return (
        <Popover>
            <Tip content="Choisir les colonnes visibles">
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9 gap-1.5 text-slate-600">
                        <Columns3 className="h-4 w-4" />
                        Colonnes
                    </Button>
                </PopoverTrigger>
            </Tip>
            <PopoverContent className="w-52 p-2" align="end">
                <p className="mb-2 px-1 text-xs font-medium text-slate-600">Colonnes visibles</p>
                <div className="space-y-1">
                    {colonnes.map((c) => (
                        <div key={c.cle} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50">
                            <Checkbox id={`col-${c.cle}`} checked={visibles.has(c.cle)} onCheckedChange={() => onBasculer(c.cle)} />
                            <Label htmlFor={`col-${c.cle}`} className="cursor-pointer text-sm font-normal">{c.libelle}</Label>
                        </div>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}
