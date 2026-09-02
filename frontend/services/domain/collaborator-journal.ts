/**
 * JOURNAL DES COLLABORATEURS — la partie pure : rapprochement et plan.
 *
 * Deux sources se rencontrent ici, et une seule clé les relie :
 *
 *   3CX (XAPI `Users`)   →  poste, nom affiché, e-mail
 *   Microsoft Graph      →  e-mail, titre de poste, photo
 *
 * La clé est l'E-MAIL, et rien d'autre. Le rapprochement par le nom est
 * proscrit (directive gbossens, 2 septembre 2026) : « Nom, Prénom » d'un côté,
 * « Prénom Nom » de l'autre, homonymes, accents, noms d'épouse — trop de
 * façons de coller le visage du mauvais Dupont sur des chiffres.
 *
 * Même doctrine de journal que pour les files et les équipes : un changement
 * FERME la ligne en cours et en OUVRE une nouvelle, datée. On ne réécrit
 * jamais le passé — c'est ce qui permet, en consultant juin, de retrouver qui
 * tenait le poste 139 en juin et sous quel titre.
 */

export type MatchState = "ok" | "sans-email" | "inconnu-m365" | "compte-desactive" | "m365-inactif";

/** Un utilisateur tel que le 3CX le déclare. */
export interface XapiUserLike {
    Number?: unknown;
    DisplayName?: unknown;
    FirstName?: unknown;
    LastName?: unknown;
    EmailAddress?: unknown;
}

/** Un utilisateur tel que Graph le déclare (champs utiles seulement). */
export interface GraphUserLike {
    id: string;
    mail: string | null;
    userPrincipalName: string | null;
    jobTitle: string | null;
    accountEnabled: boolean;
}

export interface SnapshotCollaborator {
    extension: string;
    displayName: string;
    email: string | null;
    jobTitle: string | null;
    graphId: string | null;
    matchState: MatchState;
}

/** Ligne ouverte du journal, telle que lue en base. */
export interface OpenCollaboratorRow {
    id: string;
    extension: string;
    displayName: string;
    email: string | null;
    jobTitle: string | null;
    graphId: string | null;
    matchState: string;
}

export interface CollaboratorPlan {
    toClose: string[];
    toTouch: string[];
    toOpen: SnapshotCollaborator[];
}

const texte = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

/** E-mail normalisé pour la jointure : minuscules, sans espaces ; null si ce n'en est pas un. */
export function normaliserEmail(raw: unknown): string | null {
    const v = texte(raw).toLowerCase();
    return v.includes("@") ? v : null;
}

/**
 * Index des utilisateurs Graph par e-mail ET par nom d'utilisateur principal :
 * les deux valent comme adresse, et il arrive qu'ils diffèrent (alias, nom
 * d'épouse conservé dans l'un mais pas l'autre).
 */
export function indexerGraph(users: GraphUserLike[]): Map<string, GraphUserLike> {
    const index = new Map<string, GraphUserLike>();
    for (const u of users) {
        for (const cle of [normaliserEmail(u.mail), normaliserEmail(u.userPrincipalName)]) {
            if (cle && !index.has(cle)) index.set(cle, u);
        }
    }
    return index;
}

/**
 * Construit le relevé des collaborateurs à partir des utilisateurs 3CX, en
 * les rapprochant de Graph quand c'est possible.
 *
 * `graph` à null = intégration M365 éteinte ou injoignable cette nuit-là :
 * le journal s'écrit quand même (poste, nom, e-mail), sans titre, et l'état
 * le dit. Ne pas confondre avec une Map vide, qui voudrait dire « Microsoft
 * ne connaît personne ».
 */
export function normalizeCollaborators(
    users: XapiUserLike[],
    graph: Map<string, GraphUserLike> | null,
): SnapshotCollaborator[] {
    const parPoste = new Map<string, SnapshotCollaborator>();
    for (const u of users) {
        const extension = texte(u.Number);
        if (!extension) continue;
        const displayName = texte(u.DisplayName) || [texte(u.LastName), texte(u.FirstName)].filter(Boolean).join(", ") || extension;
        const email = normaliserEmail(u.EmailAddress);

        let jobTitle: string | null = null;
        let graphId: string | null = null;
        let matchState: MatchState;
        if (!email) matchState = "sans-email";
        else if (!graph) matchState = "m365-inactif";
        else {
            const g = graph.get(email);
            if (!g) matchState = "inconnu-m365";
            else {
                graphId = g.id;
                jobTitle = texte(g.jobTitle) || null;
                matchState = g.accountEnabled ? "ok" : "compte-desactive";
            }
        }
        // Un même poste ne vaut qu'une ligne : le PBX ne devrait pas en
        // renvoyer deux, mais un doublon ne doit pas produire deux lignes.
        if (!parPoste.has(extension)) parPoste.set(extension, { extension, displayName, email, jobTitle, graphId, matchState });
    }
    return [...parPoste.values()];
}

/** Deux lignes disent-elles la même chose ? (Tout ce qui est daté compte.) */
function memeContenu(a: OpenCollaboratorRow, b: SnapshotCollaborator): boolean {
    return a.displayName === b.displayName
        && a.email === b.email
        && a.jobTitle === b.jobTitle
        && a.graphId === b.graphId
        && a.matchState === b.matchState;
}

/**
 * Le plan : quoi fermer, quoi toucher, quoi ouvrir.
 *
 * Un poste disparu du PBX ferme sa ligne. Un poste dont le nom, l'e-mail, le
 * titre ou le rapprochement a changé ferme et rouvre — c'est un mouvement
 * daté. Le reste est simplement revu (lastSeenAt).
 */
export function planCollaboratorChanges(open: OpenCollaboratorRow[], snapshot: SnapshotCollaborator[]): CollaboratorPlan {
    const parPoste = new Map(snapshot.map((c) => [c.extension, c]));
    const plan: CollaboratorPlan = { toClose: [], toTouch: [], toOpen: [] };
    const vus = new Set<string>();

    for (const ligne of open) {
        const actuel = parPoste.get(ligne.extension);
        if (!actuel) {
            plan.toClose.push(ligne.id);
            continue;
        }
        vus.add(ligne.extension);
        if (memeContenu(ligne, actuel)) plan.toTouch.push(ligne.id);
        else {
            plan.toClose.push(ligne.id);
            plan.toOpen.push(actuel);
        }
    }
    for (const [extension, c] of parPoste) {
        if (!vus.has(extension)) plan.toOpen.push(c);
    }
    return plan;
}

/**
 * Les personnes dont on DOIT détenir une photo : rapprochées ET actives.
 * Tout e-mail hors de cet ensemble voit sa photo purgée — la photo d'un
 * collaborateur parti n'a pas à survivre dans nos tables.
 */
export function emailsAvecPhotoAttendue(snapshot: SnapshotCollaborator[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const c of snapshot) {
        if (c.matchState === "ok" && c.email && c.graphId) out.set(c.email, c.graphId);
    }
    return out;
}
