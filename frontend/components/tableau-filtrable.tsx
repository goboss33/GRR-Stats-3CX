"use client";

import type { Dispatch, SetStateAction } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * LA CHARPENTE DES TABLEAUX FILTRABLES — en-têtes triables, menus à cocher
 * avec comptes, puces des filtres actifs.
 *
 * Née dans le registre des files, partagée depuis avec le tableau des
 * collaborateurs : deux tableaux sur le même code ne peuvent plus diverger
 * d'un padding ou d'une nuance de bleu. Le troisième ne coûtera presque rien.
 */

/** Coche ou décoche une valeur dans un filtre (un Set d'état React). */
export const basculerDansSet = (majSet: Dispatch<SetStateAction<Set<string>>>, valeur: string) =>
    majSet((s) => {
        const suivant = new Set(s);
        if (suivant.has(valeur)) suivant.delete(valeur);
        else suivant.add(valeur);
        return suivant;
    });

export interface OptionFiltre {
    valeur: string;
    libelle: string;
    compte: number;
}

/**
 * Un filtre à cocher, chaque entrée portant son nombre de lignes.
 *
 * Les comptes valent pour le reste des filtres mais ignorent la sélection de
 * CE menu : cocher « GRR PULLY » ne change donc pas le nombre affiché en face
 * de « GRR GENEVE ». Sans cela les nombres danseraient sous le curseur.
 *
 * Une entrée dont le compte est nul disparaît — un filtre qui ne peut rien
 * trouver n'est que du bruit. Elle reste visible si elle est cochée, sans quoi
 * on ne pourrait plus la décocher.
 */
export function MenuFiltre({
    libelle,
    icone: Icone,
    options,
    selection,
    onBasculer,
}: {
    libelle: string;
    icone: LucideIcon;
    options: OptionFiltre[];
    selection: Set<string>;
    onBasculer: (valeur: string) => void;
}) {
    const visibles = options.filter((o) => o.compte > 0 || selection.has(o.valeur));
    if (visibles.length === 0) return null;
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    className={cn(
                        "h-9 gap-1.5",
                        selection.size > 0 && "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100",
                    )}
                >
                    <Icone className="h-4 w-4" />
                    {libelle}
                    {selection.size > 0 && (
                        <span className="rounded bg-blue-600 px-1.5 text-[10px] font-medium text-white">
                            {selection.size}
                        </span>
                    )}
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
                {visibles.map((o) => (
                    <DropdownMenuCheckboxItem
                        key={o.valeur}
                        checked={selection.has(o.valeur)}
                        onCheckedChange={() => onBasculer(o.valeur)}
                        /* Le menu reste ouvert : on coche rarement une seule case. */
                        onSelect={(e) => e.preventDefault()}
                    >
                        <span className="flex-1 truncate">{o.libelle}</span>
                        <span className="ml-3 text-xs tabular-nums text-slate-400">{o.compte}</span>
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/** En-tête cliquable : un clic trie, un second inverse. Générique sur la clé de colonne. */
export function EnTeteTri<K extends string>({
    colonne,
    libelle,
    tri,
    onTrier,
    className,
}: {
    colonne: K;
    libelle: string;
    tri: { colonne: K; sens: "asc" | "desc" };
    onTrier: (colonne: K) => void;
    className?: string;
}) {
    const actif = tri.colonne === colonne;
    return (
        <th
            className={cn("px-4 py-3 text-left font-medium text-slate-600", className)}
            aria-sort={actif ? (tri.sens === "asc" ? "ascending" : "descending") : "none"}
        >
            <button
                type="button"
                onClick={() => onTrier(colonne)}
                className="group inline-flex items-center gap-1 hover:text-slate-900"
            >
                {libelle}
                {actif ? (
                    tri.sens === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
                ) : (
                    <ArrowUpDown className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500" />
                )}
            </button>
        </th>
    );
}

export interface Puce {
    cle: string;
    libelle: string;
    retirer: () => void;
}

/**
 * Ce qui est filtré, en puces sous la barre, avec le compte de ce qu'on ne
 * voit pas : un tableau tronqué en silence se lit comme un tableau complet.
 */
export function PucesDeFiltres({
    puces,
    affichees,
    total,
    unite,
    onToutEffacer,
}: {
    puces: Puce[];
    affichees: number;
    total: number;
    /** « file(s) », « collaborateur(s) »… */
    unite: string;
    onToutEffacer: () => void;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2 text-xs">
            {puces.map((puce) => (
                <button
                    key={puce.cle}
                    type="button"
                    onClick={puce.retirer}
                    className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700 hover:bg-blue-100"
                >
                    {puce.libelle}
                    <X className="h-3 w-3" />
                </button>
            ))}
            <span className="text-slate-500">
                {affichees} {unite} affiché(e)s sur {total}
            </span>
            <button
                type="button"
                onClick={onToutEffacer}
                className="text-blue-600 underline underline-offset-2 hover:text-blue-800"
            >
                Tout effacer
            </button>
        </div>
    );
}
