import { describe, it, expect } from "vitest";
import {
    ETAPES,
    LIBELLES_VISITE,
    TEXTES_BILAN,
    TEXTE_DESTINATIONS,
    TEXTE_PROVENANCE,
    VISITES,
    estVisite,
    placerInfobulle,
} from "./visite-guidee";

describe("les visites et leurs étapes", () => {
    it("deux visites, chacune avec un libellé", () => {
        expect(VISITES).toEqual(["dashboard", "statistics"]);
        for (const v of VISITES) expect(LIBELLES_VISITE[v]).toBeTruthy();
        expect(estVisite("dashboard")).toBe(true);
        expect(estVisite("logs")).toBe(false);
        expect(estVisite(null)).toBe(false);
    });

    it("chaque étape a une ancre unique dans sa visite, un titre et un texte", () => {
        for (const v of VISITES) {
            const ancres = ETAPES[v].map((e) => e.ancre);
            expect(new Set(ancres).size).toBe(ancres.length);
            for (const e of ETAPES[v]) {
                expect(e.titre.length).toBeGreaterThan(0);
                expect(e.texte.length).toBeGreaterThan(10);
            }
        }
        expect(ETAPES.dashboard).toHaveLength(7);
        expect(ETAPES.statistics).toHaveLength(12);
    });

    it("les étapes du bilan disent exactement ce que disent les infobulles de l'écran", () => {
        const texte = (ancre: string) => ETAPES.statistics.find((e) => e.ancre === ancre)?.texte;
        expect(texte("recus")).toBe(TEXTES_BILAN.recus);
        expect(texte("perdus")).toBe(TEXTES_BILAN.perdus);
        expect(texte("equipe")).toBe(TEXTES_BILAN.equipe);
        expect(texte("provenance")).toBe(TEXTE_PROVENANCE);
        expect(texte("destinations")).toBe(TEXTE_DESTINATIONS);
    });

    it("jamais le mot « file » face au manager", () => {
        for (const v of VISITES) for (const e of ETAPES[v]) expect(`${e.titre} ${e.texte}`).not.toMatch(/\bfiles?\b/i);
    });
});

describe("placement de l'infobulle", () => {
    const fenetre = { width: 1280, height: 800 };
    const boite = { width: 340, height: 160 };

    it("sous la cible quand la place le permet, flèche au centre", () => {
        const p = placerInfobulle({ top: 100, left: 400, width: 200, height: 50 }, fenetre, boite);
        expect(p.position).toBe("bas");
        expect(p.top).toBe(100 + 50 + 14);
        expect(p.left).toBe(500 - 170);
        expect(p.fleche).toBe(170);
    });

    it("au-dessus quand le bas de la fenêtre est trop proche", () => {
        const p = placerInfobulle({ top: 700, left: 400, width: 200, height: 60 }, fenetre, boite);
        expect(p.position).toBe("haut");
        expect(p.top).toBe(700 - 14 - 160);
    });

    it("reste dans les marges latérales, la flèche continue de viser la cible", () => {
        const gauche = placerInfobulle({ top: 100, left: 0, width: 40, height: 40 }, fenetre, boite);
        expect(gauche.left).toBe(12);
        expect(gauche.fleche).toBe(16);
        const droite = placerInfobulle({ top: 100, left: 1240, width: 40, height: 40 }, fenetre, boite);
        expect(droite.left).toBe(1280 - 340 - 12);
        expect(droite.fleche).toBe(340 - 16);
    });

    it("sous la cible malgré tout quand rien ne tient ni dessus ni dessous", () => {
        const p = placerInfobulle({ top: 60, left: 100, width: 100, height: 700 }, { width: 800, height: 780 }, boite);
        expect(p.position).toBe("bas");
    });
});
