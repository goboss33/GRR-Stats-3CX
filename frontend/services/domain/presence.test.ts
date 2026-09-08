import { describe, it, expect } from "vitest";
import {
    etatDe,
    instantLocal,
    jourLocal,
    jourSuivant,
    plagesDeBureau,
    secondesDe,
    soustraire,
    ventiler,
    partsPresence,
    formatHeures,
    HORAIRES_PAR_DEFAUT,
    type HoraireXapi,
    type FerieXapi,
} from "./presence";

const TZ = "Europe/Zurich";
// Les horaires réels du département GRR GENEVE (sonde du 8 sept. 2026).
const GENEVE: HoraireXapi = {
    Type: "SpecificHoursExcludingHolidays",
    Periods: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((DayOfWeek) => ({ DayOfWeek, Start: "09:00:00.0000000", Stop: "16:00:00.0000000" })),
};
const PAUSE_GENEVE: HoraireXapi = {
    Type: "SpecificHoursExcludingHolidays",
    Periods: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((DayOfWeek) => ({ DayOfWeek, Start: "12:00:00.0000000", Stop: "13:00:00.0000000" })),
};
const H = 3600;

describe("état d'un poste", () => {
    it("hors ligne prime sur tout : un profil Disponible sans téléphone enregistré ne reçoit rien", () => {
        expect(etatDe({ profile: "Available", registered: false })).toBe("offline");
    });
    it("Available enregistré = disponible ; Do Not Disturb = rouge ; le reste = absent", () => {
        expect(etatDe({ profile: "Available", registered: true })).toBe("available");
        expect(etatDe({ profile: "Do Not Disturb", registered: true })).toBe("dnd");
        expect(etatDe({ profile: "DND", registered: true })).toBe("dnd");
        for (const p of ["Away", "Lunch", "Business Trip", "Out of office", "Custom 1", "", null, undefined]) {
            expect(etatDe({ profile: p, registered: true })).toBe("absent");
        }
    });
});

describe("heures murales et fuseau", () => {
    it("convertit une heure locale de Zurich en instant, été comme hiver", () => {
        expect(new Date(instantLocal("2026-09-08", "09:00:00", TZ)).toISOString()).toBe("2026-09-08T07:00:00.000Z");
        expect(new Date(instantLocal("2026-01-12", "09:00:00.0000000", TZ)).toISOString()).toBe("2026-01-12T08:00:00.000Z");
    });
    it("retrouve le jour local d'un instant, et avance d'un jour sans se soucier du fuseau", () => {
        expect(jourLocal(Date.UTC(2026, 8, 8, 22, 30), TZ)).toBe("2026-09-09");
        expect(jourSuivant("2026-08-31")).toBe("2026-09-01");
        expect(jourSuivant("2026-09-08", -30)).toBe("2026-08-09");
    });
});

describe("heures de bureau d'un jour", () => {
    it("département déclaré : ses périodes, pause déduite", () => {
        const { plages, source } = plagesDeBureau("2026-09-08", TZ, GENEVE, PAUSE_GENEVE);
        expect(source).toBe("department");
        expect(plages.map((p) => [new Date(p.start).toISOString(), new Date(p.end).toISOString()])).toEqual([
            ["2026-09-08T07:00:00.000Z", "2026-09-08T10:00:00.000Z"],
            ["2026-09-08T11:00:00.000Z", "2026-09-08T14:00:00.000Z"],
        ]);
        expect(secondesDe(plages)).toBe(6 * H);
    });
    it("samedi d'un département déclaré = fermé, pas « inconnu »", () => {
        const { plages, source } = plagesDeBureau("2026-09-12", TZ, GENEVE, PAUSE_GENEVE);
        expect(source).toBe("department");
        expect(plages).toEqual([]);
    });
    it("« AllHours » ou héritage sans période : le repli, avec SES pauses", () => {
        for (const h of [{ Type: "AllHours", Periods: [] }, { Type: "OfficeHours", Periods: [] }, null]) {
            const { plages, source } = plagesDeBureau("2026-09-08", TZ, h, PAUSE_GENEVE);
            expect(source).toBe("default");
            expect(secondesDe(plages)).toBe(8.5 * H);
        }
        expect(HORAIRES_PAR_DEFAUT.Periods).toHaveLength(5);
    });
    it("un férié entier ferme le jour, un férié partiel n'en retire qu'un morceau", () => {
        const entier: FerieXapi = { Day: 8, Month: 9, Year: 2026 };
        expect(plagesDeBureau("2026-09-08", TZ, GENEVE, PAUSE_GENEVE, [entier]).plages).toEqual([]);
        // Le « férié test » réel du 10 août 2026, 10:40 → 10:59.
        const partiel: FerieXapi = { Day: 10, Month: 8, Year: 2026, DayEnd: 10, MonthEnd: 8, YearEnd: 2026, TimeOfStartDate: "PT10H40M", TimeOfEndDate: "PT10H59M" };
        const { plages } = plagesDeBureau("2026-08-10", TZ, GENEVE, PAUSE_GENEVE, [partiel]);
        expect(secondesDe(plages)).toBe(6 * H - 19 * 60);
    });
    it("un férié récurrent vaut chaque année, une plage de plusieurs jours couvre ses jours intermédiaires", () => {
        const noel: FerieXapi = { Day: 25, Month: 12, IsRecurrent: true };
        expect(plagesDeBureau("2027-12-25", TZ, GENEVE, PAUSE_GENEVE, [noel]).plages).toEqual([]);
        const pont: FerieXapi = { Day: 24, Month: 12, Year: 2026, DayEnd: 2, MonthEnd: 1, YearEnd: 2027 };
        expect(plagesDeBureau("2026-12-28", TZ, GENEVE, PAUSE_GENEVE, [pont]).plages).toEqual([]);
        expect(secondesDe(plagesDeBureau("2027-01-04", TZ, GENEVE, PAUSE_GENEVE, [pont]).plages)).toBe(6 * H);
    });
    it("soustraire : les trous coupent, chevauchent ou englobent", () => {
        const r = soustraire([{ start: 0, end: 100 }], [{ start: 10, end: 20 }, { start: 90, end: 200 }]);
        expect(r).toEqual([{ start: 0, end: 10 }, { start: 20, end: 90 }]);
    });
});

describe("ventilation des intervalles sur les heures de bureau", () => {
    const jour = "2026-09-08";
    const t = (h: string) => instantLocal(jour, h, TZ);
    const { plages } = plagesDeBureau(jour, TZ, GENEVE, PAUSE_GENEVE); // 09–12, 13–16

    it("ne compte que le recouvrement avec les plages, par état, et la Q à part", () => {
        const v = ventiler([
            { state: "offline", queueLoggedIn: true, startedAt: t("06:00"), endedAt: t("08:30") },
            { state: "available", queueLoggedIn: true, startedAt: t("08:30"), endedAt: t("11:00") },
            { state: "absent", queueLoggedIn: true, startedAt: t("11:00"), endedAt: t("14:00") },
            { state: "available", queueLoggedIn: false, startedAt: t("14:00"), endedAt: t("18:00") },
        ], plages);
        expect(v.sampledSeconds).toBe(6 * H);
        expect(v.availableSeconds).toBe(2 * H + 2 * H);
        expect(v.absentSeconds).toBe(1 * H + 1 * H);
        expect(v.offlineSeconds).toBe(0);
        expect(v.queueSeconds).toBe(2 * H + 2 * H);
        expect(partsPresence(v)).toEqual({ available: 67, absent: 33, dnd: 0, offline: 0, queue: 67 });
    });
    it("une panne d'échantillonnage n'est pas de l'absence : le dénominateur est le temps observé", () => {
        const v = ventiler([{ state: "available", queueLoggedIn: true, startedAt: t("09:00"), endedAt: t("10:30") }], plages);
        expect(v.sampledSeconds).toBe(1.5 * H);
        expect(partsPresence(v)?.available).toBe(100);
        expect(partsPresence({ sampledSeconds: 0, availableSeconds: 0, absentSeconds: 0, dndSeconds: 0, offlineSeconds: 0, queueSeconds: 0 })).toBeNull();
    });
    it("formatHeures : heures et minutes lisibles", () => {
        expect(formatHeures(6 * H + 20 * 60)).toBe("6 h 20");
        expect(formatHeures(2 * H)).toBe("2 h");
        expect(formatHeures(25 * 60)).toBe("25 min");
    });
});
