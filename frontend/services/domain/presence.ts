/**
 * PRÉSENCE — la logique pure de l'échantillonnage XAPI (septembre 2026).
 *
 * Le XAPI ne donne qu'un ÉTAT INSTANTANÉ des postes (entité Users) : profil
 * (Available, Away, Do Not Disturb, …), connexion aux files (l'icône Q du
 * client 3CX) et téléphone enregistré. L'échantillonneur (presence.service)
 * le relève chaque minute et n'écrit que les changements ; ici vivent les
 * trois traitements qui n'ont pas besoin de base :
 *
 * - l'état d'un poste, à partir de ce que dit le XAPI ;
 * - les heures de bureau d'un jour, à partir des horaires de DÉPARTEMENT du
 *   3CX (Groups.Hours, BreakTime, OfficeHolidays) — le dénominateur ;
 * - la ventilation des intervalles d'état sur ces heures.
 *
 * Doctrine : des parts de temps par période, jamais une chronologie
 * individuelle. Et « prêt » exige les trois signaux à la fois — Casas était
 * Available et connecté à la Q avec un téléphone non enregistré.
 */

export type PresenceState = "available" | "absent" | "dnd" | "offline";

/** Ce que le XAPI dit d'un poste à un instant (entité Users). */
export interface EtatXapi {
    profile: string | null | undefined;
    registered: boolean;
}

/**
 * L'état d'un poste : hors ligne prime (un profil « Disponible » sur un
 * téléphone non enregistré ne reçoit rien) ; « Ne pas déranger » est le seul
 * profil rouge ; tout le reste (Away, Lunch, Business trip, Out of office,
 * profils personnalisés « Custom N ») est une absence.
 */
export function etatDe(u: EtatXapi): PresenceState {
    if (!u.registered) return "offline";
    const profil = (u.profile ?? "").trim().toLowerCase();
    if (profil === "available") return "available";
    if (/disturb|\bdnd\b/.test(profil)) return "dnd";
    return "absent";
}

// ============================================
// HEURES DE BUREAU
// ============================================

/** Horaire tel que le XAPI le décrit (Groups.Hours, Groups.BreakTime). */
export interface HoraireXapi {
    /** SpecificHoursExcludingHolidays | SpecificHours | AllHours | OfficeHours (hérite) … */
    Type?: string;
    Periods?: Array<{ DayOfWeek: string; Start: string; Stop: string }>;
}

/** Un jour férié du département (Groups.OfficeHolidays). */
export interface FerieXapi {
    Day: number;
    Month: number;
    Year?: number;
    DayEnd?: number;
    MonthEnd?: number;
    YearEnd?: number;
    IsRecurrent?: boolean;
    /** Durée ISO 8601 depuis minuit (« PT10H40M ») : férié partiel. */
    TimeOfStartDate?: string | null;
    TimeOfEndDate?: string | null;
}

/** Une plage d'instants (ms), fermée à gauche, ouverte à droite. */
export interface Plage {
    start: number;
    end: number;
}

const JOURS_SEMAINE = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const OUVRES = JOURS_SEMAINE.slice(1, 6);

/**
 * Horaires de repli quand le département n'en déclare pas (« AllHours » =
 * ouvert jour et nuit au sens du 3CX, ou héritage sans périodes). Le 3CX de
 * Genève, Vevey et Sion déclare 09:00–16:00 avec pause 12:00–13:00 ; le repli
 * est plus large, pour ne pas fabriquer de la présence hors bureau.
 */
export const HORAIRES_PAR_DEFAUT: HoraireXapi = {
    Type: "SpecificHoursExcludingHolidays",
    Periods: OUVRES.map((DayOfWeek) => ({ DayOfWeek, Start: "08:00:00", Stop: "17:30:00" })),
};
export const PAUSES_PAR_DEFAUT: HoraireXapi = {
    Type: "SpecificHoursExcludingHolidays",
    Periods: OUVRES.map((DayOfWeek) => ({ DayOfWeek, Start: "12:00:00", Stop: "13:00:00" })),
};

/** Décalage (ms) entre l'heure murale du fuseau et l'UTC, à cet instant. */
function decalageMs(tz: string, instantMs: number): number {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(instantMs));
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const mural = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
    return mural - Math.floor(instantMs / 1000) * 1000;
}

/** L'instant (ms) d'une heure murale « hh:mm[:ss…] » d'un jour AAAA-MM-JJ, dans le fuseau. */
export function instantLocal(jour: string, heure: string, tz: string): number {
    const [y, m, d] = jour.split("-").map(Number);
    // « 09:00:00.0000000 » (XAPI), « 09:00:00 » ou « 09:00 » : les secondes sont facultatives.
    const [hh = 0, mm = 0, ss = 0] = heure.split(":").map((s) => Number(s.slice(0, 2)) || 0);
    const mural = Date.UTC(y, m - 1, d, hh, mm, ss);
    // Deux passes : le décalage se lit à l'instant visé, inconnu avant la
    // première estimation (changement d'heure).
    const estimation = mural - decalageMs(tz, mural);
    return mural - decalageMs(tz, estimation);
}

/** Le jour AAAA-MM-JJ d'un instant, dans le fuseau. */
export function jourLocal(instantMs: number, tz: string): string {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(new Date(instantMs));
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return `${g("year")}-${g("month")}-${g("day")}`;
}

/** Le jour calendaire suivant (arithmétique de dates, sans fuseau). */
export function jourSuivant(jour: string, n = 1): string {
    const [y, m, d] = jour.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function jourDeSemaine(jour: string): string {
    const [y, m, d] = jour.split("-").map(Number);
    return JOURS_SEMAINE[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function fusionner(plages: Plage[]): Plage[] {
    const triees = plages.filter((p) => p.end > p.start).sort((a, b) => a.start - b.start);
    const out: Plage[] = [];
    for (const p of triees) {
        const last = out[out.length - 1];
        if (last && p.start <= last.end) last.end = Math.max(last.end, p.end);
        else out.push({ ...p });
    }
    return out;
}

/** Retire les trous d'un ensemble de plages. */
export function soustraire(plages: Plage[], trous: Plage[]): Plage[] {
    let reste = fusionner(plages);
    for (const t of fusionner(trous)) {
        const suivant: Plage[] = [];
        for (const p of reste) {
            if (t.end <= p.start || t.start >= p.end) { suivant.push(p); continue; }
            if (t.start > p.start) suivant.push({ start: p.start, end: t.start });
            if (t.end < p.end) suivant.push({ start: t.end, end: p.end });
        }
        reste = suivant;
    }
    return reste;
}

/** Les plages d'un horaire XAPI pour un jour ; null quand l'horaire ne dit rien d'exploitable. */
function plagesDunHoraire(h: HoraireXapi | null | undefined, jour: string, tz: string): Plage[] | null {
    if (!h || !Array.isArray(h.Periods)) return null;
    if (h.Type === "AllHours") return null;
    const jds = jourDeSemaine(jour);
    const plages = h.Periods
        .filter((p) => p.DayOfWeek === jds && p.Start && p.Stop)
        .map((p) => ({ start: instantLocal(jour, p.Start, tz), end: instantLocal(jour, p.Stop, tz) }));
    // Un horaire déclaré mais vide ce jour-là (samedi) = fermé, pas « inconnu ».
    return h.Periods.length > 0 ? fusionner(plages) : null;
}

/** « PT10H40M » → « 10:40:00 » ; null si illisible. */
function heureDepuisDuree(duree: string | null | undefined): string | null {
    if (!duree) return null;
    const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duree);
    if (!m) return null;
    const [, h = "0", mi = "0", s = "0"] = m;
    return `${h.padStart(2, "0")}:${mi.padStart(2, "0")}:${s.padStart(2, "0")}`;
}

/** Les plages de fermeture pour fériés qui touchent ce jour. */
function feriesDuJour(feries: readonly FerieXapi[], jour: string, tz: string): Plage[] {
    const [annee] = jour.split("-").map(Number);
    const debutJour = instantLocal(jour, "00:00:00", tz);
    const finJour = instantLocal(jourSuivant(jour), "00:00:00", tz);
    const cle = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const trous: Plage[] = [];
    for (const f of feries) {
        const yStart = f.IsRecurrent || !f.Year ? annee : f.Year;
        const yEnd = f.IsRecurrent || !f.YearEnd ? annee : f.YearEnd;
        const premier = cle(yStart, f.Month, f.Day);
        const dernier = cle(yEnd, f.MonthEnd ?? f.Month, f.DayEnd ?? f.Day);
        if (jour < premier || jour > dernier) continue;
        const hDebut = jour === premier ? heureDepuisDuree(f.TimeOfStartDate) : null;
        const hFin = jour === dernier ? heureDepuisDuree(f.TimeOfEndDate) : null;
        trous.push({
            start: hDebut ? instantLocal(jour, hDebut, tz) : debutJour,
            end: hFin ? instantLocal(jour, hFin, tz) : finJour,
        });
    }
    return trous;
}

export type SourceHoraires = "department" | "default";

/**
 * Les heures de bureau d'un jour, pauses et fériés déduits : les horaires du
 * département quand il en déclare, le repli sinon (avec ses propres pauses).
 */
export function plagesDeBureau(
    jour: string,
    tz: string,
    horaires: HoraireXapi | null | undefined,
    pauses: HoraireXapi | null | undefined,
    feries: readonly FerieXapi[] = [],
): { plages: Plage[]; source: SourceHoraires } {
    const declarees = plagesDunHoraire(horaires, jour, tz);
    const source: SourceHoraires = declarees ? "department" : "default";
    const base = declarees ?? plagesDunHoraire(HORAIRES_PAR_DEFAUT, jour, tz) ?? [];
    const trous = [
        ...(plagesDunHoraire(source === "department" ? pauses : PAUSES_PAR_DEFAUT, jour, tz) ?? []),
        ...feriesDuJour(feries, jour, tz),
    ];
    return { plages: soustraire(base, trous), source };
}

export function secondesDe(plages: readonly Plage[]): number {
    return Math.round(plages.reduce((acc, p) => acc + Math.max(0, p.end - p.start), 0) / 1000);
}

// ============================================
// VENTILATION
// ============================================

export interface IntervallePresence {
    state: PresenceState;
    queueLoggedIn: boolean;
    startedAt: number;
    endedAt: number;
}

export interface Ventilation {
    /** Secondes de bureau couvertes par l'échantillonnage : le dénominateur. */
    sampledSeconds: number;
    availableSeconds: number;
    absentSeconds: number;
    dndSeconds: number;
    offlineSeconds: number;
    /** Connecté aux files, pendant les secondes échantillonnées. */
    queueSeconds: number;
}

/** Répartit les intervalles d'état sur les plages de bureau. */
export function ventiler(intervalles: readonly IntervallePresence[], plages: readonly Plage[]): Ventilation {
    const ms = { sampled: 0, available: 0, absent: 0, dnd: 0, offline: 0, queue: 0 };
    for (const i of intervalles) {
        for (const p of plages) {
            const recouvrement = Math.min(i.endedAt, p.end) - Math.max(i.startedAt, p.start);
            if (recouvrement <= 0) continue;
            ms.sampled += recouvrement;
            ms[i.state] += recouvrement;
            if (i.queueLoggedIn) ms.queue += recouvrement;
        }
    }
    const s = (v: number) => Math.round(v / 1000);
    return {
        sampledSeconds: s(ms.sampled), availableSeconds: s(ms.available), absentSeconds: s(ms.absent),
        dndSeconds: s(ms.dnd), offlineSeconds: s(ms.offline), queueSeconds: s(ms.queue),
    };
}

export interface PartsPresence {
    available: number;
    absent: number;
    dnd: number;
    offline: number;
    queue: number;
}

/** Parts (en %, entiers) sur le temps échantillonné ; null sans échantillon. */
export function partsPresence(v: Pick<Ventilation, "sampledSeconds" | "availableSeconds" | "absentSeconds" | "dndSeconds" | "offlineSeconds" | "queueSeconds">): PartsPresence | null {
    if (v.sampledSeconds <= 0) return null;
    const pct = (x: number) => Math.round((100 * x) / v.sampledSeconds);
    return { available: pct(v.availableSeconds), absent: pct(v.absentSeconds), dnd: pct(v.dndSeconds), offline: pct(v.offlineSeconds), queue: pct(v.queueSeconds) };
}

/** « 6 h 20 » — pour les infobulles. */
export function formatHeures(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return h > 0 ? `${h} h${m > 0 ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m} min`;
}
