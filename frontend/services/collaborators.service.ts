import { prismaAuth } from "@/lib/prisma-auth";
import type { ServerId } from "@/lib/prisma-cdr";
import { getPresenceMaintenant, getPresenceRecente, PRESENCE_JOURS, type AgregatPresence } from "@/services/presence.service";
import type { PresenceState } from "@/services/domain/presence";
import { DROITS_PAR_DEFAUT, normaliserEmail, separerNom, type RoleCompte } from "@/services/domain/compte-collaborateur";
import { nomAffichable } from "@/services/domain/utilisateurs-tableau";

/**
 * LES COLLABORATEURS, POUR L'ONGLET DU JOURNAL — une ligne par poste du 3CX,
 * telle que le journal des collaborateurs la connaît aujourd'hui, avec ses
 * équipes et l'état de son rapprochement Microsoft 365.
 *
 * C'est la liste des corrections à faire côté 3CX autant qu'une consultation :
 * un e-mail manquant, un domaine périmé, s'y lisent en une colonne.
 */

export interface CollaborateurRow {
    /** Clé de ligne, unique dans l'écran : le poste, ou le compte quand il n'a pas de poste. */
    cle: string;
    /** Un compte de l'application sans poste 3CX rapproché : les colonnes 3CX sont vides. */
    sansPoste: boolean;
    extension: string;
    displayName: string;
    email: string | null;
    /** Partie après le @, pour filtrer : 41 des 72 inconnus portaient un domaine périmé. */
    domaine: string | null;
    jobTitle: string | null;
    matchState: string;
    photoUrl: string | null;
    /** Première apparition de ce poste dans le journal. */
    depuis: string;
    equipes: { queueNumber: string; queueName: string }[];
    /** Présence (échantillonnage XAPI) ; null quand le relevé est éteint pour ce tenant. */
    presence: PresenceCollaborateur | null;
    /** Le compte de l'application rattaché à cet e-mail, s'il existe. */
    compte: CompteCollaborateur | null;
}

export interface CompteCollaborateur {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    authProvider: string;
    lastLoginAt: string | null;
    lastSeenAt: string | null;
    createdAt: string;
    /** Nombre de files dans son périmètre. */
    perimetre: number;
}

/** Le compte tel que la base le livre, pour la ligne de l'écran. */
type CompteBrut = {
    id: string; email: string; firstName: string | null; lastName: string | null; role: string; authProvider: string;
    jobTitle: string | null; lastLoginAt: Date | null; lastSeenAt: Date | null; createdAt: Date; _count: { queuePerimeter: number };
};

function compteDepuis(u: CompteBrut): CompteCollaborateur {
    return {
        id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role, authProvider: u.authProvider,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null, lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(), perimetre: u._count.queuePerimeter,
    };
}

export interface PresenceCollaborateur {
    /** État au dernier relevé (moins de trois minutes) ; null si le relevé date ou ignore ce poste. */
    now: { state: PresenceState; queueLoggedIn: boolean; profileLabel: string | null } | null;
    /** Les PRESENCE_JOURS derniers jours ; null sans aucune heure de bureau observée. */
    recent: AgregatPresence | null;
}

export interface EtatPresence {
    enabled: boolean;
    jours: number;
    /** Instant du dernier relevé encore frais ; null si le relevé est arrêté ou en retard. */
    sampledAt: string | null;
}

export interface ResumeM365 {
    total: number;
    rapproches: number;
    /** Membres d'au moins une équipe : la population qui compte pour les statistiques. */
    enEquipe: number;
    enEquipeRapproches: number;
    nonRapproches: number;
    photos: number;
}

const photoUrl = (serverId: string, graphId: string) =>
    `/api/collaborateurs/photo/${encodeURIComponent(graphId)}?server=${encodeURIComponent(serverId)}`;

const ETATS_NON_RAPPROCHES = ["sans-email", "inconnu-m365", "compte-desactive"];

export async function getCollaborateurs(serverId: ServerId): Promise<{ lignes: CollaborateurRow[]; resume: ResumeM365; presence: EtatPresence; comptes: number }> {
    const [ouvertes, premieres, membres, annuaire, photos, reglages, comptes] = await Promise.all([
        prismaAuth.collaboratorDirectoryInterval.findMany({
            where: { serverId, closedAt: null },
            select: { extension: true, displayName: true, email: true, jobTitle: true, matchState: true },
            orderBy: { displayName: "asc" },
        }),
        prismaAuth.collaboratorDirectoryInterval.groupBy({
            by: ["extension"], where: { serverId }, _min: { firstSeenAt: true },
        }),
        prismaAuth.queueMembershipInterval.findMany({
            where: { serverId, closedAt: null },
            select: { extension: true, queueNumber: true },
        }),
        prismaAuth.queueDirectoryInterval.findMany({
            where: { serverId, closedAt: null },
            select: { queueNumber: true, queueName: true },
        }),
        prismaAuth.collaboratorPhoto.findMany({ where: { serverId }, select: { email: true, graphId: true } }),
        prismaAuth.tenantSettings.findUnique({ where: { serverId }, select: { presenceSamplingEnabled: true } }),
        // Les comptes de l'application, tous tenants : le rattachement se fait
        // par e-mail, comme à la connexion Microsoft.
        prismaAuth.user.findMany({
            select: {
                id: true, email: true, firstName: true, lastName: true, role: true, authProvider: true, jobTitle: true,
                lastLoginAt: true, lastSeenAt: true, createdAt: true, _count: { select: { queuePerimeter: true } },
            },
        }),
    ]);
    const compteDe = new Map(comptes.map((u) => [normaliserEmail(u.email), u]));

    // Présence : parts de temps sur les derniers jours (base) et état au
    // dernier relevé (mémoire de l'échantillonneur, même processus) — rien de
    // tout cela n'est lu quand le tenant n'a pas demandé le relevé.
    const presenceActive = reglages?.presenceSamplingEnabled ?? false;
    const recente = presenceActive ? await getPresenceRecente(serverId) : new Map<string, AgregatPresence>();
    const maintenant = presenceActive ? getPresenceMaintenant(serverId) : null;

    const depuis = new Map(premieres.map((p) => [p.extension, p._min.firstSeenAt]));
    const nomFile = new Map(annuaire.map((q) => [q.queueNumber, q.queueName]));
    const photoDe = new Map(photos.map((p) => [p.email, p.graphId]));
    const equipesDe = new Map<string, { queueNumber: string; queueName: string }[]>();
    for (const m of membres) {
        const liste = equipesDe.get(m.extension) ?? [];
        liste.push({ queueNumber: m.queueNumber, queueName: nomFile.get(m.queueNumber) ?? `File ${m.queueNumber}` });
        equipesDe.set(m.extension, liste);
    }

    const lignes: CollaborateurRow[] = ouvertes.map((c) => ({
        cle: `poste:${c.extension}`,
        sansPoste: false,
        extension: c.extension,
        displayName: c.displayName,
        email: c.email,
        domaine: c.email?.split("@")[1] ?? null,
        jobTitle: c.jobTitle,
        matchState: c.matchState,
        photoUrl: c.email && photoDe.has(c.email) ? photoUrl(serverId, photoDe.get(c.email)!) : null,
        depuis: (depuis.get(c.extension) ?? new Date()).toISOString(),
        equipes: (equipesDe.get(c.extension) ?? []).sort((a, b) => a.queueName.localeCompare(b.queueName, "fr")),
        presence: presenceActive
            ? { now: maintenant?.postes.get(c.extension) ?? null, recent: recente.get(c.extension) ?? null }
            : null,
        compte: (() => {
            const u = c.email ? compteDe.get(normaliserEmail(c.email)) : undefined;
            return u ? compteDepuis(u) : null;
        })(),
    }));

    // Les comptes SANS poste 3CX rapproché — administrateurs que le principal
    // XAPI ne voit plus, e-mail différent entre le 3CX et Microsoft, compte
    // de test : une ligne « compte seul », colonnes 3CX vides. Les voir est
    // déjà une information.
    const rattaches = new Set(lignes.filter((l) => l.compte).map((l) => l.compte!.id));
    const seuls: CollaborateurRow[] = comptes
        .filter((u) => !rattaches.has(u.id))
        .map((u) => ({
            cle: `compte:${u.id}`,
            sansPoste: true,
            extension: "",
            displayName: nomAffichable(u),
            email: u.email,
            domaine: u.email.split("@")[1] ?? null,
            jobTitle: u.jobTitle,
            matchState: "compte-seul",
            photoUrl: photoDe.has(normaliserEmail(u.email)) ? photoUrl(serverId, photoDe.get(normaliserEmail(u.email))!) : null,
            depuis: u.createdAt.toISOString(),
            equipes: [],
            presence: null,
            compte: compteDepuis(u),
        }));

    return {
        lignes: [...lignes, ...seuls],
        resume: resumer(lignes, photos.length),
        presence: { enabled: presenceActive, jours: PRESENCE_JOURS, sampledAt: maintenant?.at.toISOString() ?? null },
        comptes: comptes.length,
    };
}

function resumer(lignes: Pick<CollaborateurRow, "matchState" | "equipes">[], photos: number): ResumeM365 {
    const enEquipe = lignes.filter((l) => l.equipes.length > 0);
    return {
        total: lignes.length,
        rapproches: lignes.filter((l) => l.matchState === "ok").length,
        enEquipe: enEquipe.length,
        enEquipeRapproches: enEquipe.filter((l) => l.matchState === "ok").length,
        nonRapproches: lignes.filter((l) => ETATS_NON_RAPPROCHES.includes(l.matchState)).length,
        photos,
    };
}

export type ResultatPreparation =
    | { ok: true; compte: CompteCollaborateur; email: string; equipes: number; equipesInconnues: string[] }
    | { ok: false; error: string };

/**
 * Crée le compte de l'application d'un collaborateur AVANT sa première
 * connexion : e-mail de l'annuaire, nature choisie, périmètre = ses équipes
 * du journal, droits par défaut (cf. domain/compte-collaborateur). Sans mot
 * de passe : ce compte n'existe que par Microsoft. À la première connexion,
 * lib/auth le retrouve par son e-mail et le complète (identifiant Entra,
 * photo, rôle des groupes de sécurité) sans toucher au périmètre.
 */
export async function preparerCompteCollaborateur(serverId: ServerId, extension: string, role: RoleCompte): Promise<ResultatPreparation> {
    const poste = await prismaAuth.collaboratorDirectoryInterval.findFirst({
        where: { serverId, extension, closedAt: null },
        select: { displayName: true, email: true, jobTitle: true, matchState: true },
    });
    if (!poste) return { ok: false, error: "Ce poste n'est plus dans l'annuaire." };
    if (!poste.email) return { ok: false, error: "Ce poste n'a pas d'e-mail dans le 3CX." };
    if (poste.matchState !== "ok") return { ok: false, error: "Ce poste n'est pas rapproché d'un compte Microsoft 365 actif." };

    const email = normaliserEmail(poste.email);
    const existant = await prismaAuth.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { email: true } });
    if (existant) return { ok: false, error: `Un compte existe déjà pour ${existant.email}.` };

    // Ses équipes : les files qui le sonnent aujourd'hui, d'après le journal.
    const membres = await prismaAuth.queueMembershipInterval.findMany({
        where: { serverId, extension, closedAt: null },
        select: { queueNumber: true },
    });
    const numeros = [...new Set(membres.map((m) => m.queueNumber))];
    const files = numeros.length > 0
        ? await prismaAuth.queueRegistry.findMany({ where: { tenantId: serverId, queueNumber: { in: numeros } }, select: { id: true, queueNumber: true } })
        : [];
    const connues = new Set(files.map((f) => f.queueNumber));
    const { firstName, lastName } = separerNom(poste.displayName);

    // Une seule écriture : le compte, son tenant et son périmètre naissent
    // ensemble ou pas du tout.
    const cree = await prismaAuth.user.create({
        data: {
            email,
            password: "",
            authProvider: "MICROSOFT",
            role,
            firstName,
            lastName,
            jobTitle: poste.jobTitle,
            ...DROITS_PAR_DEFAUT,
            tenantAccess: { create: [{ tenantId: serverId }] },
            queuePerimeter: { create: files.map((f) => ({ queueId: f.id })) },
        },
        select: { id: true, role: true, authProvider: true, lastLoginAt: true },
    });
    return {
        ok: true,
        compte: {
            id: cree.id, email, firstName, lastName, role: cree.role, authProvider: cree.authProvider,
            lastLoginAt: null, lastSeenAt: null, createdAt: new Date().toISOString(), perimetre: files.length,
        },
        email,
        equipes: files.length,
        equipesInconnues: numeros.filter((n) => !connues.has(n)),
    };
}

/** Le résumé seul, pour la ligne d'un relevé — lu en direct, c'est l'état d'aujourd'hui. */
export async function getResumeM365(serverId: ServerId): Promise<ResumeM365> {
    const [ouvertes, membres, photos] = await Promise.all([
        prismaAuth.collaboratorDirectoryInterval.findMany({
            where: { serverId, closedAt: null }, select: { extension: true, matchState: true },
        }),
        prismaAuth.queueMembershipInterval.findMany({
            where: { serverId, closedAt: null }, select: { extension: true }, distinct: ["extension"],
        }),
        prismaAuth.collaboratorPhoto.count({ where: { serverId } }),
    ]);
    const enEquipe = new Set(membres.map((m) => m.extension));
    return resumer(
        ouvertes.map((o) => ({ matchState: o.matchState, equipes: enEquipe.has(o.extension) ? [{ queueNumber: "", queueName: "" }] : [] })),
        photos,
    );
}

/** La fiche d'un collaborateur : ses postes et titres datés, ses équipes datées. */
export async function getFicheCollaborateur(serverId: ServerId, extension: string) {
    const [postes, equipes, annuaire] = await Promise.all([
        prismaAuth.collaboratorDirectoryInterval.findMany({
            where: { serverId, extension },
            orderBy: [{ closedAt: { sort: "asc", nulls: "first" } }, { firstSeenAt: "desc" }],
            select: { displayName: true, email: true, jobTitle: true, matchState: true, firstSeenAt: true, lastSeenAt: true, closedAt: true },
        }),
        prismaAuth.queueMembershipInterval.findMany({
            where: { serverId, extension },
            orderBy: [{ closedAt: { sort: "asc", nulls: "first" } }, { firstSeenAt: "desc" }],
            select: { queueNumber: true, firstSeenAt: true, lastSeenAt: true, closedAt: true },
            take: 200,
        }),
        prismaAuth.queueDirectoryInterval.findMany({
            where: { serverId, closedAt: null }, select: { queueNumber: true, queueName: true },
        }),
    ]);
    const nomFile = new Map(annuaire.map((q) => [q.queueNumber, q.queueName]));
    return {
        postes: postes.map((p) => ({
            ...p, firstSeenAt: p.firstSeenAt.toISOString(), lastSeenAt: p.lastSeenAt.toISOString(), closedAt: p.closedAt?.toISOString() ?? null,
        })),
        equipes: equipes.map((e) => ({
            queueNumber: e.queueNumber, queueName: nomFile.get(e.queueNumber) ?? `File ${e.queueNumber}`,
            firstSeenAt: e.firstSeenAt.toISOString(), lastSeenAt: e.lastSeenAt.toISOString(), closedAt: e.closedAt?.toISOString() ?? null,
        })),
    };
}
