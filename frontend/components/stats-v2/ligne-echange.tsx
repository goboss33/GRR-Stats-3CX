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
export const GRILLE_ECHANGE = "grid grid-cols-[1.75rem_minmax(0,11rem)_1fr_3.25rem_auto] items-center gap-3";

/** Une équipe : l'icône du titre de l'écran, dans un rond discret. */
export function IconeEquipe({ discret = false }: { discret?: boolean }) {
    return (
        <span className={`flex h-7 w-7 items-center justify-center rounded-full ${discret ? "bg-slate-50 text-slate-400" : "bg-slate-100 text-slate-500"}`}>
            <Users className="h-4 w-4" />
        </span>
    );
}

export function LigneEchange({ icone, libelle, calls, max, href, infobulle, discret = false, teinte, visages }: {
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
            <span className="flex items-center justify-end">{visages}</span>
        </>
    );
    const classes = `-mx-2 ${GRILLE_ECHANGE} rounded-md px-2 py-1`;
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
