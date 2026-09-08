import type { OutboundExit, OutboundPerson, OutboundTeam, OutboundTeamKind } from "./call.types";
import type { CallOrigin, ClassificationRules, PassageOutcome } from "./call-classification";

/**
 * « Où partent nos appels » — la logique pure de la carte des destinations de
 * l'écran détail (à droite de « D'où viennent nos appels »).
 *
 * Les FAITS naissent dans la route de l'API (CTE `exits` : première
 * destination de chaque appel transféré ou débordé). Ici : la règle de
 * l'équipe principale, la composition par équipe avec les visages, et la
 * règle de périmètre — testables sans base.
 */

/** Les sorts qui font « partir » un appel : transféré (décroché ici, servi ailleurs) et débordé. */
export const DEPARTED_OUTCOMES: readonly PassageOutcome[] = ["handed_off", "overflow"];

export const LIBELLES_REGROUPEMENTS: Record<Exclude<OutboundTeamKind, "team">, string> = {
    no_team: "Sans équipe",
    external: "Numéros externes",
    unknown: "Destination inconnue",
    out_of_scope: "Équipes hors périmètre",
};

export interface EquipePrincipale {
    queueNumber: string;
    queueName: string;
    /** Les autres appartenances, pour l'afficher plutôt que le cacher. */
    autres: Array<{ queueNumber: string; queueName: string }>;
}

export interface AppartenanceJournal {
    queueNumber: string;
    queueName: string;
    lastSeenAt: Date;
}

export interface ActiviteFile {
    queueNumber: string;
    queueName: string;
    calls: number;
    lastAt: Date;
}

/**
 * Règle de l'équipe principale (arbitrage du 8 sept. 2026).
 *
 * Une personne jointe sur sa ligne directe est rattachée à UNE équipe :
 * - les candidates sont ses appartenances du journal de composition XAPI
 *   (la configuration 3CX officielle, datée) quand le journal couvre la
 *   période — sinon les files qui l'ont sollicitée sur la période ;
 * - parmi elles, celle qui lui a distribué le plus d'appels sur la période ;
 * - à égalité, l'appartenance la plus récente, puis le plus petit numéro.
 *
 * Mesuré en août 2026 : ~1 % des appels partis concernent une personne dont
 * la première file pèse moins de 80 % — le choix est rare, et il est annoncé
 * (« aussi dans … ») plutôt que caché.
 */
export function choisirEquipePrincipale(
    journal: ReadonlyArray<AppartenanceJournal> | null,
    activite: ReadonlyArray<ActiviteFile>,
): EquipePrincipale | null {
    const activiteParFile = new Map(activite.map((a) => [a.queueNumber, a]));
    type Candidate = { queueNumber: string; queueName: string; calls: number; recence: number };
    const candidates = new Map<string, Candidate>();
    if (journal && journal.length > 0) {
        for (const j of journal) {
            const deja = candidates.get(j.queueNumber);
            const recence = j.lastSeenAt.getTime();
            if (!deja || deja.recence < recence) {
                candidates.set(j.queueNumber, {
                    queueNumber: j.queueNumber,
                    queueName: j.queueName,
                    calls: activiteParFile.get(j.queueNumber)?.calls ?? 0,
                    recence,
                });
            }
        }
    } else {
        for (const a of activite) {
            candidates.set(a.queueNumber, { queueNumber: a.queueNumber, queueName: a.queueName, calls: a.calls, recence: a.lastAt.getTime() });
        }
    }
    if (candidates.size === 0) return null;
    const tries = [...candidates.values()].sort((a, b) =>
        b.calls - a.calls || b.recence - a.recence || a.queueNumber.localeCompare(b.queueNumber));
    const [principale, ...autres] = tries;
    return {
        queueNumber: principale.queueNumber,
        queueName: principale.queueName,
        autres: autres.map((c) => ({ queueNumber: c.queueNumber, queueName: c.queueName })),
    };
}

/** Volume décroissant, puis nom — un ordre stable pour des volumes égaux. */
function parVolume<T extends { calls: number; queueName: string }>(a: T, b: T): number {
    return b.calls - a.calls || a.queueName.localeCompare(b.queueName, "fr");
}

/**
 * Compose les lignes par équipe à partir des sorties brutes.
 *
 * Chaque appel parti tombe dans EXACTEMENT une ligne : la somme des lignes
 * est le total des vignettes Transférés + Débordés. Une file de destination
 * fait une ligne ; une personne à qui l'appel a été PASSÉ — répondu ou non —
 * rejoint son équipe principale (ou « Sans équipe ») ; les numéros externes
 * et les destinations non retrouvées font chacun leur regroupement.
 *
 * Le nombre porté par un visage est celui des appels qui lui sont PARTIS,
 * sans distinguer ceux qu'il a pris : c'est la question à laquelle la carte
 * répond (arbitrage du 8 sept. 2026). Une ligne peut donc porter plus
 * d'appels que la somme de ses visages — les appels débordés vers une file
 * où personne n'a décroché n'ont personne à nommer.
 */
export function composerDestinations(
    exits: readonly OutboundExit[],
    equipePrincipale: (extension: string) => EquipePrincipale | null,
    /**
     * La personne est-elle MEMBRE de cette file, c'est-à-dire sonnée par elle
     * sur la période (décision 1.19) ? Un visage ne s'affiche sous une équipe
     * que s'il lui appartient : quelqu'un à qui la réception passe un appel,
     * ou qui récupère son propre appel en attente, a bien pris l'appel — mais
     * il n'est pas de la maison, et l'y montrer ferait croire le contraire.
     */
    estMembre: (extension: string, queueNumber: string) => boolean,
): OutboundTeam[] {
    type Ligne = Omit<OutboundTeam, "persons"> & { personnes: Map<string, OutboundPerson> };
    const lignes = new Map<string, Ligne>();
    const ligne = (key: string, init: () => Omit<Ligne, "calls" | "overflow" | "directLine" | "personnes">): Ligne => {
        let l = lignes.get(key);
        if (!l) {
            l = { ...init(), calls: 0, overflow: 0, directLine: 0, personnes: new Map() };
            lignes.set(key, l);
        }
        return l;
    };
    const regroupement = (kind: Exclude<OutboundTeamKind, "team">) =>
        ligne(`#${kind}`, () => ({ queueNumber: null, queueName: LIBELLES_REGROUPEMENTS[kind], kind, inScope: true }));
    const visage = (l: Ligne, e: OutboundExit, direct: boolean, alsoIn: string[]) => {
        if (!e.extension) return;
        // Poste + nom d'époque : un poste réattribué sur la période, ce sont
        // deux personnes — deux visages (même clé que le tableau des
        // collaborateurs et que la recherche des profils).
        const name = e.personName || e.extension;
        const cle = `${e.extension}|${name}`;
        const p = l.personnes.get(cle) ?? { extension: e.extension, name, calls: 0, viaDirectLine: 0, alsoIn: [] };
        p.calls += e.calls;
        if (direct) p.viaDirectLine += e.calls;
        for (const a of alsoIn) if (!p.alsoIn.includes(a)) p.alsoIn.push(a);
        l.personnes.set(cle, p);
    };

    for (const e of exits) {
        let l: Ligne;
        let alsoIn: string[] = [];
        let direct = false;
        // Un visage n'est posé que s'il a sa place sur cette ligne.
        let poseVisage = false;
        switch (e.firstHop) {
            case "queue": {
                if (!e.queueNumber) { l = regroupement("unknown"); break; }
                const numero = e.queueNumber;
                l = ligne(numero, () => ({ queueNumber: numero, queueName: e.queueName || numero, kind: "team", inScope: true }));
                poseVisage = !!e.extension && estMembre(e.extension, numero);
                break;
            }
            case "person": {
                if (!e.extension) { l = regroupement("unknown"); break; }
                const ep = equipePrincipale(e.extension);
                direct = true;
                poseVisage = true;
                if (ep) {
                    const numero = ep.queueNumber;
                    l = ligne(numero, () => ({ queueNumber: numero, queueName: ep.queueName, kind: "team", inScope: true }));
                    alsoIn = ep.autres.map((a) => a.queueName);
                } else {
                    l = regroupement("no_team");
                }
                l.directLine += e.calls;
                break;
            }
            case "external":
                l = regroupement("external");
                break;
            default:
                l = regroupement("unknown");
        }
        l.calls += e.calls;
        if (e.outcome === "overflow") l.overflow += e.calls;
        if (poseVisage) visage(l, e, direct, alsoIn);
    }

    return [...lignes.values()]
        .map(({ personnes, ...reste }) => ({
            ...reste,
            persons: [...personnes.values()].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name, "fr")),
        }))
        .sort(parVolume);
}

/**
 * Règle 6 du socle (`outOfScopeFinalStatus`) sur les équipes de destination —
 * le même traitement que les équipes d'origine : nommées (« name »), ou
 * fondues dans UN regroupement anonyme sans visages (« anonymize », « hide »).
 * Les regroupements (sans équipe, externes, inconnus) ne cachent rien.
 */
export function appliquerPerimetreDestinations(
    teams: readonly OutboundTeam[],
    estDansPerimetre: (queueNumber: string) => boolean,
    regle: ClassificationRules["outOfScopeFinalStatus"],
): OutboundTeam[] {
    const resultat: OutboundTeam[] = [];
    let anonyme: OutboundTeam | null = null;
    for (const t of teams) {
        if (t.kind !== "team" || t.queueNumber === null) { resultat.push(t); continue; }
        const inScope = estDansPerimetre(t.queueNumber);
        if (inScope || regle === "name") { resultat.push({ ...t, inScope }); continue; }
        anonyme ??= {
            queueNumber: null, queueName: LIBELLES_REGROUPEMENTS.out_of_scope, kind: "out_of_scope",
            calls: 0, overflow: 0, directLine: 0, persons: [], inScope: false,
        };
        anonyme.calls += t.calls;
        anonyme.overflow += t.overflow;
        anonyme.directLine += t.directLine;
    }
    if (anonyme) resultat.push(anonyme);
    return resultat.sort(parVolume);
}

/**
 * Lien d'un visage vers les journaux : nos appels partis (transférés +
 * débordés, directs compris) pris en charge par cette personne. Le filtre
 * « Traité par » des journaux cherche dans les agents qui ont décroché ;
 * le nom d'époque est plus sûr qu'un numéro de poste (un numéro court
 * apparaîtrait dans d'autres numéros).
 */
export function lienJournauxPersonne(p: {
    queueNumber: string;
    personName: string;
    startDate: string;
    endDate: string;
    origin: CallOrigin;
}): string {
    const params = new URLSearchParams();
    params.set("start", p.startDate);
    params.set("end", p.endDate);
    params.set("queueOutcome", `${p.queueNumber}:${DEPARTED_OUTCOMES.join(",")}:team`);
    params.set("origin", p.origin);
    params.set("handledBy", p.personName);
    return `/admin/logs?${params.toString()}`;
}
