import { describe, it, expect } from "vitest";
import {
    appliquerPerimetreProvenances,
    replierProvenances,
    filtreParcoursProvenance,
    lienJournauxProvenance,
    LIBELLE_HORS_PERIMETRE,
    MAX_BARRES,
} from "./provenance-appels";
import { outcomesForBucket } from "./call-classification";
import type { InboundSource } from "./call.types";

const src = (queueNumber: string, calls: number, queueName = `File ${queueNumber}`) => ({ queueNumber, queueName, calls });

describe("règle de périmètre (outOfScopeFinalStatus) sur les équipes d'origine", () => {
    // Réception de Genève vue par un manager qui ne voit que la 900.
    const sources = [src("948", 843), src("945", 224), src("900", 24)];
    const dansPerimetre = (n: string) => n === "900";

    it("« name » : tout le monde est nommé, le périmètre n'est qu'annoté", () => {
        const r = appliquerPerimetreProvenances(sources, dansPerimetre, "name");
        expect(r.map((s) => [s.queueNumber, s.inScope])).toEqual([["948", false], ["945", false], ["900", true]]);
    });

    it("« anonymize » : les équipes hors périmètre fondent en UN regroupement, replacé par volume", () => {
        const r = appliquerPerimetreProvenances(sources, dansPerimetre, "anonymize");
        expect(r).toEqual([
            { queueNumber: null, queueName: LIBELLE_HORS_PERIMETRE, calls: 1067, inScope: false },
            { queueNumber: "900", queueName: "File 900", calls: 24, inScope: true },
        ]);
    });

    it("« hide » : même traitement — un graphique qui se tait ferait mentir son total", () => {
        expect(appliquerPerimetreProvenances(sources, dansPerimetre, "hide"))
            .toEqual(appliquerPerimetreProvenances(sources, dansPerimetre, "anonymize"));
    });

    it("sans équipe hors périmètre, aucun regroupement n'apparaît", () => {
        const r = appliquerPerimetreProvenances(sources, () => true, "anonymize");
        expect(r).toHaveLength(3);
        expect(r.every((s) => s.queueNumber !== null && s.inScope)).toBe(true);
    });

    it("le regroupement anonyme prend sa place selon son poids, pas en queue de liste", () => {
        const r = appliquerPerimetreProvenances([src("900", 500), src("948", 30), src("945", 20)], dansPerimetre, "anonymize");
        expect(r.map((s) => s.queueNumber)).toEqual(["900", null]);
        expect(r[1].calls).toBe(50);
    });
});

describe("pliage de la traîne", () => {
    const n = (k: number): InboundSource[] => Array.from({ length: k }, (_, i) => ({
        queueNumber: String(100 + i), queueName: `Q${i}`, calls: 1000 - i * 10, inScope: true,
    }));

    it("jusqu'à MAX_BARRES + 1 équipes, tout s'affiche : une traîne d'UNE équipe ne mérite pas d'être masquée", () => {
        const r = replierProvenances(n(MAX_BARRES + 1));
        expect(r.traine).toBeNull();
        expect(r.visibles).toHaveLength(MAX_BARRES + 1);
    });

    it("au-delà : MAX_BARRES barres, puis la traîne dont le volume est la somme du reste", () => {
        const r = replierProvenances(n(15));
        expect(r.visibles).toHaveLength(MAX_BARRES);
        expect(r.traine?.equipes).toBe(5);
        expect(r.traine?.calls).toBe(r.traine?.detail.reduce((acc, s) => acc + s.calls, 0));
        // Conservation : barres + traîne = total.
        const total = n(15).reduce((acc, s) => acc + s.calls, 0);
        expect(r.visibles.reduce((acc, s) => acc + s.calls, 0) + (r.traine?.calls ?? 0)).toBe(total);
    });

    it("trie par volume décroissant quel que soit l'ordre d'entrée", () => {
        const r = replierProvenances([...n(3)].reverse());
        expect(r.visibles.map((s) => s.calls)).toEqual([1000, 990, 980]);
    });

    it("liste vide : rien à afficher, pas de traîne", () => {
        expect(replierProvenances([])).toEqual({ visibles: [], traine: null });
    });
});

describe("lien vers les journaux", () => {
    it("le filtre de parcours dit « passé par l'origine, puis par nous »", () => {
        const f = filtreParcoursProvenance("948", "958");
        expect(f.groups).toHaveLength(1);
        expect(f.groups[0].group.conditions[0].condition)
            .toEqual({ type: "queue", queueNumber: "948", overflowQueueNumber: "958" });
    });

    it("même socle que les vignettes : statuts « reçus » de la file, sans les directs, provenance explicite", () => {
        const href = lienJournauxProvenance({
            queueNumber: "958", fromQueue: "948", startDate: "2026-08-01", endDate: "2026-08-31", origin: "external",
        });
        const url = new URL(href, "http://localhost");
        expect(url.pathname).toBe("/admin/logs");
        expect(url.searchParams.get("start")).toBe("2026-08-01");
        expect(url.searchParams.get("end")).toBe("2026-08-31");
        expect(url.searchParams.get("queueOutcome")).toBe(`958:${outcomesForBucket("received").join(",")}`);
        expect(url.searchParams.get("queueOutcome")).not.toContain(":team");
        expect(url.searchParams.get("origin")).toBe("external");
        expect(JSON.parse(url.searchParams.get("journeyFilter") ?? "null")).toEqual(filtreParcoursProvenance("948", "958"));
    });
});
