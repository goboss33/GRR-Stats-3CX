import { prismaAuth } from "@/lib/prisma-auth";
import type { ServerId } from "@/lib/prisma-cdr";
import { getServerM365Config, isM365Usable } from "@/lib/m365-config";
import { requestGraphToken } from "@/lib/graph-client";
import {
    emailsAvecPhotoAttendue,
    indexerGraph,
    normalizeCollaborators,
    planCollaboratorChanges,
    type GraphUserLike,
    type SnapshotCollaborator,
    type XapiUserLike,
} from "@/services/domain/collaborator-journal";

/**
 * VOLET MICROSOFT 365 DU RELEVÉ NOCTURNE — journal des collaborateurs et photos.
 *
 * S'enchaîne au relevé XAPI des équipes, dans le même passage : les
 * utilisateurs du 3CX (poste, nom, e-mail) forment le journal des
 * collaborateurs ; quand l'intégration M365 est active, Graph y ajoute le
 * titre de poste et fournit les photos, rapprochées par E-MAIL uniquement
 * (cf. services/domain/collaborator-journal).
 *
 * Trois règles de prudence, dans l'ordre où elles comptent :
 *
 *   1. Un échec ici n'est JAMAIS un échec du relevé des équipes : tout est
 *      rendu en valeur, rien ne remonte en exception.
 *   2. Une liste d'utilisateurs 3CX vide est traitée comme une ERREUR, pas
 *      comme « plus personne » : sinon un hoquet du PBX fermerait toutes les
 *      lignes du journal d'un coup.
 *   3. Les photos ne survivent pas au départ : tout e-mail qui n'est plus
 *      rapproché et actif perd sa photo dans la même nuit.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";
const TIMEOUT_MS = 20_000;
/** Pages OData du PBX : 100 au plus, et `Users` ne renvoie PAS de nextLink — on avance par $skip. */
const PAGE_PBX = 100;
const PAGES_MAX = 50;
/** Photos lues en parallèle : assez pour tenir en une minute, trop peu pour agacer Graph. */
const PHOTOS_EN_PARALLELE = 4;

export interface M365SyncResult {
    /** true = intégration M365 inexploitable cette nuit : les compteurs du run restent null. */
    skipped: boolean;
    profiles: number;
    photos: number;
    unmatched: number;
    error: string | null;
    /** Le journal des collaborateurs a-t-il été écrit (même sans M365) ? */
    journal: { toClose: number; toOpen: number; toTouch: number } | null;
}

interface Contexte {
    now: Date;
    xapiBaseUrl: string;
    xapiToken: string;
}

const RIEN: M365SyncResult = { skipped: true, profiles: 0, photos: 0, unmatched: 0, error: null, journal: null };

/** Tous les utilisateurs du PBX, par pages de 100 via $skip. */
async function fetchXapiUsers(baseUrl: string, token: string): Promise<{ ok: true; users: XapiUserLike[] } | { ok: false; reason: string }> {
    const users: XapiUserLike[] = [];
    for (let page = 0; page < PAGES_MAX; page++) {
        const url = `${baseUrl}/xapi/v1/Users?%24top=${PAGE_PBX}&%24skip=${page * PAGE_PBX}&%24select=Number,DisplayName,FirstName,LastName,EmailAddress`;
        let res: Response;
        try {
            res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
        } catch (error) {
            return { ok: false, reason: `PBX injoignable pendant la lecture des utilisateurs (${error instanceof Error ? error.message : String(error)})` };
        }
        if (!res.ok) return { ok: false, reason: `Lecture des utilisateurs 3CX refusée (HTTP ${res.status})` };
        const body = (await res.json().catch(() => null)) as { value?: unknown } | null;
        const lot = Array.isArray(body?.value) ? (body!.value as XapiUserLike[]) : [];
        users.push(...lot);
        if (lot.length < PAGE_PBX) break;
    }
    return { ok: true, users };
}

/** Tous les utilisateurs Graph, champs utiles seulement, en suivant @odata.nextLink. */
async function fetchGraphUsers(token: string): Promise<{ ok: true; users: GraphUserLike[] } | { ok: false; reason: string }> {
    const users: GraphUserLike[] = [];
    let url: string | null = `${GRAPH}/users?$select=id,mail,userPrincipalName,jobTitle,accountEnabled&$top=999`;
    for (let page = 0; url && page < PAGES_MAX; page++) {
        let res: Response;
        try {
            res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
        } catch (error) {
            return { ok: false, reason: `Graph injoignable (${error instanceof Error ? error.message : String(error)})` };
        }
        if (res.status === 403) return { ok: false, reason: "Lecture des utilisateurs refusée par Graph (403) : User.Read.All manque ou n'est pas consentie" };
        if (!res.ok) return { ok: false, reason: `Lecture des utilisateurs Graph : HTTP ${res.status}` };
        const body = (await res.json().catch(() => null)) as { value?: Record<string, unknown>[]; "@odata.nextLink"?: string } | null;
        for (const u of body?.value ?? []) {
            if (typeof u.id !== "string") continue;
            users.push({
                id: u.id,
                mail: typeof u.mail === "string" ? u.mail : null,
                userPrincipalName: typeof u.userPrincipalName === "string" ? u.userPrincipalName : null,
                jobTitle: typeof u.jobTitle === "string" ? u.jobTitle : null,
                accountEnabled: u.accountEnabled !== false,
            });
        }
        url = body?.["@odata.nextLink"] ?? null;
    }
    return { ok: true, users };
}

/**
 * Met les photos au niveau de l'attendu : télécharge ce qui manque ou a
 * changé (ETag), supprime ce qui n'a plus lieu d'être. Rend le nombre de
 * photos détenues à la fin, et la première erreur bloquante rencontrée.
 */
async function synchroniserPhotos(
    serverId: ServerId,
    token: string,
    attendues: Map<string, string>,
    now: Date,
): Promise<{ photos: number; error: string | null }> {
    const existantes = await prismaAuth.collaboratorPhoto.findMany({
        where: { serverId },
        select: { email: true, etag: true },
    });
    const etagDe = new Map(existantes.map((p) => [p.email, p.etag]));

    // Purge d'abord : la photo d'une personne partie ne passe pas une nuit de plus.
    const aPurger = existantes.map((p) => p.email).filter((e) => !attendues.has(e));
    if (aPurger.length > 0) {
        await prismaAuth.collaboratorPhoto.deleteMany({ where: { serverId, email: { in: aPurger } } });
    }

    let error: string | null = null;
    const file = [...attendues.entries()];
    let index = 0;
    const travailleur = async () => {
        while (index < file.length && !error) {
            const [email, graphId] = file[index++];
            const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
            const etag = etagDe.get(email);
            if (etag) headers["If-None-Match"] = etag;
            let res: Response;
            try {
                res = await fetch(`${GRAPH}/users/${encodeURIComponent(graphId)}/photos/96x96/$value`, {
                    headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store",
                });
            } catch {
                continue; // une photo manquée ce soir n'est pas une erreur de l'ensemble
            }
            if (res.status === 304) {
                await prismaAuth.collaboratorPhoto.updateMany({ where: { serverId, email }, data: { fetchedAt: now } });
            } else if (res.status === 404) {
                // Plus de photo côté Microsoft : on n'en garde pas une périmée.
                if (etagDe.has(email)) await prismaAuth.collaboratorPhoto.deleteMany({ where: { serverId, email } });
            } else if (res.status === 403) {
                error = "Lecture des photos refusée par Graph (403) : ProfilePhoto.Read.All manque ou n'est pas consentie";
            } else if (res.ok) {
                const data = Buffer.from(await res.arrayBuffer());
                const contentType = res.headers.get("content-type") ?? "image/jpeg";
                const nouvelEtag = res.headers.get("etag");
                await prismaAuth.collaboratorPhoto.upsert({
                    where: { serverId_email: { serverId, email } },
                    update: { graphId, contentType, data, etag: nouvelEtag, fetchedAt: now },
                    create: { serverId, email, graphId, contentType, data, etag: nouvelEtag, fetchedAt: now },
                });
            }
        }
    };
    await Promise.all(Array.from({ length: PHOTOS_EN_PARALLELE }, travailleur));

    const photos = await prismaAuth.collaboratorPhoto.count({ where: { serverId } });
    return { photos, error };
}

/** Écrit le journal des collaborateurs selon le plan, à l'instant du relevé. */
async function appliquerJournal(serverId: ServerId, snapshot: SnapshotCollaborator[], now: Date) {
    const ouvertes = await prismaAuth.collaboratorDirectoryInterval.findMany({
        where: { serverId, closedAt: null },
        select: { id: true, extension: true, displayName: true, email: true, jobTitle: true, graphId: true, matchState: true },
    });
    const plan = planCollaboratorChanges(ouvertes, snapshot);
    await prismaAuth.$transaction([
        prismaAuth.collaboratorDirectoryInterval.updateMany({
            where: { id: { in: plan.toClose } },
            data: { closedAt: now, lastSeenAt: now },
        }),
        prismaAuth.collaboratorDirectoryInterval.updateMany({
            where: { id: { in: plan.toTouch } },
            data: { lastSeenAt: now },
        }),
        prismaAuth.collaboratorDirectoryInterval.createMany({
            data: plan.toOpen.map((c) => ({
                serverId, extension: c.extension, displayName: c.displayName, email: c.email,
                jobTitle: c.jobTitle, graphId: c.graphId, matchState: c.matchState,
                firstSeenAt: now, lastSeenAt: now,
            })),
        }),
    ]);
    return { toClose: plan.toClose.length, toOpen: plan.toOpen.length, toTouch: plan.toTouch.length };
}

/**
 * Le volet M365 d'un relevé. Ne lève jamais : tout échec est une valeur.
 */
export async function runCollaboratorSync(serverId: ServerId, ctx: Contexte): Promise<M365SyncResult> {
    try {
        const pbx = await fetchXapiUsers(ctx.xapiBaseUrl, ctx.xapiToken);
        if (!pbx.ok) return { ...RIEN, skipped: false, error: pbx.reason };
        if (pbx.users.length === 0) return { ...RIEN, skipped: false, error: "Le PBX n'a renvoyé aucun utilisateur : journal des collaborateurs laissé tel quel" };

        const config = await getServerM365Config(serverId);
        let graph: Map<string, GraphUserLike> | null = null;
        let error: string | null = null;
        let tokenGraph: string | null = null;

        if (isM365Usable(config)) {
            const jeton = await requestGraphToken(config.tenantId!, config.clientId!, config.secret!);
            if (!jeton.ok) error = jeton.reason;
            else {
                tokenGraph = jeton.accessToken;
                const lus = await fetchGraphUsers(jeton.accessToken);
                if (lus.ok) graph = indexerGraph(lus.users);
                else error = lus.reason;
            }
        }

        // Le journal s'écrit dans tous les cas : sans M365, il dit « m365-inactif ».
        const snapshot = normalizeCollaborators(pbx.users, graph);
        const journal = await appliquerJournal(serverId, snapshot, ctx.now);

        if (!isM365Usable(config)) return { ...RIEN, journal };
        if (!graph || !tokenGraph) return { skipped: false, profiles: 0, photos: 0, unmatched: 0, error, journal };

        const attendues = emailsAvecPhotoAttendue(snapshot);
        const photos = await synchroniserPhotos(serverId, tokenGraph, attendues, ctx.now);
        return {
            skipped: false,
            profiles: snapshot.filter((c) => c.matchState === "ok").length,
            photos: photos.photos,
            unmatched: snapshot.filter((c) => c.matchState === "sans-email" || c.matchState === "inconnu-m365" || c.matchState === "compte-desactive").length,
            error: photos.error,
            journal,
        };
    } catch (e) {
        return { ...RIEN, skipped: false, error: `Erreur inattendue du volet M365 (${e instanceof Error ? e.message : String(e)})` };
    }
}

/** Libellés lisibles des états de rapprochement, pour l'écran. */
export const LIBELLES_ETAT: Record<string, string> = {
    "sans-email": "sans e-mail au 3CX",
    "inconnu-m365": "e-mail inconnu de Microsoft 365",
    "compte-desactive": "compte Microsoft 365 désactivé",
};

/**
 * Les collaborateurs EN POSTE que Microsoft 365 ne couvre pas, pour le détail
 * d'un relevé. Lu en direct dans le journal (lignes ouvertes) : c'est l'état
 * d'aujourd'hui, celui sur lequel on peut agir — corriger un e-mail au 3CX.
 */
export async function getNonRapproches(serverId: ServerId, limite = 120) {
    const lignes = await prismaAuth.collaboratorDirectoryInterval.findMany({
        where: { serverId, closedAt: null, matchState: { in: ["sans-email", "inconnu-m365", "compte-desactive"] } },
        select: { extension: true, displayName: true, email: true, matchState: true },
        orderBy: [{ matchState: "asc" }, { displayName: "asc" }],
    });
    return {
        total: lignes.length,
        lignes: lignes.slice(0, limite).map((l) => ({
            extension: l.extension, displayName: l.displayName, email: l.email,
            etat: l.matchState, libelle: LIBELLES_ETAT[l.matchState] ?? l.matchState,
        })),
    };
}
