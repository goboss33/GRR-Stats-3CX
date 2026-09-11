/**
 * VISITE GUIDÉE — le contenu et la géométrie (septembre 2026).
 *
 * Deux visites, une par écran : le tableau de bord, et les statistiques
 * d'une équipe. Chaque étape désigne un élément par son ancre
 * `data-visite="…"` posée dans le composant, et l'explique en une ou deux
 * phrases. Les textes des vignettes du bilan sont ceux de leurs infobulles :
 * ils vivent ici et les composants les importent — une seule source, la
 * visite dit exactement ce que dit l'écran.
 *
 * Vocabulaire : jamais « file » face à un manager, toujours « équipe ».
 */

export type Visite = "dashboard" | "statistics";

export const VISITES: readonly Visite[] = ["dashboard", "statistics"];

export const LIBELLES_VISITE: Record<Visite, string> = {
    dashboard: "Tableau de bord",
    statistics: "Statistiques d'une équipe",
};

export function estVisite(x: unknown): x is Visite {
    return typeof x === "string" && (VISITES as readonly string[]).includes(x);
}

/** Les infobulles du bilan d'équipe (TeamOverview), reprises telles quelles par la visite. */
export const TEXTES_BILAN = {
    recus: "Total des appels entrants de l'équipe.",
    repondus: "Total d'appels répondus par l'équipe.",
    debordes: "Appels non répondus dans les délais et redirigés automatiquement vers une autre équipe ou le service client.",
    perdus: "Appels raccrochés par le client.",
    directs: "Appels arrivés sur les lignes directes des collaborateurs de l'équipe.",
    equipe: "Appels initialement destinés à un collaborateur puis proposés à l'ensemble de l'équipe en l'absence de réponse.",
} as const;

/** Les infobulles ⓘ des deux cartes d'échanges entre équipes. */
export const TEXTE_PROVENANCE = "Appels arrivés dans l'équipe parce qu'une autre équipe ne les a pas pris (ou nous les a transmis).";
export const TEXTE_DESTINATIONS = "Appels décrochés ici puis servis ailleurs (transférés) ou repartis sans décroché (débordés).";

export interface EtapeVisite {
    /** La valeur de l'attribut data-visite de l'élément à mettre en lumière. */
    ancre: string;
    titre: string;
    texte: string;
}

// Les deux graphiques existent sur les deux écrans : même texte des deux côtés.
const TEXTE_EVOLUTION = "Ce graphique montre le rapport entre appels répondus (en vert) et appels perdus (en rouge) sur la période. Activez « Comparer » pour afficher la période précédente en traitillé et comparer les pics.";
const TEXTE_AFFLUENCES = "Chacune des cases représente un créneau horaire (jour et heure) : plus la case est foncée, plus il y a d'appels dans ce créneau.";

export const ETAPES: Record<Visite, readonly EtapeVisite[]> = {
    dashboard: [
        { ancre: "recherche", titre: "Rechercher", texte: "Rechercher une équipe ou le nom d'un collaborateur." },
        { ancre: "origine", titre: "Externe ou interne", texte: "Externe : appels entrants provenant de vos clients. Interne : appels entrants de vos collègues." },
        { ancre: "periode", titre: "La période", texte: "Choisissez la période sur laquelle vous souhaitez analyser les appels. La période définie ici s'applique à tout l'écran." },
        { ancre: "kpis", titre: "Les chiffres clés", texte: "Les principaux KPI d'appels sur la période, avec un comparatif de la période précédente indiqué en %." },
        { ancre: "evolution", titre: "Évolution du volume", texte: TEXTE_EVOLUTION },
        { ancre: "affluences", titre: "Carte des affluences", texte: TEXTE_AFFLUENCES },
        { ancre: "equipes", titre: "Mes équipes", texte: "Les chiffres de l'équipe en un coup d'œil. Cliquez sur la carte pour entrer dans la statistique détaillée." },
    ],
    statistics: [
        { ancre: "recus", titre: "Appels reçus", texte: TEXTES_BILAN.recus },
        { ancre: "repondus", titre: "Appels répondus", texte: TEXTES_BILAN.repondus },
        { ancre: "debordes", titre: "Appels débordés", texte: TEXTES_BILAN.debordes },
        { ancre: "perdus", titre: "Appels perdus", texte: TEXTES_BILAN.perdus },
        { ancre: "directs", titre: "Appels directs", texte: TEXTES_BILAN.directs },
        { ancre: "equipe", titre: "Appels d'équipe", texte: TEXTES_BILAN.equipe },
        { ancre: "activite", titre: "Activité des collaborateurs", texte: "Détail de la prise d'appels par collaborateur de l'équipe." },
        { ancre: "activite-entetes", titre: "Les colonnes", texte: "Passez sur chaque en-tête du tableau pour lire l'explication de chacune des colonnes." },
        { ancre: "evolution", titre: "Évolution du volume", texte: TEXTE_EVOLUTION },
        { ancre: "affluences", titre: "Carte des affluences", texte: TEXTE_AFFLUENCES },
        { ancre: "provenance", titre: "D'où viennent nos appels", texte: TEXTE_PROVENANCE },
        { ancre: "destinations", titre: "Où partent nos appels", texte: TEXTE_DESTINATIONS },
    ],
};

// ============================================
// GÉOMÉTRIE DE L'INFOBULLE
// ============================================

export interface Boite {
    top: number;
    left: number;
    width: number;
    height: number;
}

export interface PlacementInfobulle {
    top: number;
    left: number;
    /** Sous la cible (« bas ») de préférence, au-dessus quand la place manque. */
    position: "bas" | "haut";
    /** Abscisse de la flèche, relative à l'infobulle : elle vise le centre de la cible. */
    fleche: number;
}

const BORD = 12;
const FLECHE_MIN = 16;

/**
 * Place l'infobulle sous la cible, ou au-dessus si elle déborderait de la
 * fenêtre, et la garde dans les marges latérales. La flèche suit le centre
 * de la cible, sans jamais sortir de l'infobulle.
 */
export function placerInfobulle(
    cible: Boite,
    fenetre: { width: number; height: number },
    infobulle: { width: number; height: number },
    marge = 14,
): PlacementInfobulle {
    const dessous = cible.top + cible.height + marge;
    const tientDessous = dessous + infobulle.height <= fenetre.height - BORD;
    const dessus = cible.top - marge - infobulle.height;
    const position: "bas" | "haut" = tientDessous || dessus < BORD ? "bas" : "haut";
    const top = position === "bas" ? dessous : dessus;

    const centre = cible.left + cible.width / 2;
    const leftMax = Math.max(BORD, fenetre.width - infobulle.width - BORD);
    const left = Math.min(Math.max(centre - infobulle.width / 2, BORD), leftMax);
    const fleche = Math.min(Math.max(centre - left, FLECHE_MIN), infobulle.width - FLECHE_MIN);
    return { top, left, position, fleche };
}
