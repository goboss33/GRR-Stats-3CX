import type { InboundSource, JourneyFilter } from "./call.types";
import { outcomesForBucket, type CallOrigin, type ClassificationRules } from "./call-classification";

/**
 * « D'où viennent nos appels » — la logique pure du graphique de provenance
 * inter-équipes de l'écran détail (sous la courbe et la carte des affluences).
 *
 * Le FAIT lui-même naît dans le socle de classement : `from_queue` est la
 * dernière autre file sollicitée avant notre passage, dans le même appel (cf.
 * buildQueuePassagesCTE). Ici ne vivent que les trois traitements
 * d'affichage, testables sans base : la règle de périmètre, le pliage de la
 * traîne et le lien vers les journaux.
 */

/** Libellé du regroupement anonyme quand la règle interdit de nommer. */
export const LIBELLE_HORS_PERIMETRE = "Équipes hors périmètre";

/** Au-delà, la traîne se replie en une seule ligne « N autres équipes ». */
export const MAX_BARRES = 10;

/** Volume décroissant, puis nom — un ordre stable pour des volumes égaux. */
function parVolume<T extends { calls: number; queueName: string }>(a: T, b: T): number {
    return b.calls - a.calls || a.queueName.localeCompare(b.queueName, "fr");
}

/**
 * Règle 6 du socle (`outOfScopeFinalStatus`) appliquée aux équipes d'origine.
 *
 * Une équipe hors du périmètre de l'utilisateur est nommée (« name »), ou
 * fondue dans UN regroupement anonyme (« anonymize » et « hide » se
 * confondent ici : un graphique qui se tairait ferait mentir son total — on
 * montre le volume, jamais le nom). Le tri par volume est refait après
 * regroupement, l'anonyme prenant sa place selon son poids.
 */
export function appliquerPerimetreProvenances(
    sources: ReadonlyArray<Omit<InboundSource, "inScope">>,
    estDansPerimetre: (queueNumber: string) => boolean,
    regle: ClassificationRules["outOfScopeFinalStatus"],
): InboundSource[] {
    const resultat: InboundSource[] = [];
    let anonymes = 0;
    for (const s of sources) {
        // L'API ne produit jamais de numéro nul ; garde-fou de type seulement.
        if (s.queueNumber === null) continue;
        const inScope = estDansPerimetre(s.queueNumber);
        if (inScope || regle === "name") resultat.push({ ...s, inScope });
        else anonymes += s.calls;
    }
    if (anonymes > 0) {
        resultat.push({ queueNumber: null, queueName: LIBELLE_HORS_PERIMETRE, calls: anonymes, inScope: false });
    }
    return resultat.sort(parVolume);
}

export interface TrainePliee<T> {
    /** Les barres affichées, par volume décroissant. */
    visibles: T[];
    /** La traîne repliée (au moins DEUX équipes), ou null quand tout s'affiche. */
    traine: { equipes: number; calls: number; detail: T[] } | null;
}

/**
 * Replie la longue traîne : les MAX_BARRES plus grosses équipes restent des
 * barres, le reste devient UNE ligne. Une traîne d'une seule équipe ne mérite
 * pas d'être masquée : on l'affiche plutôt que d'écrire « 1 autre équipe ».
 *
 * Mesuré sur la réception de Genève en août 2026 : 39 équipes d'origine, les
 * dix premières portent 81 % du volume, les 29 autres 421 appels. Partagé par
 * les deux cartes (origines et destinations), d'où le générique.
 */
export function replierTraine<T extends { calls: number; queueName: string }>(
    lignes: readonly T[],
    maxBarres = MAX_BARRES,
): TrainePliee<T> {
    const triees = [...lignes].sort(parVolume);
    if (triees.length <= maxBarres + 1) return { visibles: triees, traine: null };
    const visibles = triees.slice(0, maxBarres);
    const detail = triees.slice(maxBarres);
    return {
        visibles,
        traine: { equipes: detail.length, calls: detail.reduce((acc, s) => acc + s.calls, 0), detail },
    };
}

export type ProvenancesPliees = TrainePliee<InboundSource>;

export function replierProvenances(sources: readonly InboundSource[], maxBarres = MAX_BARRES): ProvenancesPliees {
    return replierTraine(sources, maxBarres);
}

/**
 * Filtre de parcours des journaux : « passé par l'équipe d'origine, puis par
 * la nôtre ». C'est la forme que sait déjà lire ColumnFilterJourney
 * (`overflowQueueNumber` = file atteinte APRÈS la première occurrence de
 * `queueNumber`). Elle tolère un passage intermédiaire par une troisième file
 * — écart mesuré à 0 sur la plus grosse barre d'août 2026 (948 → 958), les
 * appels traversant trois files ou plus faisant 0,6 % du total.
 */
export function filtreParcoursProvenance(fromQueue: string, queueNumber: string): JourneyFilter {
    return {
        groups: [{
            operator: "AND",
            group: {
                conditions: [{
                    operator: "AND",
                    condition: { type: "queue", queueNumber: fromQueue, overflowQueueNumber: queueNumber },
                }],
            },
        }],
    };
}

/**
 * Lien d'une barre vers les journaux — même socle que les vignettes du bilan
 * (`queueOutcome` = statuts « reçus » de la file, SANS les directs de
 * l'équipe : un appel venu d'une autre équipe est forcément passé par notre
 * file), plus le filtre de parcours. La provenance est toujours explicite :
 * le défaut des journaux est « externe », l'omettre depuis « Les deux »
 * ferait retomber la liste sur les seuls appels externes.
 */
export function lienJournauxProvenance(p: {
    queueNumber: string;
    fromQueue: string;
    startDate: string;
    endDate: string;
    origin: CallOrigin;
}): string {
    const params = new URLSearchParams();
    params.set("start", p.startDate);
    params.set("end", p.endDate);
    params.set("queueOutcome", `${p.queueNumber}:${outcomesForBucket("received").join(",")}`);
    params.set("origin", p.origin);
    params.set("journeyFilter", JSON.stringify(filtreParcoursProvenance(p.fromQueue, p.queueNumber)));
    return `/admin/logs?${params.toString()}`;
}
