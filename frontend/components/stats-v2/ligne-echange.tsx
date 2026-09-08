"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Users } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";

/**
 * La grammaire de ligne PARTAGÉE par « D'où viennent nos appels » et « Où
 * partent nos appels » : icône · libellé · barre · nombre · visages. Les deux
 * cartes se lisent pareil parce qu'elles sont faites de la même ligne — pas
 * parce qu'on y a veillé. Une seule ligne de texte par ligne : les deux
 * cartes gardent la même hauteur de rangée (retour du 8 sept. 2026).
 */
// Le nom de l'équipe prime sur la barre : « Gérance GE-01 + GE-03 + GE-20 »
// tient en entier, la barre prend ce qui reste (elle ne sert qu'à comparer).
// ⚠️ Ces deux classes sont écrites EN TOUTES LETTRES : Tailwind ne génère que
// ce qu'il lit littéralement dans les sources — une classe assemblée par
// interpolation ne produirait aucun style.

/** Carte sans visages (« D'où viennent nos appels ») : quatre colonnes. */
export const GRILLE_ECHANGE = "grid grid-cols-[1.75rem_minmax(0,15rem)_1fr_3.25rem] items-center gap-3";

/**
 * Carte avec visages : la colonne des portraits a une largeur FIXE.
 *
 * Chaque ligne est sa propre grille : une dernière colonne `auto` se
 * dimensionnait sur le contenu de SA ligne, si bien que la colonne des
 * nombres glissait d'une ligne à l'autre et que les chiffres ne s'alignaient
 * plus (retour du 8 sept. 2026). 6 rem = les quatre portraits de 24 px
 * chevauchés de 6 px, plus le « +N » : 24 + 4 × 18 = 96 px.
 */
export const GRILLE_ECHANGE_VISAGES = "grid grid-cols-[1.75rem_minmax(0,15rem)_1fr_3.25rem_6rem] items-center gap-3";

/** Une équipe : l'icône du titre de l'écran, dans un rond discret. */
export function IconeEquipe({ discret = false }: { discret?: boolean }) {
    return (
        <span className={`flex h-7 w-7 items-center justify-center rounded-full ${discret ? "bg-slate-50 text-slate-400" : "bg-slate-100 text-slate-500"}`}>
            <Users className="h-4 w-4" />
        </span>
    );
}

export function LigneEchange({ icone, libelle, calls, max, href, infobulle, discret = false, teinte, visages, grille = GRILLE_ECHANGE }: {
    icone: ReactNode;
    libelle: string;
    calls: number;
    /** Le plus gros volume affiché : la barre est proportionnelle. */
    max: number;
    /** Lien vers les journaux ; null = simple ligne, sans affordance de clic mensongère. */
    href: string | null;
    /** Infobulle de toute la ligne — à omettre quand la ligne porte ses propres infobulles (visages). */
    infobulle?: string;
    discret?: boolean;
    /** Classes de couleur de la barre ; le bleu clair marque un regroupement. */
    teinte?: string;
    visages?: ReactNode;
    /** Grille de la carte : la MÊME pour toutes ses lignes, sinon les colonnes ne s'alignent pas. */
    grille?: string;
}) {
    const largeur = `${Math.max(1, (calls / Math.max(max, 1)) * 100)}%`;
    const couleur = teinte ?? "bg-blue-500 group-hover:bg-blue-600";
    const contenu = (
        <>
            <span className="flex items-center justify-center">{icone}</span>
            <span className={`truncate text-sm ${discret ? "text-slate-500" : "text-slate-700"}`}>{libelle}</span>
            <span className="block">
                <span className={`block h-3.5 rounded-r transition-colors ${couleur}`} style={{ width: largeur }} />
            </span>
            <span className="text-right text-sm tabular-nums text-slate-600">{calls}</span>
            {visages !== undefined && <span className="flex items-center justify-end">{visages}</span>}
        </>
    );
    const classes = `-mx-2 ${grille} rounded-md px-2 py-1`;
    const corps = href ? (
        <Link href={href} target="_blank" rel="noopener noreferrer" className={`group ${classes} transition-colors hover:bg-slate-50`}>
            {contenu}
        </Link>
    ) : (
        <div className={classes}>{contenu}</div>
    );
    return (
        <li>
            {infobulle ? <Tip content={infobulle} align="start">{corps}</Tip> : corps}
        </li>
    );
}
