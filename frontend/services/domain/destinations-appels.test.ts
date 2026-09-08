import { describe, it, expect } from "vitest";
import {
    choisirEquipePrincipale,
    composerDestinations,
    appliquerPerimetreDestinations,
    lienJournauxPersonne,
    DEPARTED_OUTCOMES,
    LIBELLES_REGROUPEMENTS,
    type EquipePrincipale,
} from "./destinations-appels";
import type { OutboundExit } from "./call.types";

const exit = (over: Partial<OutboundExit>): OutboundExit => ({
    outcome: "handed_off", firstHop: "person", queueNumber: null, queueName: null,
    extension: null, personName: null, calls: 1, ...over,
});

const d = (iso: string) => new Date(iso);
/** Par défaut, tout le monde est membre de la file où il décroche. */
const membre = () => true;

describe("équipe principale (arbitrage du 8 sept. 2026)", () => {
    const activite = [
        { queueNumber: "947", queueName: "Gérance GE-G01", calls: 30, lastAt: d("2026-08-20") },
        { queueNumber: "946", queueName: "Gérance GE-G05", calls: 5, lastAt: d("2026-08-28") },
    ];

    it("journal disponible : ses appartenances sont les candidates, l'activité départage", () => {
        const journal = [
            { queueNumber: "946", queueName: "Gérance GE-G05", lastSeenAt: d("2026-09-01") },
            { queueNumber: "947", queueName: "Gérance GE-G01", lastSeenAt: d("2026-09-01") },
        ];
        const r = choisirEquipePrincipale(journal, activite);
        expect(r?.queueNumber).toBe("947");
        expect(r?.autres).toEqual([{ queueNumber: "946", queueName: "Gérance GE-G05" }]);
    });

    it("journal disponible : une file active mais absente du journal n'est PAS candidate", () => {
        const journal = [{ queueNumber: "946", queueName: "Gérance GE-G05", lastSeenAt: d("2026-09-01") }];
        expect(choisirEquipePrincipale(journal, activite)?.queueNumber).toBe("946");
    });

    it("sans journal : l'activité seule, la plus sollicitée gagne", () => {
        const r = choisirEquipePrincipale(null, activite);
        expect(r?.queueNumber).toBe("947");
        expect(r?.autres.map((a) => a.queueNumber)).toEqual(["946"]);
    });

    it("égalité de volume : l'appartenance la plus récente l'emporte", () => {
        const journal = [
            { queueNumber: "946", queueName: "A", lastSeenAt: d("2026-09-05") },
            { queueNumber: "947", queueName: "B", lastSeenAt: d("2026-09-01") },
        ];
        expect(choisirEquipePrincipale(journal, [])?.queueNumber).toBe("946");
    });

    it("journal en plusieurs intervalles pour la même file : une seule candidate", () => {
        const journal = [
            { queueNumber: "946", queueName: "A", lastSeenAt: d("2026-07-01") },
            { queueNumber: "946", queueName: "A", lastSeenAt: d("2026-09-01") },
        ];
        const r = choisirEquipePrincipale(journal, []);
        expect(r?.queueNumber).toBe("946");
        expect(r?.autres).toEqual([]);
    });

    it("aucune appartenance ni activité : personne n'est rattachée arbitrairement", () => {
        expect(choisirEquipePrincipale(null, [])).toBeNull();
        expect(choisirEquipePrincipale([], [])).toBeNull();
    });
});

describe("composition par équipe", () => {
    const equipes: Record<string, EquipePrincipale> = {
        "221": { queueNumber: "933", queueName: "Gérance NY-G01", autres: [] },
        "790": { queueNumber: "947", queueName: "Gérance GE-G01", autres: [{ queueNumber: "946", queueName: "Gérance GE-G05" }] },
    };
    const resoudre = (ext: string) => equipes[ext] ?? null;

    it("débordement vers une file : la file fait la ligne, la personne qui y décroche fait le visage", () => {
        const teams = composerDestinations([
            exit({ outcome: "overflow", firstHop: "queue", queueNumber: "900", queueName: "Réception Pully", extension: "100", personName: "Sequeiros, Lucia", calls: 20 }),
            exit({ outcome: "overflow", firstHop: "queue", queueNumber: "900", queueName: "Réception Pully", calls: 8 }),
        ], resoudre, membre);
        expect(teams).toHaveLength(1);
        expect(teams[0]).toMatchObject({ queueNumber: "900", kind: "team", calls: 28, overflow: 28, directLine: 0 });
        expect(teams[0].persons).toEqual([{ extension: "100", name: "Sequeiros, Lucia", calls: 20, viaDirectLine: 0, alsoIn: [] }]);
    });

    it("un transfert NON répondu compte pour son destinataire, comme un transfert pris", () => {
        // Arbitrage du 8 sept. 2026 : la carte dit où les appels sont PARTIS.
        // Le Service Client passe trois appels à Bruna Maia (Gérance GE-G17),
        // qui n'en prend aucun — ils sont quand même les siens.
        const teams = composerDestinations([
            exit({ firstHop: "person", extension: "612", personName: "Maia, Bruna", calls: 3 }),
        ], (ext) => ext === "612" ? { queueNumber: "948", queueName: "Gérance GE-G17", autres: [] } : null, () => false);
        expect(teams).toHaveLength(1);
        expect(teams[0]).toMatchObject({ queueNumber: "948", calls: 3, directLine: 3 });
        expect(teams[0].persons[0]).toMatchObject({ extension: "612", calls: 3, viaDirectLine: 3 });
    });

    it("ligne directe : la personne rejoint son équipe principale, avec ses autres appartenances visibles", () => {
        const teams = composerDestinations([
            exit({ firstHop: "person", extension: "790", personName: "Schneider, Matthew", calls: 2 }),
            exit({ firstHop: "queue", queueNumber: "947", queueName: "Gérance GE-G01", extension: "790", personName: "Schneider, Matthew", calls: 3 }),
        ], resoudre, membre);
        expect(teams).toHaveLength(1);
        expect(teams[0]).toMatchObject({ queueNumber: "947", calls: 5, directLine: 2 });
        expect(teams[0].persons[0]).toMatchObject({ extension: "790", calls: 5, viaDirectLine: 2, alsoIn: ["Gérance GE-G05"] });
    });

    it("personne sans équipe, numéro externe, destination introuvable : chacun son regroupement", () => {
        const teams = composerDestinations([
            exit({ firstHop: "person", extension: "999", personName: "Inconnu, X", calls: 1 }),
            exit({ firstHop: "external", calls: 4 }),
            exit({ firstHop: "none", calls: 2 }),
            exit({ firstHop: "queue", queueNumber: null, calls: 1 }),
        ], resoudre, membre);
        const parKind = Object.fromEntries(teams.map((t) => [t.kind, t]));
        expect(parKind.no_team).toMatchObject({ queueName: LIBELLES_REGROUPEMENTS.no_team, calls: 1, directLine: 1 });
        expect(parKind.no_team.persons[0].extension).toBe("999");
        expect(parKind.external).toMatchObject({ calls: 4, persons: [] });
        expect(parKind.unknown).toMatchObject({ calls: 3, persons: [] });
    });

    it("un visage ne s'affiche que sous une équipe dont la personne est MEMBRE", () => {
        // Cas réel du 25 août 2026 : la Réception Pully passe un appel à
        // Lulzim Adzami (Gérance PU-C03), qu'elle n'a jamais sonné. L'appel
        // reste sur la ligne de la réception, mais sans son visage.
        const teams = composerDestinations([
            exit({ outcome: "overflow", firstHop: "queue", queueNumber: "900", queueName: "Réception Pully", extension: "100", personName: "Sequeiros, Lucia", calls: 19 }),
            exit({ outcome: "overflow", firstHop: "queue", queueNumber: "900", queueName: "Réception Pully", extension: "151", personName: "Adzami, Lulzim", calls: 1 }),
        ], () => null, (ext) => ext === "100");
        expect(teams[0].calls).toBe(20);
        expect(teams[0].persons.map((p) => p.extension)).toEqual(["100"]);
    });

    it("une ligne peut porter plus d'appels que ses visages : un débordement sans preneur ne nomme personne", () => {
        const teams = composerDestinations([
            exit({ outcome: "overflow", firstHop: "queue", queueNumber: "900", queueName: "R", extension: "100", personName: "S", calls: 19 }),
            exit({ outcome: "overflow", firstHop: "queue", queueNumber: "900", queueName: "R", extension: "106", personName: "P", calls: 13 }),
            exit({ outcome: "overflow", firstHop: "queue", queueNumber: "900", queueName: "R", calls: 3 }),
        ], () => null, membre);
        expect(teams[0].calls).toBe(35);
        expect(teams[0].persons.reduce((a, p) => a + p.calls, 0)).toBe(32);
    });

    it("conservation : chaque appel parti tombe dans exactement une ligne", () => {
        const exits = [
            exit({ outcome: "overflow", firstHop: "queue", queueNumber: "900", queueName: "R", calls: 28 }),
            exit({ firstHop: "person", extension: "221", personName: "Mermoud", calls: 7 }),
            exit({ firstHop: "queue", queueNumber: "958", queueName: "SC", extension: "365", personName: "V", calls: 5 }),
            exit({ firstHop: "external", calls: 3 }),
            exit({ firstHop: "none", calls: 1 }),
        ];
        const teams = composerDestinations(exits, resoudre, membre);
        const total = exits.reduce((acc, e) => acc + e.calls, 0);
        expect(teams.reduce((acc, t) => acc + t.calls, 0)).toBe(total);
        expect(teams.reduce((acc, t) => acc + t.overflow, 0)).toBe(28);
    });

    it("un poste réattribué sur la période fait deux visages, un même titulaire n'en fait qu'un", () => {
        const teams = composerDestinations([
            exit({ firstHop: "queue", queueNumber: "993", queueName: "G", extension: "139", personName: "Robert-Charrue, A.", calls: 4 }),
            exit({ firstHop: "queue", queueNumber: "993", queueName: "G", extension: "139", personName: "Thaqi, Arlind", calls: 6 }),
            exit({ outcome: "overflow", firstHop: "queue", queueNumber: "993", queueName: "G", extension: "139", personName: "Thaqi, Arlind", calls: 2 }),
        ], () => null, membre);
        expect(teams[0].persons.map((p) => [p.name, p.calls])).toEqual([["Thaqi, Arlind", 8], ["Robert-Charrue, A.", 4]]);
    });

    it("tri par volume, personnes triées par volume dans chaque ligne", () => {
        const teams = composerDestinations([
            exit({ firstHop: "queue", queueNumber: "958", queueName: "SC", extension: "355", personName: "Casas", calls: 2 }),
            exit({ firstHop: "queue", queueNumber: "958", queueName: "SC", extension: "365", personName: "Valente", calls: 9 }),
            exit({ firstHop: "queue", queueNumber: "900", queueName: "R", extension: "100", personName: "Sequeiros", calls: 30 }),
        ], resoudre, membre);
        expect(teams.map((t) => t.queueNumber)).toEqual(["900", "958"]);
        expect(teams[1].persons.map((p) => p.extension)).toEqual(["365", "355"]);
    });
});

describe("règle de périmètre sur les destinations", () => {
    const teams = composerDestinations([
        exit({ firstHop: "queue", queueNumber: "900", queueName: "R", extension: "100", personName: "S", calls: 30 }),
        exit({ firstHop: "queue", queueNumber: "958", queueName: "SC", extension: "365", personName: "V", calls: 9 }),
        exit({ firstHop: "external", calls: 3 }),
    ], () => null, membre);
    const dansPerimetre = (n: string) => n === "900";

    it("« name » : nommées, périmètre annoté", () => {
        const r = appliquerPerimetreDestinations(teams, dansPerimetre, "name");
        expect(r.map((t) => [t.queueNumber, t.inScope])).toEqual([["900", true], ["958", false], [null, true]]);
    });

    it("« anonymize » : fondues en un regroupement SANS visages, les autres regroupements intacts", () => {
        const r = appliquerPerimetreDestinations(teams, dansPerimetre, "anonymize");
        expect(r.map((t) => t.kind)).toEqual(["team", "out_of_scope", "external"]);
        expect(r[1]).toMatchObject({ queueName: LIBELLES_REGROUPEMENTS.out_of_scope, calls: 9, persons: [], inScope: false });
    });
});

describe("lien d'un visage vers les journaux", () => {
    it("nos appels partis (directs compris), pris en charge par la personne", () => {
        const url = new URL(lienJournauxPersonne({
            queueNumber: "958", personName: "Ali Abukar, Fahima", startDate: "2026-08-01", endDate: "2026-08-31", origin: "both",
        }), "http://localhost");
        expect(url.pathname).toBe("/admin/logs");
        expect(url.searchParams.get("queueOutcome")).toBe(`958:${DEPARTED_OUTCOMES.join(",")}:team`);
        expect(url.searchParams.get("handledBy")).toBe("Ali Abukar, Fahima");
        expect(url.searchParams.get("origin")).toBe("both");
    });
});
