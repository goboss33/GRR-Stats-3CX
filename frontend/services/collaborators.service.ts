import { prismaAuth } from "@/lib/prisma-auth";
import type { ServerId } from "@/lib/prisma-cdr";

/**
 * LES COLLABORATEURS, POUR L'ONGLET DU JOURNAL — une ligne par poste du 3CX,
 * telle que le journal des collaborateurs la connaît aujourd'hui, avec ses
 * équipes et l'état de son rapprochement Microsoft 365.
 *
 * C'est la liste des corrections à faire côté 3CX autant qu'une consultation :
 * un e-mail manquant, un domaine périmé, s'y lisent en une colonne.
 */

export interface CollaborateurRow {
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

export async function getCollaborateurs(serverId: ServerId): Promise<{ lignes: CollaborateurRow[]; resume: ResumeM365 }> {
    const [ouvertes, premieres, membres, annuaire, photos] = await Promise.all([
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
    ]);

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
        extension: c.extension,
        displayName: c.displayName,
        email: c.email,
        domaine: c.email?.split("@")[1] ?? null,
        jobTitle: c.jobTitle,
        matchState: c.matchState,
        photoUrl: c.email && photoDe.has(c.email) ? photoUrl(serverId, photoDe.get(c.email)!) : null,
        depuis: (depuis.get(c.extension) ?? new Date()).toISOString(),
        equipes: (equipesDe.get(c.extension) ?? []).sort((a, b) => a.queueName.localeCompare(b.queueName, "fr")),
    }));

    return { lignes, resume: resumer(lignes, photos.length) };
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
