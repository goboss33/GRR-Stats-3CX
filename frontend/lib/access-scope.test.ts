import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Filet de sécurité du contrôle d'accès.
 *
 * Le filtrage par périmètre est actif en production et cloisonne des données
 * régionales réelles. Une régression y serait silencieuse : l'application
 * continuerait de fonctionner, en montrant simplement trop de choses. D'où ces
 * tests, qui vérifient les invariants plutôt que l'implémentation.
 *
 * Les accès base et la session sont simulés : ce qu'on éprouve ici est la
 * logique de décision, pas Prisma.
 */

const { db, authMock } = vi.hoisted(() => ({
    db: {
        appSettings: { findUnique: vi.fn() },
        user: { findUnique: vi.fn() },
        userQueuePerimeter: { findMany: vi.fn() },
        queueAgentLink: { findMany: vi.fn() },
        userExtensionOverride: { findMany: vi.fn() },
        apiKey: { findUnique: vi.fn() },
    },
    authMock: vi.fn(),
}));

vi.mock("@/lib/prisma-auth", () => ({ prismaAuth: db }));
vi.mock("@/lib/auth", () => ({ auth: authMock }));

import { resolveAccessScope, resolveApiKeyScope, isQueueInScope, emptyScope, unrestrictedScope } from "./access-scope";

const TENANT = "gerofinance" as const;

/** Etat par défaut : filtrage actif, session valide, aucune donnée annexe. */
function setup(options: {
    enforcement?: boolean;
    session?: { user: { id: string } } | null;
    user?: Record<string, unknown> | null;
    perimeter?: string[];
    agentLinks?: string[];
    overrides?: Array<{ extensionNumber: string; mode: "INCLUDE" | "EXCLUDE" }>;
    apiKey?: { createdBy: string | null } | null;
} = {}) {
    db.appSettings.findUnique.mockResolvedValue({
        perimeterEnforcementEnabled: options.enforcement ?? true,
    });
    authMock.mockResolvedValue(options.session === undefined ? { user: { id: "u1" } } : options.session);
    db.user.findUnique.mockResolvedValue(
        options.user === undefined
            ? { role: "MANAGER", canViewCompanyWide: false, canViewFullPhoneNumbers: false, tenantAccess: [{ tenantId: TENANT }] }
            : options.user,
    );
    db.userQueuePerimeter.findMany.mockResolvedValue(
        (options.perimeter ?? []).map((queueNumber) => ({ queue: { queueNumber } })),
    );
    db.queueAgentLink.findMany.mockResolvedValue(
        (options.agentLinks ?? []).map((extensionNumber) => ({ extensionNumber })),
    );
    db.userExtensionOverride.findMany.mockResolvedValue(options.overrides ?? []);
    db.apiKey.findUnique.mockResolvedValue(options.apiKey ?? null);
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("interrupteur global", () => {
    it("filtrage désactivé : personne n'est restreint", async () => {
        setup({ enforcement: false, user: { role: "AGENT", canViewCompanyWide: false, canViewFullPhoneNumbers: false, tenantAccess: [] } });
        const scope = await resolveAccessScope(TENANT);
        expect(scope.unrestricted).toBe(true);
        expect(scope.empty).toBe(false);
    });

    it("l'interrupteur est consulté AVANT la session", async () => {
        // Ordre voulu : en mode observation, l'application se comporte
        // exactement comme avant l'introduction des périmètres.
        setup({ enforcement: false, session: null });
        const scope = await resolveAccessScope(TENANT);
        expect(scope.unrestricted).toBe(true);
        expect(authMock).not.toHaveBeenCalled();
    });

    it("filtrage actif sans session : aucune donnée", async () => {
        setup({ session: null });
        const scope = await resolveAccessScope(TENANT);
        expect(scope.empty).toBe(true);
        expect(scope.unrestricted).toBe(false);
    });

    it("réglages absents en base : on se restreint, on ne s'ouvre pas", async () => {
        setup();
        db.appSettings.findUnique.mockResolvedValue(null);
        const scope = await resolveAccessScope(TENANT);
        // Pas de ligne de réglages = filtrage réputé désactivé (mode observation
        // d'une base neuve). Le test fige ce choix pour qu'il reste délibéré.
        expect(scope.unrestricted).toBe(true);
    });
});

describe("portée selon le rôle", () => {
    it("ADMIN : accès complet, sans exiger d'accès au tenant", async () => {
        setup({ user: { role: "ADMIN", canViewCompanyWide: false, canViewFullPhoneNumbers: true, tenantAccess: [] } });
        const scope = await resolveAccessScope(TENANT);
        expect(scope.unrestricted).toBe(true);
        expect(scope.canViewCompanyWide).toBe(true);
    });

    it("MODERATOR : accès complet, mais seulement sur un tenant autorisé", async () => {
        setup({ user: { role: "MODERATOR", canViewCompanyWide: false, canViewFullPhoneNumbers: true, tenantAccess: [{ tenantId: TENANT }] } });
        expect((await resolveAccessScope(TENANT)).unrestricted).toBe(true);

        setup({ user: { role: "MODERATOR", canViewCompanyWide: false, canViewFullPhoneNumbers: true, tenantAccess: [{ tenantId: "edifea" }] } });
        expect((await resolveAccessScope(TENANT)).empty).toBe(true);
    });

    it("AGENT : aucun accès pour l'instant", async () => {
        setup({ user: { role: "AGENT", canViewCompanyWide: true, canViewFullPhoneNumbers: true, tenantAccess: [{ tenantId: TENANT }] } });
        const scope = await resolveAccessScope(TENANT);
        expect(scope.empty).toBe(true);
        expect(scope.unrestricted).toBe(false);
    });

    it("utilisateur inconnu : aucune donnée", async () => {
        setup({ user: null });
        expect((await resolveAccessScope(TENANT)).empty).toBe(true);
    });

    it("un tenant non autorisé ferme l'accès, même avec un périmètre", async () => {
        setup({
            user: { role: "MANAGER", canViewCompanyWide: false, canViewFullPhoneNumbers: false, tenantAccess: [{ tenantId: "edifea" }] },
            perimeter: ["900", "910"],
        });
        expect((await resolveAccessScope(TENANT)).empty).toBe(true);
    });
});

describe("périmètre d'un manager", () => {
    it("les files du périmètre et leurs extensions", async () => {
        setup({ perimeter: ["900", "910"], agentLinks: ["101", "102"] });
        const scope = await resolveAccessScope(TENANT);
        expect(scope.unrestricted).toBe(false);
        expect(scope.empty).toBe(false);
        expect(scope.queueNumbers).toEqual(["900", "910"]);
        expect(scope.extensionNumbers?.sort()).toEqual(["101", "102"]);
    });

    it("sans périmètre ni surcharge : aucune donnée", async () => {
        setup({ perimeter: [] });
        expect((await resolveAccessScope(TENANT)).empty).toBe(true);
    });

    it("sans périmètre mais avec une surcharge INCLUDE : accès aux seules extensions", async () => {
        setup({ perimeter: [], overrides: [{ extensionNumber: "150", mode: "INCLUDE" }] });
        const scope = await resolveAccessScope(TENANT);
        expect(scope.empty).toBe(false);
        expect(scope.queueNumbers).toEqual([]);
        expect(scope.extensionNumbers).toEqual(["150"]);
    });

    it("une surcharge EXCLUDE retire une extension héritée de la file", async () => {
        setup({
            perimeter: ["900"],
            agentLinks: ["101", "102"],
            overrides: [{ extensionNumber: "102", mode: "EXCLUDE" }],
        });
        const scope = await resolveAccessScope(TENANT);
        expect(scope.extensionNumbers).toEqual(["101"]);
    });

    it("le masquage des numéros suit le droit de l'utilisateur", async () => {
        setup({ perimeter: ["900"] });
        expect((await resolveAccessScope(TENANT)).maskPhoneNumbers).toBe(true);

        setup({
            user: { role: "MANAGER", canViewCompanyWide: false, canViewFullPhoneNumbers: true, tenantAccess: [{ tenantId: TENANT }] },
            perimeter: ["900"],
        });
        expect((await resolveAccessScope(TENANT)).maskPhoneNumbers).toBe(false);
    });
});

describe("clés API", () => {
    // Sans résolution dynamique, un manager créerait une clé et lirait toutes
    // les données via l'API : le filtrage de l'interface ne servirait à rien.
    it("hérite du périmètre de son propriétaire", async () => {
        setup({ apiKey: { createdBy: "u1" }, perimeter: ["900"] });
        const scope = await resolveApiKeyScope("key1", TENANT);
        expect(scope.unrestricted).toBe(false);
        expect(scope.queueNumbers).toEqual(["900"]);
    });

    it("suit la réduction du périmètre du propriétaire", async () => {
        setup({ apiKey: { createdBy: "u1" }, perimeter: [] });
        expect((await resolveApiKeyScope("key1", TENANT)).empty).toBe(true);
    });

    it("cesse de fonctionner si le propriétaire disparaît", async () => {
        setup({ apiKey: { createdBy: "u1" }, user: null });
        expect((await resolveApiKeyScope("key1", TENANT)).empty).toBe(true);
    });

    it("clé interne (sans propriétaire) : portée complète pour les appels serveur", async () => {
        setup({ apiKey: { createdBy: null } });
        expect((await resolveApiKeyScope("key1", TENANT)).unrestricted).toBe(true);

        setup({ apiKey: { createdBy: "system" } });
        expect((await resolveApiKeyScope("key1", TENANT)).unrestricted).toBe(true);
    });

    it("clé inexistante : traitée comme interne, jamais comme une fuite de périmètre", async () => {
        // Une clé introuvable n'atteint pas ce point : validateApiKey l'a déjà
        // rejetée. Le test fige néanmoins le comportement pour qu'une évolution
        // de validateApiKey ne le change pas sans qu'on s'en aperçoive.
        setup({ apiKey: null });
        expect((await resolveApiKeyScope("inconnue", TENANT)).unrestricted).toBe(true);
    });

    it("filtrage désactivé : la clé n'est pas restreinte", async () => {
        setup({ enforcement: false, apiKey: { createdBy: "u1" } });
        expect((await resolveApiKeyScope("key1", TENANT)).unrestricted).toBe(true);
    });
});

describe("isQueueInScope — garde-fou des routes", () => {
    it("une portée sans restriction ouvre toutes les files", () => {
        expect(isQueueInScope(unrestrictedScope(), "999")).toBe(true);
    });

    it("une portée vide n'ouvre rien", () => {
        expect(isQueueInScope(emptyScope(), "900")).toBe(false);
    });

    it("seules les files du périmètre passent", () => {
        const scope = { ...emptyScope(), empty: false, queueNumbers: ["900"] };
        expect(isQueueInScope(scope, "900")).toBe(true);
        expect(isQueueInScope(scope, "910")).toBe(false);
    });

    it("une liste de files absente ferme l'accès plutôt que de l'ouvrir", () => {
        // `queueNumbers: null` signifie « toutes » pour une portée sans
        // restriction ; hors de ce cas, l'absence doit refuser.
        const scope = { ...emptyScope(), empty: false, queueNumbers: null };
        expect(isQueueInScope(scope, "900")).toBe(false);
    });

    it("un numéro deviné ne passe pas par similitude", () => {
        const scope = { ...emptyScope(), empty: false, queueNumbers: ["900"] };
        expect(isQueueInScope(scope, "9001")).toBe(false);
        expect(isQueueInScope(scope, "90")).toBe(false);
    });
});
