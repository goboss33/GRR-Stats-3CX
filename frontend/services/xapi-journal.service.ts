import { prismaAuth } from "@/lib/prisma-auth";
import { getServerXapiConfig, isXapiUsable } from "@/lib/xapi-config";
import { releveAttendu } from "@/services/domain/journal-cadence";
import { requestXapiToken, decodeTokenClaims } from "@/lib/xapi-client";
import { getAvailableServers } from "@/lib/servers";
import type { ServerId } from "@/lib/prisma-cdr";
import {
    normalizeSnapshot, planJournalChanges, windowReachesCutover,
    normalizeQueueSnapshot, planDirectoryChanges,
    type SnapshotMember, type SnapshotQueue,
} from "@/services/domain/membership-journal";
import { getServerTimezone } from "@/lib/servers";
import type { ClassificationRules, RosterMember } from "@/services/domain/call-classification";
import { invaliderCacheAnnuaire } from "@/services/queue-directory.service";
import { getNonRapproches, runCollaboratorSync } from "@/services/m365-sync.service";

/**
 * JOURNAL DE COMPOSITION DES ÉQUIPES — la couche d'entrée-sortie.
 *
 * Chaque relevé lit la composition réelle des files via la XAPI et la date
 * dans QueueMembershipInterval (voir services/domain/membership-journal pour
 * la logique pure). Le journal n'est encore CONSOMMÉ par aucun écran de
 * statistiques : il accumule, c'est tout — chaque jour sans relevé est de
 * l'histoire perdue, d'où le démarrage avant toute exploitation.
 *
 * Doctrine surcouche : un tenant sans XAPI n'est PAS en erreur, il est
 * simplement hors du jeu — aucun run n'est enregistré pour lui.
 */

const PAGE_LIMIT = 25;
const RUNS_RETENTION_DAYS = 180;

export interface SnapshotSummary {
    ran: boolean;
    ok: boolean;
    reason?: string;
    queues?: number;
    members?: number;
    changes?: number;
    /** Volet Microsoft 365 du relevé ; null = intégration inexploitable cette fois. */
    m365?: { profiles: number; photos: number; unmatched: number; error: string | null } | null;
}

/** Extraction défensive d'un champ texte parmi plusieurs noms candidats. */
function pick(obj: Record<string, unknown> | null | undefined, keys: string[]): string {
    if (!obj) return "";
    for (const key of keys) {
        const value = obj[key];
        if (typeof value === "string" && value.trim()) return value.trim();
        if (typeof value === "number") return String(value);
    }
    return "";
}

/**
 * Lit toutes les files et leurs membres via l'API de configuration (OData).
 * Le parseur est volontairement tolérant sur les noms de champs : la forme
 * exacte varie selon les versions v20 — en cas d'échec total, un extrait des
 * clés reçues est renvoyé pour diagnostiquer depuis l'onglet des réglages.
 */
async function fetchQueueMembers(
    baseUrl: string,
    accessToken: string,
): Promise<{ ok: true; queues: number; members: SnapshotMember[]; annuaire: SnapshotQueue[] } | { ok: false; reason: string }> {
    const members: SnapshotMember[] = [];
    const annuaire: SnapshotQueue[] = [];
    let queues = 0;
    // Plafond OData du PBX : 100 elements par page (verifie sur le 3CX v20
    // reel — au-dela, HTTP 400 « The limit of 100 for Top query has been
    // exceeded ») ; la pagination @odata.nextLink enchaine les pages.
    // Agents ET Groups dans le MÊME appel : le département d'une file est son
    // « groupe » 3CX, et c'est la seule source qui fasse autorité — le nom
    // déduit des CDR est celui du dernier appel, les étiquettes du registre
    // sont figées à la découverte. Vérifié sur le PBX : une file appartient
    // toujours à exactement un groupe.
    let url: string | null = `${baseUrl}/xapi/v1/Queues?%24expand=Agents,Groups&%24top=100`;
    let firstShape = "";

    for (let page = 0; url && page < PAGE_LIMIT; page++) {
        let res: Response;
        try {
            res = await fetch(url, {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(20_000),
                cache: "no-store",
            });
        } catch (error) {
            return { ok: false, reason: `PBX injoignable pendant la lecture des files (${error instanceof Error ? error.message : String(error)})` };
        }
        if (!res.ok) {
            const body = (await res.text().catch(() => "")).trim();
            const authHeader = res.headers.get("www-authenticate");
            const parts = [
                `Lecture des files refusée (HTTP ${res.status})`,
                `corps: ${body ? body.slice(0, 200) : "vide"}`,
            ];
            if (authHeader) parts.push(`www-authenticate: ${authHeader.slice(0, 120)}`);
            // Contre-test : une autre entité répond-elle ? Discrimine « tout
            // est interdit » (rôle du principal insuffisant) d'un blocage
            // propre à l'entité Queues.
            try {
                const users = await fetch(`${baseUrl}/xapi/v1/Users?%24top=1&%24select=Id`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    signal: AbortSignal.timeout(10_000),
                    cache: "no-store",
                });
                parts.push(`contre-test Users: HTTP ${users.status}`);
            } catch {
                parts.push("contre-test Users: injoignable");
            }
            const claims = decodeTokenClaims(accessToken);
            if (claims.role) parts.push(`rôle du jeton: ${claims.role}`);
            if (claims.sub || claims.client_id) parts.push(`principal: ${claims.sub ?? claims.client_id}`);
            return { ok: false, reason: parts.join(" · ") };
        }

        let payload: unknown;
        try {
            payload = await res.json();
        } catch {
            return { ok: false, reason: "Réponse du PBX illisible (JSON attendu)." };
        }

        const list = Array.isArray((payload as { value?: unknown })?.value)
            ? (payload as { value: unknown[] }).value
            : Array.isArray(payload) ? (payload as unknown[]) : [];
        if (!firstShape && list.length > 0) {
            firstShape = Object.keys(list[0] as Record<string, unknown>).join(",").slice(0, 200);
        }

        for (const raw of list) {
            const queue = raw as Record<string, unknown>;
            const queueNumber = pick(queue, ["Number", "number", "Extension"]);
            if (!queueNumber) continue;
            queues++;
            // Annuaire : nom de la file et département, tels que le PBX les
            // déclare à cet instant.
            const groupes = (queue.Groups ?? queue.groups ?? []) as unknown[];
            const premierGroupe = Array.isArray(groupes) && groupes.length > 0
                ? (groupes[0] as Record<string, unknown>)
                : undefined;
            annuaire.push({
                queueNumber,
                queueName: pick(queue, ["Name", "name"]) || pick(premierGroupe, ["MemberName"]) || queueNumber,
                department: pick(premierGroupe, ["Name"]) || null,
            });
            const agents = (queue.Agents ?? queue.agents ?? queue.Users ?? []) as unknown[];
            if (!Array.isArray(agents)) continue;
            for (const rawAgent of agents) {
                const agent = rawAgent as Record<string, unknown>;
                const nested = (agent.User ?? agent.user) as Record<string, unknown> | undefined;
                const extension = pick(agent, ["Number", "number", "Extension", "extension"]) || pick(nested, ["Number", "Extension"]);
                if (!extension) continue;
                const first = pick(agent, ["FirstName"]) || pick(nested, ["FirstName"]);
                const last = pick(agent, ["LastName"]) || pick(nested, ["LastName"]);
                const agentName = pick(agent, ["Name", "DisplayName"]) || pick(nested, ["DisplayName", "Name"])
                    || [first, last].filter(Boolean).join(" ");
                members.push({ queueNumber, extension, agentName });
            }
        }

        const next = (payload as Record<string, unknown>)["@odata.nextLink"];
        url = typeof next === "string" && next
            ? (next.startsWith("http") ? next : `${baseUrl}${next.startsWith("/") ? "" : "/"}${next}`)
            : null;
    }

    if (queues === 0) {
        return { ok: false, reason: `Aucune file lisible dans la réponse du PBX — forme reçue : [${firstShape || "vide"}]` };
    }
    return { ok: true, queues, members, annuaire };
}

/** Un relevé complet pour un tenant : lecture XAPI, plan, application, trace. */
export async function runQueueMembershipSnapshot(serverId: ServerId): Promise<SnapshotSummary> {
    const config = await getServerXapiConfig(serverId);
    if (!isXapiUsable(config)) {
        // Pas de ligne de run : l'absence de surcouche n'est pas un incident.
        return { ran: false, ok: false, reason: "Surcouche XAPI inactive ou incomplète pour ce tenant." };
    }

    const now = new Date();
    const recordFailure = async (reason: string): Promise<SnapshotSummary> => {
        await prismaAuth.xapiSnapshotRun.create({
            data: { serverId, ranAt: now, ok: false, error: reason.slice(0, 500) },
        }).catch(() => undefined);
        return { ran: true, ok: false, reason };
    };

    const token = await requestXapiToken(config.baseUrl!, config.clientId!, config.key!);
    if (!token.ok) return recordFailure(token.reason);

    const fetched = await fetchQueueMembers(config.baseUrl!, token.accessToken);
    if (!fetched.ok) return recordFailure(fetched.reason);

    const snapshot = normalizeSnapshot(fetched.members);
    const open = await prismaAuth.queueMembershipInterval.findMany({
        where: { serverId, closedAt: null },
        select: { id: true, queueNumber: true, extension: true, agentName: true },
    });
    const plan = planJournalChanges(open, snapshot);

    // Annuaire des files : même doctrine, un mouvement se date au lieu de
    // s'écraser. Un renommage ou un changement de département ferme la ligne
    // en cours et en ouvre une nouvelle.
    const relevéFiles = normalizeQueueSnapshot(fetched.annuaire);
    const annuaireOuvert = await prismaAuth.queueDirectoryInterval.findMany({
        where: { serverId, closedAt: null },
        select: { id: true, queueNumber: true, queueName: true, department: true },
    });
    const planAnnuaire = planDirectoryChanges(annuaireOuvert, relevéFiles);

    await prismaAuth.$transaction([
        prismaAuth.queueDirectoryInterval.updateMany({
            where: { id: { in: planAnnuaire.toClose } },
            data: { closedAt: now, lastSeenAt: now },
        }),
        prismaAuth.queueDirectoryInterval.updateMany({
            where: { id: { in: planAnnuaire.toTouch } },
            data: { lastSeenAt: now },
        }),
        prismaAuth.queueDirectoryInterval.createMany({
            data: planAnnuaire.toOpen.map((q) => ({
                serverId, queueNumber: q.queueNumber, queueName: q.queueName,
                department: q.department, firstSeenAt: now, lastSeenAt: now,
            })),
        }),
        prismaAuth.queueMembershipInterval.updateMany({
            where: { id: { in: plan.toClose } },
            data: { closedAt: now, lastSeenAt: now },
        }),
        prismaAuth.queueMembershipInterval.updateMany({
            where: { id: { in: plan.toTouch } },
            data: { lastSeenAt: now },
        }),
        prismaAuth.queueMembershipInterval.createMany({
            data: plan.toOpen.map((m) => ({
                serverId, queueNumber: m.queueNumber, extension: m.extension,
                agentName: m.agentName, firstSeenAt: now, lastSeenAt: now,
            })),
        }),
        prismaAuth.xapiSnapshotRun.create({
            data: {
                serverId, ranAt: now, ok: true,
                queues: fetched.queues, members: snapshot.length,
                changes: plan.toClose.length + plan.toOpen.length,
            },
        }),
        // Ménage : les traces de runs au-delà de la rétention.
        prismaAuth.xapiSnapshotRun.deleteMany({
            where: { serverId, ranAt: { lt: new Date(now.getTime() - RUNS_RETENTION_DAYS * 24 * 3600 * 1000) } },
        }),
    ]);

    // Les libellés servis à l'application viennent de l'annuaire qu'on vient
    // d'écrire : sans cette invalidation, un renommage fait au 3CX attendrait
    // encore la fin du cache pour apparaître à l'écran.
    await invaliderCacheAnnuaire(serverId);

    // Volet Microsoft 365 du MÊME relevé : journal des collaborateurs (postes,
    // noms, e-mails, titres) et photos. Après la transaction des équipes, et
    // jamais bloquant — un échec ici s'inscrit sur la ligne du relevé, il ne
    // l'annule pas. Le jeton XAPI déjà obtenu est réutilisé.
    const m365 = await runCollaboratorSync(serverId, { now, xapiBaseUrl: config.baseUrl!, xapiToken: token.accessToken });
    if (!m365.skipped) {
        await prismaAuth.xapiSnapshotRun.updateMany({
            where: { serverId, ranAt: now },
            data: {
                m365Profiles: m365.profiles, m365Photos: m365.photos,
                m365Unmatched: m365.unmatched, m365Error: m365.error?.slice(0, 500) ?? null,
            },
        }).catch(() => undefined);
    }

    return {
        ran: true, ok: true,
        queues: fetched.queues, members: snapshot.length,
        changes: plan.toClose.length + plan.toOpen.length,
        m365: m365.skipped ? null : { profiles: m365.profiles, photos: m365.photos, unmatched: m365.unmatched, error: m365.error },
    };
}

/** Relevé pour tous les tenants dont la surcouche est exploitable. */
export async function runDueSnapshots(): Promise<void> {
    for (const serverId of getAvailableServers()) {
        try {
            const summary = await runQueueMembershipSnapshot(serverId);
            if (summary.ran) {
                console.log(`[journal-xapi] ${serverId} : ${summary.ok
                    ? `${summary.members} membres sur ${summary.queues} files, ${summary.changes} mouvement(s)`
                    : `ÉCHEC — ${summary.reason}`}`);
            }
        } catch (error) {
            console.error(`[journal-xapi] ${serverId} : erreur inattendue`, error);
        }
    }
}

/** Le relevé quotidien de ce tenant est-il encore à faire ? */
export async function isSnapshotDue(serverId: ServerId, now = new Date()): Promise<boolean> {
    const config = await getServerXapiConfig(serverId);
    if (!isXapiUsable(config)) return false;
    const last = await prismaAuth.xapiSnapshotRun.findFirst({
        where: { serverId, ok: true },
        orderBy: { ranAt: "desc" },
        select: { ranAt: true },
    });
    // Cadence NOCTURNE : le prochain relevé est le premier 3 h qui suit le
    // dernier — et non « dernier + 24 h », qui faisait dériver l'heure.
    return releveAttendu(last?.ranAt ?? null, now);
}

/** Vue d'ensemble pour l'onglet des réglages. */
export async function getJournalOverview(serverId: ServerId) {
    const [runs, openCount, queues] = await Promise.all([
        prismaAuth.xapiSnapshotRun.findMany({
            where: { serverId },
            orderBy: { ranAt: "desc" },
            take: 10,
        }),
        prismaAuth.queueMembershipInterval.count({ where: { serverId, closedAt: null } }),
        // Les appartenances EN COURS, membres compris : le sélecteur de
        // l'onglet cherche aussi par nom de collaborateur, comme la recherche
        // du header. Une file vidée de tous ses membres n'apparaît donc plus
        // ici — c'est l'écart que le nombre d'équipes du relevé (vues au PBX)
        // rend visible.
        prismaAuth.queueMembershipInterval.findMany({
            where: { serverId, closedAt: null },
            select: { queueNumber: true, extension: true, agentName: true, lastSeenAt: true },
            orderBy: [{ queueNumber: "asc" }, { agentName: "asc" }],
        }),
    ]);

    // Nom et département : LA MÊME source que la recherche du header, c'est-à-dire
    // les CDR — nom vu sur l'appel le plus récent, département 3CX du moment.
    //
    // ⚠️ Ne pas revenir aux étiquettes entity/region/service de QueueRegistry.
    // Elles sont analysées UNE SEULE FOIS, au nom qu'avait la file lors de sa
    // découverte, et jamais recalculées (à dessein : un ADMIN peut les avoir
    // corrigées). Sur une file renommée elles décrivent donc un passé disparu —
    // la file 807 affichait « RC · NEUCHATEL » alors qu'elle s'appelle
    // « Gérance NE-G01 + NE-G02 » et que le 3CX la place dans « NEUCHATEL ».
    // Ces étiquettes servent à l'écran d'administration des files (filtrer,
    // attribuer des périmètres en masse), pas à afficher un département.
    const [annuaireXapi] = await Promise.all([
        prismaAuth.queueDirectoryInterval.findMany({
            where: { serverId, closedAt: null },
            select: { queueNumber: true, queueName: true, department: true },
        }),
    ]);
    const ficheDe = new Map(annuaireXapi.map((q) => [q.queueNumber, q]));

    const parFile = new Map<string, typeof queues>();
    for (const ligne of queues) {
        const existant = parFile.get(ligne.queueNumber);
        if (existant) existant.push(ligne);
        else parFile.set(ligne.queueNumber, [ligne]);
    }

    return {
        runs: runs.map((r) => ({
            ranAt: r.ranAt.toISOString(), ok: r.ok,
            queues: r.queues, members: r.members, changes: r.changes, error: r.error,
            // Volet M365 : null quand l'intégration n'était pas exploitable.
            m365Profiles: r.m365Profiles, m365Photos: r.m365Photos,
            m365Unmatched: r.m365Unmatched, m365Error: r.m365Error,
        })),
        openCount,
        queues: [...parFile.entries()].map(([queueNumber, lignes]) => {
            const fiche = ficheDe.get(queueNumber);
            return {
                queueNumber,
                // Tout vient du PBX, rien des CDR ni du registre. Une file
                // encore absente de l'annuaire (journal antérieur au premier
                // relevé qui l'enregistre) garde son numéro pour nom, le
                // temps d'un relevé.
                queueName: fiche?.queueName ?? `File ${queueNumber}`,
                // Département déclaré par le 3CX. Une file sans département
                // rejoint le groupe « Sans département » du sélecteur.
                queueDepartment: fiche?.department ?? null,
                members: lignes.length,
                membres: lignes.map((l) => ({
                    extension: l.extension,
                    name: l.agentName,
                    lastSeenAt: l.lastSeenAt.toISOString(),
                })),
            };
        }),
    };
}

/** Le journal d'une file : intervalles en cours puis fermés, du plus récent au plus ancien. */
export async function getQueueJournal(serverId: ServerId, queueNumber: string) {
    const intervals = await prismaAuth.queueMembershipInterval.findMany({
        where: { serverId, queueNumber },
        orderBy: [{ closedAt: { sort: "asc", nulls: "first" } }, { firstSeenAt: "desc" }],
        take: 300,
    });
    return intervals.map((i) => ({
        extension: i.extension, agentName: i.agentName,
        firstSeenAt: i.firstSeenAt.toISOString(),
        lastSeenAt: i.lastSeenAt.toISOString(),
        closedAt: i.closedAt?.toISOString() ?? null,
    }));
}

/** Nombre de lignes de détail au-delà duquel on résume plutôt qu'on déroule. */
const DETAIL_MAX = 120;

/**
 * Le DÉTAIL d'un relevé : qui est arrivé, qui est parti, quel poste a changé
 * de titulaire, quelle file a changé de nom ou de département.
 *
 * Rien n'est stocké en plus : le relevé horodate ses écritures avec l'instant
 * du run (`ranAt`), donc les lignes ouvertes ou fermées à cet instant SONT
 * ses mouvements. Le journal se relit lui-même.
 *
 * Une fermeture et une ouverture sur le MÊME couple (file, poste) ne font pas
 * deux mouvements mais un seul : une passation. On les apparie ici, sans quoi
 * un changement de titulaire se lirait comme un départ suivi d'une embauche.
 */
export async function getRunDetail(serverId: ServerId, ranAt: Date) {
    const [fermees, ouvertes, filesFermees, filesOuvertes] = await Promise.all([
        prismaAuth.queueMembershipInterval.findMany({
            where: { serverId, closedAt: ranAt },
            select: { queueNumber: true, extension: true, agentName: true },
        }),
        prismaAuth.queueMembershipInterval.findMany({
            where: { serverId, firstSeenAt: ranAt },
            select: { queueNumber: true, extension: true, agentName: true },
        }),
        prismaAuth.queueDirectoryInterval.findMany({
            where: { serverId, closedAt: ranAt },
            select: { queueNumber: true, queueName: true, department: true },
        }),
        prismaAuth.queueDirectoryInterval.findMany({
            where: { serverId, firstSeenAt: ranAt },
            select: { queueNumber: true, queueName: true, department: true },
        }),
    ]);

    // Noms d'équipe pour l'affichage : l'annuaire en cours, à défaut le numéro.
    const annuaire = await prismaAuth.queueDirectoryInterval.findMany({
        where: { serverId, closedAt: null },
        select: { queueNumber: true, queueName: true },
    });
    const nomFile = new Map(annuaire.map((q) => [q.queueNumber, q.queueName]));
    const libelle = (n: string) => nomFile.get(n) ?? `File ${n}`;

    // Appariement des passations sur la clé (file, poste).
    const cle = (m: { queueNumber: string; extension: string }) => `${m.queueNumber}|${m.extension}`;
    const partants = new Map(fermees.map((m) => [cle(m), m]));
    const passations: { queueNumber: string; queueName: string; extension: string; avant: string; apres: string }[] = [];
    const arrivees: { queueNumber: string; queueName: string; extension: string; agentName: string }[] = [];

    for (const m of ouvertes) {
        const partant = partants.get(cle(m));
        if (partant) {
            partants.delete(cle(m));
            passations.push({
                queueNumber: m.queueNumber, queueName: libelle(m.queueNumber),
                extension: m.extension, avant: partant.agentName, apres: m.agentName,
            });
        } else {
            arrivees.push({
                queueNumber: m.queueNumber, queueName: libelle(m.queueNumber),
                extension: m.extension, agentName: m.agentName,
            });
        }
    }
    const departs = [...partants.values()].map((m) => ({
        queueNumber: m.queueNumber, queueName: libelle(m.queueNumber),
        extension: m.extension, agentName: m.agentName,
    }));

    // Mouvements d'annuaire : même appariement, sur le numéro de file.
    const avantParFile = new Map(filesFermees.map((q) => [q.queueNumber, q]));
    const files = filesOuvertes.map((apres) => {
        const avant = avantParFile.get(apres.queueNumber);
        avantParFile.delete(apres.queueNumber);
        return {
            queueNumber: apres.queueNumber,
            nomAvant: avant?.queueName ?? null,
            nomApres: apres.queueName,
            departementAvant: avant?.department ?? null,
            departementApres: apres.department,
            nouvelle: !avant,
        };
    });
    // Files disparues du PBX : fermées sans réouverture.
    for (const avant of avantParFile.values()) {
        files.push({
            queueNumber: avant.queueNumber,
            nomAvant: avant.queueName, nomApres: null as unknown as string,
            departementAvant: avant.department, departementApres: null,
            nouvelle: false,
        });
    }

    const parNom = (a: { queueName: string }, b: { queueName: string }) => a.queueName.localeCompare(b.queueName, "fr");
    const total = arrivees.length + departs.length + passations.length + files.length;
    // Volet M365 : l'état D'AUJOURD'HUI des collaborateurs non rapprochés —
    // c'est ce sur quoi on peut agir (un e-mail à corriger au 3CX), pas une
    // archive du relevé.
    const nonRapproches = await getNonRapproches(serverId, DETAIL_MAX);
    return {
        nonRapproches,
        arrivees: arrivees.sort(parNom).slice(0, DETAIL_MAX),
        departs: departs.sort(parNom).slice(0, DETAIL_MAX),
        passations: passations.sort(parNom).slice(0, DETAIL_MAX),
        files: files.sort((a, b) => a.queueNumber.localeCompare(b.queueNumber, "fr")).slice(0, DETAIL_MAX),
        total,
        // Le tout premier relevé ouvre TOUTE la composition : des centaines de
        // lignes qui n'apprennent rien. On dit ce qu'on n'a pas déroulé.
        tronque: Math.max(arrivees.length, departs.length, passations.length, files.length) > DETAIL_MAX,
    };
}

/**
 * ROSTER FERMÉ pour le socle de classement (règle rosterSource=journalAuto).
 *
 * Renvoie la composition de l'équipe selon le journal si — et seulement si —
 * la fenêtre est entièrement postérieure au premier mois calendaire complet
 * couvert (fuseau du tenant). Sinon null : le socle retombe sur le roster
 * déduit de l'activité, comme depuis toujours. Un tenant sans journal (pas de
 * relevé réussi) renvoie donc null pour toute fenêtre — edifea ne change pas.
 *
 * Le nom renvoyé est celui du dernier intervalle chevauchant la fenêtre : un
 * simple SECOURS d'affichage — les noms d'époque des statistiques restent
 * portés par les segments CDR.
 */
export async function resolveJournalRoster(
    serverId: ServerId,
    queueNumber: string,
    start: Date,
    end: Date,
): Promise<RosterMember[] | null> {
    // Doctrine surcouche : le journal INDISPONIBLE (base auth en panne,
    // table absente…) n'est pas une erreur des statistiques — on retombe sur
    // le roster déduit de l'activité, comme un tenant sans XAPI. Vérifié le
    // 25.08 : sans ce filet, une panne de la base auth cassait les écrans de
    // stats qui ne dépendaient jusqu'ici que de la base CDR.
    try {
        return await resolveJournalRosterUnsafe(serverId, queueNumber, start, end);
    } catch (error) {
        console.error("[journal-xapi] roster indisponible, repli sur l'activité :", error instanceof Error ? error.message : error);
        return null;
    }
}

async function resolveJournalRosterUnsafe(
    serverId: ServerId,
    queueNumber: string,
    start: Date,
    end: Date,
): Promise<RosterMember[] | null> {
    const firstOk = await prismaAuth.xapiSnapshotRun.findFirst({
        where: { serverId, ok: true },
        orderBy: { ranAt: "asc" },
        select: { ranAt: true },
    });
    if (!firstOk) return null;
    const timezone = await getServerTimezone(serverId);
    if (!windowReachesCutover(start, firstOk.ranAt, timezone)) return null;

    const intervals = await prismaAuth.queueMembershipInterval.findMany({
        where: {
            serverId, queueNumber,
            firstSeenAt: { lte: end },
            OR: [{ closedAt: null }, { closedAt: { gte: start } }],
        },
        orderBy: { lastSeenAt: "desc" },
        select: { extension: true, agentName: true },
    });
    const byExtension = new Map<string, RosterMember>();
    for (const interval of intervals) {
        if (!byExtension.has(interval.extension)) {
            byExtension.set(interval.extension, { extension: interval.extension, name: interval.agentName });
        }
    }
    return [...byExtension.values()];
}

/** Raccourci : applique la règle avant de résoudre. */
export async function resolveRosterForRules(
    rules: Pick<ClassificationRules, "rosterSource">,
    serverId: ServerId,
    queueNumber: string,
    start: Date,
    end: Date,
): Promise<RosterMember[] | null> {
    if (rules.rosterSource !== "journalAuto") return null;
    return resolveJournalRoster(serverId, queueNumber, start, end);
}
