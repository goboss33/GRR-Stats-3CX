import { describe, it, expect, beforeAll } from "vitest";
import { sealSecret, openSecret } from "./secret-box";

// Le helper lit le secret À CHAQUE appel : le poser ici suffit, sans toucher
// à l'environnement réel.
beforeAll(() => {
    process.env.XAPI_ENCRYPTION_KEY = "secret-de-test-pour-le-coffre";
});

describe("secret-box — aller-retour", () => {
    it("rend exactement ce qui a été confié", () => {
        const cle = "3cx-xapi-Kj8#mZ_2026/abc+def=";
        expect(openSecret(sealSecret(cle))).toBe(cle);
    });

    it("supporte l'accentué et l'unicode", () => {
        const valeur = "clé-à-péage-日本語-🔑";
        expect(openSecret(sealSecret(valeur))).toBe(valeur);
    });

    it("deux chiffrements du même secret diffèrent (IV aléatoire)", () => {
        // Sinon deux tenants partageant la même clé seraient reconnaissables
        // à l'œil dans un export de la base.
        expect(sealSecret("identique")).not.toBe(sealSecret("identique"));
    });
});

describe("secret-box — dégradation sans exception", () => {
    it("valeur absente → null", () => {
        expect(openSecret(null)).toBeNull();
        expect(openSecret(undefined)).toBeNull();
        expect(openSecret("")).toBeNull();
    });

    it("format inconnu → null plutôt qu'une erreur", () => {
        expect(openSecret("pas-du-tout-chiffre")).toBeNull();
        expect(openSecret("deux.parties")).toBeNull();
    });

    it("chiffré trafiqué → null (l'authentification GCM le détecte)", () => {
        const scelle = sealSecret("clé-authentique");
        const [iv, tag] = scelle.split(".");
        const trafique = [iv, tag, Buffer.from("charge-substituee").toString("base64url")].join(".");
        expect(openSecret(trafique)).toBeNull();
    });

    it("secret de chiffrement changé → null, jamais une clé fausse", () => {
        // Cas réel : rotation de NEXTAUTH_SECRET. L'écran doit afficher
        // « aucune clé » et inviter à ressaisir, pas appeler le 3CX avec une
        // valeur corrompue.
        const scelle = sealSecret("clé-d-origine");
        process.env.XAPI_ENCRYPTION_KEY = "un-autre-secret";
        expect(openSecret(scelle)).toBeNull();
        process.env.XAPI_ENCRYPTION_KEY = "secret-de-test-pour-le-coffre";
    });
});
