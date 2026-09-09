import { prismaAuth } from "@/lib/prisma-auth";
import type { ServerId } from "@/lib/prisma-cdr";
import { getServerTimezone } from "@/lib/servers";
import { getServerXapiConfig, isXapiUsable, type XapiConfig } from "@/lib/xapi-config";
import { forgetXapiToken, normalizeXapiBaseUrl, requestXapiToken } from "@/lib/xapi-client";
import {
    etatDe,
    instantLocal,
    jourLocal,
    jourSuivant,
    plagesDeBureau,
    secondesDe,
    ventiler,
    type FerieXapi,
    type HoraireXapi,
    type PresenceState,
    type SourceHoraires,
} from "@/services/domain/presence";

/**
 * PRÉSENCE — l'échantillonneur XAPI et sa consolidation (septembre 2026).
 *
 * Chaque minute, pour chaque tenant qui l'a demandé (TenantSettings.
 * presenceSamplingEnabled, ET surcouche XAPI utilisable), UNE lecture de
 * l'entité Users : profil, connexion aux files, téléphone enregistré. On
 * n'écrit que les CHANGEMENTS (PresenceInterval) — quelques lignes par
 * personne et par jour. Toutes les quinze minutes, les intervalles sont
 * ventilés par jour sur les heures de bureau du département (PresenceDay),
 * y compris le jour en cours, refait à chaque passage.
 *
 * Doctrine de la surcouche : lecture seule, jamais une erreur des
 * statistiques — un PBX injoignable se note dans PresenceSampler et se
 * réessaie à la minute suivante. Une coupure d'échantillonnage n'est pas de
 * l'absence : le dénominateur est le temps effectivement observé.
 */

const PAGE_LIMIT = 20;
/** Au-delà, l'état « maintenant » n'est plus montré (relevé arrêté ?). */
const FRAICHEUR_MS = 3 * 60_000;
const CONSOLIDATION_EVERY_MS = 15 * 60_000;
/** Rattrapage maximal de la consolidation, en jours (une longue panne ne bloque pas le tour). */
const CONSOLIDATION_MAX_JOURS = 45;
/** Fenêtre de l'annuaire des collaborateurs, aujourd'hui compris. */
export const PRESENCE_JOURS = 30;

interface UserXapi {
    Number?: string;
    CurrentProfileName?: string;
    QueueStatus?: string;
    IsRegistered?: boolean;
    Enabled?: boolean;
    PrimaryGroupId?: number;
}

interface GroupXapi {
    Id: number;
    Name?: string;
    Hours?: HoraireXapi;
    BreakTime?: HoraireXapi;
    OfficeHolidays?: FerieXapi[];
}

interface EtatPoste {
    state: PresenceState;
    queueLoggedIn: boolean;
    groupId: number | null;
    intervalId: string;
}

/** Le profil d'un poste et son libellé réel (« Custom 1 » → « En séance »). */
interface ProfilPoste {
    slot: string;
    label: string;
}

/** Ce que l'échantillonneur garde en mémoire, par tenant, entre deux minutes. */
interface Memoire {
    /** Faux au (re)démarrage : les intervalles restés ouverts en base sont d'abord clos. */
    amorcee: boolean;
    postes: Map<string, EtatPoste>;
    /** Profil courant de chaque poste, avec son nom d'usage — pour l'infobulle. */
    profils: Map<string, ProfilPoste>;
    /** Nom que CHAQUE poste donne à ses profils : extension → slot → libellé. */
    libelles: Map<string, Map<string, string>>;
    sampledAt: number | null;
    derniereConsolidation: number;
    horairesDuJour: string | null;
}

const memoires = new Map<string, Memoire>();
function memoireDe(serverId: ServerId): Memoire {
    let m = memoires.get(serverId);
    if (!m) {
        m = { amorcee: false, postes: new Map(), profils: new Map(), libelles: new Map(), sampledAt: null, derniereConsolidation: 0, horairesDuJour: null };
        memoires.set(serverId, m);
    }
    return m;
}

// ============================================
// XAPI
// ============================================

/** Le jeton PARTAGÉ du client XAPI (cf. lib/xapi-client) : une émission par heure, pour tout le monde. */
async function accesXapi(config: XapiConfig): Promise<{ base: string; jeton: string } | { erreur: string }> {
    const base = normalizeXapiBaseUrl(config.baseUrl ?? "");
    if (!base) return { erreur: "adresse du PBX invalide" };
    const token = await requestXapiToken(config.baseUrl!, config.clientId ?? "", config.key ?? "");
    if (!token.ok) return { erreur: token.reason };
    return { base, jeton: token.accessToken };
}

/**
 * Lit les postes ; un 401 (jeton révoqué par une émission concurrente, ou
 * périmé côté PBX) vaut UN nouvel essai avec un jeton frais, dans la même
 * minute — le relevé ne saute pas.
 */
async function lireUsers(config: XapiConfig): Promise<{ users: UserXapi[]; base: string; jeton: string } | { erreur: string }> {
    for (let essai = 0; essai < 2; essai++) {
        const acces = await accesXapi(config);
        if ("erreur" in acces) return { erreur: `jeton : ${acces.erreur}` };
        try {
            const users = await lirePages<UserXapi>(acces.base, acces.jeton, REQUETE_USERS);
            return { users, base: acces.base, jeton: acces.jeton };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!/HTTP 401/.test(message) || essai === 1) return { erreur: `lecture des postes : ${message}` };
            forgetXapiToken(config.baseUrl!, config.clientId ?? "");
        }
    }
    return { erreur: "lecture des postes : jeton refusé deux fois" };
}

/**
 * Lit toute une collection OData, page par page. Le PBX plafonne $top à 100
 * et, la limite venant du client, ne renvoie PAS de @odata.nextLink : on
 * avance nous-mêmes par $skip jusqu'à une page incomplète (vérifié le
 * 8 sept. 2026 : 616 postes, la première version ne lisait que les 100 premiers).
 */
async function lirePages<T>(base: string, jeton: string, requete: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 0; page < PAGE_LIMIT; page++) {
        const url = `${base}/xapi/v1/${requete}&%24top=${PAGE_SIZE}&%24skip=${page * PAGE_SIZE}`;
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${jeton}` },
            signal: AbortSignal.timeout(20_000),
            cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} sur ${requete.split("?")[0]}`);
        const payload = await res.json() as { value?: T[] };
        const lot = payload.value ?? [];
        out.push(...lot);
        if (lot.length < PAGE_SIZE) break;
    }
    return out;
}

const PAGE_SIZE = 100;
const REQUETE_USERS = "Users?%24select=Number,CurrentProfileName,QueueStatus,IsRegistered,Enabled,PrimaryGroupId&%24orderby=Id";
const REQUETE_GROUPS = "Groups?%24select=Id,Name,Hours,BreakTime&%24expand=OfficeHolidays&%24orderby=Id";
/**
 * Le nom que chaque poste donne à ses profils. Le PBX ne renvoie que le slot
 * dans CurrentProfileName (« Custom 1 ») ; le nom d'usage vit ici
 * (CustomName : « En séance »). Relu une fois par jour, avec les horaires.
 */
const REQUETE_PROFILS = "Users?%24select=Number&%24expand=ForwardingProfiles&%24orderby=Id";

// ============================================
// ÉCHANTILLONNAGE
// ============================================

export interface ResumeEchantillon {
    serverId: ServerId;
    ran: boolean;
    reason?: string;
    /** Postes activés vus par le relevé. */
    users?: number;
    /** Intervalles ouverts par ce relevé (changements d'état). */
    changes?: number;
}

async function noterErreur(serverId: ServerId, message: string): Promise<void> {
    await prismaAuth.presenceSampler.upsert({
        where: { serverId },
        update: { lastError: message.slice(0, 500), lastErrorAt: new Date() },
        create: { serverId, lastError: message.slice(0, 500), lastErrorAt: new Date() },
    });
}

/** Un relevé : lit les postes, écrit les changements, consolide s'il est temps. */
export async function echantillonner(serverId: ServerId): Promise<ResumeEchantillon> {
    const reglages = await prismaAuth.tenantSettings.findUnique({
        where: { serverId }, select: { presenceSamplingEnabled: true },
    });
    if (!reglages?.presenceSamplingEnabled) return { serverId, ran: false, reason: "éteint" };
    const config = await getServerXapiConfig(serverId);
    if (!isXapiUsable(config)) return { serverId, ran: false, reason: "XAPI inutilisable" };

    const mem = memoireDe(serverId);
    const lecture = await lireUsers(config);
    if ("erreur" in lecture) {
        await noterErreur(serverId, lecture.erreur);
        return { serverId, ran: false, reason: lecture.erreur };
    }
    const { users } = lecture;
    const acces = { base: lecture.base, jeton: lecture.jeton };

    const now = new Date();
    if (!mem.amorcee) {
        // (Re)démarrage : ce que la base croit ouvert s'est arrêté au dernier
        // relevé réussi — jamais plus tard, une coupure n'est pas de la présence.
        const etat = await prismaAuth.presenceSampler.findUnique({ where: { serverId }, select: { lastSampleAt: true } });
        await prismaAuth.presenceInterval.updateMany({
            where: { serverId, endedAt: null },
            data: { endedAt: etat?.lastSampleAt ?? now },
        });
        mem.postes.clear();
        mem.amorcee = true;
    }

    const vus = new Set<string>();
    // Le profil courant se note à CHAQUE relevé, même quand l'état ne change
    // pas : passer de « Custom 1 » à « Custom 2 » ne rouvre pas d'intervalle,
    // mais l'infobulle doit suivre.
    mem.profils.clear();
    const aClore: string[] = [];
    const aOuvrir: Array<{ extension: string; state: PresenceState; queueLoggedIn: boolean; groupId: number | null }> = [];
    for (const u of users) {
        if (!u.Number || u.Enabled === false) continue;
        vus.add(u.Number);
        const slot = (u.CurrentProfileName ?? "").trim();
        if (slot) mem.profils.set(u.Number, { slot, label: mem.libelles.get(u.Number)?.get(slot) || slot });
        const state = etatDe({ profile: u.CurrentProfileName, registered: u.IsRegistered === true });
        const queueLoggedIn = u.QueueStatus === "LoggedIn";
        const groupId = typeof u.PrimaryGroupId === "number" ? u.PrimaryGroupId : null;
        const avant = mem.postes.get(u.Number);
        if (avant && avant.state === state && avant.queueLoggedIn === queueLoggedIn && avant.groupId === groupId) continue;
        if (avant) aClore.push(avant.intervalId);
        aOuvrir.push({ extension: u.Number, state, queueLoggedIn, groupId });
    }
    // Un poste disparu du PBX (supprimé, désactivé) ferme son intervalle.
    for (const [extension, poste] of mem.postes) {
        if (!vus.has(extension)) { aClore.push(poste.intervalId); mem.postes.delete(extension); }
    }

    await prismaAuth.$transaction(async (tx) => {
        if (aClore.length > 0) {
            await tx.presenceInterval.updateMany({ where: { id: { in: aClore } }, data: { endedAt: now } });
        }
        for (const o of aOuvrir) {
            const ligne = await tx.presenceInterval.create({
                data: { serverId, extension: o.extension, state: o.state, queueLoggedIn: o.queueLoggedIn, groupId: o.groupId, startedAt: now },
                select: { id: true },
            });
            mem.postes.set(o.extension, { state: o.state, queueLoggedIn: o.queueLoggedIn, groupId: o.groupId, intervalId: ligne.id });
        }
        await tx.presenceSampler.upsert({
            where: { serverId },
            update: { lastSampleAt: now, samples: { increment: 1 }, lastError: null },
            create: { serverId, lastSampleAt: now, samples: 1 },
        });
    });
    mem.sampledAt = now.getTime();

    // Horaires (une fois par jour) puis consolidation (toutes les 15 minutes) :
    // en aval du relevé, pour que le jour en cours suive au fil de la journée.
    if (now.getTime() - mem.derniereConsolidation > CONSOLIDATION_EVERY_MS) {
        mem.derniereConsolidation = now.getTime();
        try {
            const tz = await getServerTimezone(serverId);
            const jour = jourLocal(now.getTime(), tz);
            if (mem.horairesDuJour !== jour) {
                await rafraichirHoraires(serverId, acces.base, acces.jeton);
                await rafraichirLibelles(mem, acces.base, acces.jeton);
                mem.horairesDuJour = jour;
            }
            await consoliderPresence(serverId);
        } catch (error) {
            // Une ligne, jamais une trace de pile : la consolidation repasse
            // au quart d'heure suivant et refait le jour en cours.
            const motif = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 200);
            console.warn(`[présence] ${serverId} : consolidation en échec — ${motif}`);
        }
    }

    return { serverId, ran: true, users: vus.size, changes: aOuvrir.length };
}

/**
 * Le nom d'usage des profils, poste par poste. Sans cet appel, l'écran
 * afficherait « Custom 1 » là où la personne a écrit « En séance ».
 * Uniquement en mémoire : un libellé n'a de sens que pour l'état courant.
 */
async function rafraichirLibelles(mem: Memoire, base: string, jeton: string): Promise<void> {
    const users = await lirePages<{ Number?: string; ForwardingProfiles?: Array<{ Name?: string; CustomName?: string }> }>(base, jeton, REQUETE_PROFILS);
    mem.libelles.clear();
    for (const u of users) {
        if (!u.Number || !Array.isArray(u.ForwardingProfiles)) continue;
        const parSlot = new Map<string, string>();
        for (const p of u.ForwardingProfiles) {
            const slot = (p.Name ?? "").trim();
            const nom = (p.CustomName ?? "").trim();
            if (slot && nom) parSlot.set(slot, nom);
        }
        if (parSlot.size > 0) mem.libelles.set(u.Number, parSlot);
    }
}

/** Les horaires de bureau des départements, tels que le PBX les déclare aujourd'hui. */
async function rafraichirHoraires(serverId: ServerId, base: string, jeton: string): Promise<void> {
    const groups = await lirePages<GroupXapi>(base, jeton, REQUETE_GROUPS);
    const fetchedAt = new Date();
    for (const g of groups) {
        if (typeof g.Id !== "number") continue;
        // Les pseudo-groupes de favoris du client 3CX ne sont pas des départements.
        if ((g.Name ?? "").startsWith("___")) continue;
        await prismaAuth.presenceGroupSchedule.upsert({
            where: { serverId_groupId: { serverId, groupId: g.Id } },
            update: { name: g.Name ?? String(g.Id), hours: (g.Hours ?? {}) as object, breakTime: (g.BreakTime ?? {}) as object, holidays: (g.OfficeHolidays ?? []) as object[], fetchedAt },
            create: { serverId, groupId: g.Id, name: g.Name ?? String(g.Id), hours: (g.Hours ?? {}) as object, breakTime: (g.BreakTime ?? {}) as object, holidays: (g.OfficeHolidays ?? []) as object[], fetchedAt },
        });
    }
}

// ============================================
// CONSOLIDATION
// ============================================

interface HorairesDepartement {
    name: string;
    hours: HoraireXapi | null;
    breakTime: HoraireXapi | null;
    holidays: FerieXapi[];
}

async function chargerHoraires(serverId: ServerId): Promise<Map<number, HorairesDepartement>> {
    const lignes = await prismaAuth.presenceGroupSchedule.findMany({ where: { serverId } });
    return new Map(lignes.map((l) => [l.groupId, {
        name: l.name,
        hours: (l.hours ?? null) as HoraireXapi | null,
        breakTime: (l.breakTime ?? null) as HoraireXapi | null,
        holidays: (Array.isArray(l.holidays) ? (l.holidays as unknown) : []) as FerieXapi[],
    }]));
}

/**
 * Ventile les intervalles par jour et par poste sur les heures de bureau.
 * Reprend au dernier jour consolidé (refait : il était peut-être partiel)
 * et va jusqu'à aujourd'hui, refait à chaque passage.
 */
export async function consoliderPresence(serverId: ServerId): Promise<{ jours: number; lignes: number }> {
    const tz = await getServerTimezone(serverId);
    const etat = await prismaAuth.presenceSampler.findUnique({ where: { serverId } });
    const aujourdhui = jourLocal(Date.now(), tz);
    let jour = etat?.lastConsolidatedDay ?? null;
    if (!jour) {
        const premier = await prismaAuth.presenceInterval.findFirst({ where: { serverId }, orderBy: { startedAt: "asc" }, select: { startedAt: true } });
        if (!premier) return { jours: 0, lignes: 0 };
        jour = jourLocal(premier.startedAt.getTime(), tz);
    }
    // Un intervalle encore ouvert vaut jusqu'au dernier relevé réussi, pas plus.
    const finObservee = Math.min(Date.now(), (etat?.lastSampleAt?.getTime() ?? 0) + 90_000);
    const horaires = await chargerHoraires(serverId);

    let jours = 0, lignes = 0;
    for (let n = 0; n < CONSOLIDATION_MAX_JOURS && jour <= aujourdhui; n++, jour = jourSuivant(jour)) {
        const debut = instantLocal(jour, "00:00:00", tz);
        const fin = instantLocal(jourSuivant(jour), "00:00:00", tz);
        const intervalles = await prismaAuth.presenceInterval.findMany({
            where: { serverId, startedAt: { lt: new Date(fin) }, OR: [{ endedAt: null }, { endedAt: { gt: new Date(debut) } }] },
            select: { extension: true, state: true, queueLoggedIn: true, groupId: true, startedAt: true, endedAt: true },
            orderBy: { startedAt: "asc" },
        });
        const parPoste = new Map<string, typeof intervalles>();
        for (const i of intervalles) {
            const liste = parPoste.get(i.extension) ?? [];
            liste.push(i);
            parPoste.set(i.extension, liste);
        }
        const rows: Array<{
            serverId: string; extension: string; day: string; officeSeconds: number; sampledSeconds: number;
            availableSeconds: number; absentSeconds: number; dndSeconds: number; offlineSeconds: number;
            customSeconds: number; queueSeconds: number;
            groupId: number | null; hoursSource: SourceHoraires;
        }> = [];
        for (const [extension, liste] of parPoste) {
            // Le département du dernier intervalle du jour fait foi pour ses horaires.
            const groupId = liste[liste.length - 1].groupId;
            const dep = groupId != null ? horaires.get(groupId) : undefined;
            const { plages, source } = plagesDeBureau(jour, tz, dep?.hours, dep?.breakTime, dep?.holidays ?? []);
            const officeSeconds = secondesDe(plages);
            if (officeSeconds === 0) continue;
            const v = ventiler(liste.map((i) => ({
                state: i.state as PresenceState,
                queueLoggedIn: i.queueLoggedIn,
                startedAt: i.startedAt.getTime(),
                endedAt: i.endedAt ? i.endedAt.getTime() : finObservee,
            })), plages);
            if (v.sampledSeconds === 0) continue;
            rows.push({ serverId, extension, day: jour, officeSeconds, ...v, groupId, hoursSource: source });
        }
        await prismaAuth.$transaction([
            prismaAuth.presenceDay.deleteMany({ where: { serverId, day: jour } }),
            prismaAuth.presenceDay.createMany({ data: rows }),
        ]);
        jours++;
        lignes += rows.length;
    }
    await prismaAuth.presenceSampler.upsert({
        where: { serverId },
        update: { lastConsolidatedDay: aujourdhui },
        create: { serverId, lastConsolidatedDay: aujourdhui },
    });
    return { jours, lignes };
}

// ============================================
// LECTURE
// ============================================

export interface PresenceMaintenant {
    at: Date;
    postes: Map<string, { state: PresenceState; queueLoggedIn: boolean; profileLabel: string | null }>;
}

/** L'état de chaque poste au dernier relevé — depuis la mémoire, sans base ni PBX ; null si le relevé date. */
export function getPresenceMaintenant(serverId: ServerId): PresenceMaintenant | null {
    const mem = memoires.get(serverId);
    if (!mem?.sampledAt || Date.now() - mem.sampledAt > FRAICHEUR_MS) return null;
    return {
        at: new Date(mem.sampledAt),
        postes: new Map([...mem.postes].map(([ext, p]) => [ext, {
            state: p.state, queueLoggedIn: p.queueLoggedIn,
            // Le nom d'usage du profil, quand le poste en a donné un.
            profileLabel: mem.profils.get(ext)?.label ?? null,
        }])),
    };
}

export interface AgregatPresence {
    days: number;
    officeSeconds: number;
    sampledSeconds: number;
    availableSeconds: number;
    absentSeconds: number;
    dndSeconds: number;
    offlineSeconds: number;
    customSeconds: number;
    queueSeconds: number;
    /** Nom du département dont les horaires ont servi (le plus récent), ou null en repli. */
    departement: string | null;
    hoursSource: SourceHoraires;
}

/** Les PRESENCE_JOURS derniers jours (aujourd'hui compris), par poste. */
export async function getPresenceRecente(serverId: ServerId): Promise<Map<string, AgregatPresence>> {
    const tz = await getServerTimezone(serverId);
    const aujourdhui = jourLocal(Date.now(), tz);
    const depuis = jourSuivant(aujourdhui, -(PRESENCE_JOURS - 1));
    const [jours, horaires] = await Promise.all([
        prismaAuth.presenceDay.findMany({ where: { serverId, day: { gte: depuis, lte: aujourdhui } }, orderBy: { day: "asc" } }),
        prismaAuth.presenceGroupSchedule.findMany({ where: { serverId }, select: { groupId: true, name: true } }),
    ]);
    const nomDep = new Map(horaires.map((h) => [h.groupId, h.name]));
    const out = new Map<string, AgregatPresence>();
    for (const j of jours) {
        const a = out.get(j.extension) ?? {
            days: 0, officeSeconds: 0, sampledSeconds: 0, availableSeconds: 0, absentSeconds: 0, dndSeconds: 0,
            offlineSeconds: 0, customSeconds: 0, queueSeconds: 0, departement: null, hoursSource: "default" as SourceHoraires,
        };
        a.days++;
        a.officeSeconds += j.officeSeconds; a.sampledSeconds += j.sampledSeconds;
        a.availableSeconds += j.availableSeconds; a.absentSeconds += j.absentSeconds;
        a.dndSeconds += j.dndSeconds; a.offlineSeconds += j.offlineSeconds;
        a.customSeconds += j.customSeconds; a.queueSeconds += j.queueSeconds;
        // Le jour le plus récent fait foi (tri croissant).
        a.hoursSource = j.hoursSource as SourceHoraires;
        a.departement = j.hoursSource === "department" && j.groupId != null ? (nomDep.get(j.groupId) ?? null) : null;
        out.set(j.extension, a);
    }
    return out;
}

export interface EtatEchantillonneur {
    enabled: boolean;
    lastSampleAt: string | null;
    samples: number;
    lastError: string | null;
    lastErrorAt: string | null;
}

/** Pour l'onglet des réglages et l'annuaire : le relevé tourne-t-il ? */
export async function getEtatEchantillonneur(serverId: ServerId): Promise<EtatEchantillonneur> {
    const [reglages, etat] = await Promise.all([
        prismaAuth.tenantSettings.findUnique({ where: { serverId }, select: { presenceSamplingEnabled: true } }),
        prismaAuth.presenceSampler.findUnique({ where: { serverId } }),
    ]);
    return {
        enabled: reglages?.presenceSamplingEnabled ?? false,
        lastSampleAt: etat?.lastSampleAt?.toISOString() ?? null,
        samples: etat?.samples ?? 0,
        lastError: etat?.lastError ?? null,
        lastErrorAt: etat?.lastErrorAt?.toISOString() ?? null,
    };
}
