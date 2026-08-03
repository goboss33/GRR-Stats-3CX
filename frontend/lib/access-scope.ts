import { auth } from "@/lib/auth";
import { prismaAuth } from "@/lib/prisma-auth";
import { ServerId } from "@/lib/prisma-cdr";

// ============================================
// PORTÉE D'ACCÈS — ce qu'un utilisateur a le droit de voir
//
// Résolue côté serveur puis passée en PARAMÈTRE OBLIGATOIRE aux services de
// données : un oubli devient une erreur de compilation, pas une fuite silencieuse.
//
// Masquer des éléments d'interface ne constitue pas un contrôle d'accès : seul ce
// filtrage, applique dans la couche données, fait autorité.
// ============================================

export interface AccessScope {
    /** true = aucune restriction de files (ADMIN/MODERATOR, ou filtrage désactivé) */
    unrestricted: boolean;
    /** Files autorisées. `null` = toutes. */
    queueNumbers: string[] | null;
    /** Extensions autorisées. `null` = toutes. */
    extensionNumbers: string[] | null;
    /** Masquer les numéros des appelants (nLPD/RGPD) */
    maskPhoneNumbers: boolean;
    /**
     * Autorisé à consulter les logs d'appels (écran + liens des KPI).
     * Distinct de `empty` : c'est un droit d'accès à la FONCTION, pas une
     * étendue de données — un manager sans ce droit garde ses statistiques.
     */
    canViewLogs: boolean;
    /** true quand l'utilisateur n'a aucun périmètre : il ne doit rien voir. */
    empty: boolean;
}

/**
 * Une file donnée est-elle accessible avec cette portée ?
 *
 * Ce test était recopié à l'identique dans chaque route exposant une file. Une
 * seule copie oubliée suffit à ouvrir un accès : il n'existe donc plus qu'ici,
 * et il est couvert par des tests.
 */
export function isQueueInScope(scope: AccessScope, queueNumber: string): boolean {
    if (scope.unrestricted) return true;
    if (scope.empty) return false;
    return scope.queueNumbers?.includes(queueNumber) ?? false;
}

/** Portée sans restriction — utilisée quand le filtrage global est désactivé. */
export function unrestrictedScope(): AccessScope {
    return {
        unrestricted: true,
        queueNumbers: null,
        extensionNumbers: null,
        maskPhoneNumbers: false,
        canViewLogs: true,
        empty: false,
    };
}

/**
 * Portée vide — l'utilisateur ne voit rien (aucun périmètre attribué).
 * `canViewLogs` reste vrai : une portée vide bloque déjà toutes les DONNÉES ;
 * fermer aussi la fonction transformerait « liste vide » en erreur d'accès.
 */
export function emptyScope(maskPhoneNumbers = true): AccessScope {
    return {
        unrestricted: false,
        queueNumbers: [],
        extensionNumbers: [],
        maskPhoneNumbers,
        canViewLogs: true,
        empty: true,
    };
}

/**
 * Résout la portée de l'utilisateur courant pour un tenant donné.
 *
 * Tant que `perimeterEnforcementEnabled` est faux (mode observation), tout le
 * monde conserve l'accès complet : cela permet de classer les files et d'attribuer
 * les périmètres sans couper l'accès à qui que ce soit.
 */
export async function resolveAccessScope(tenantId: ServerId): Promise<AccessScope> {
    // L'interrupteur est évalué EN PREMIER : tant que le filtrage est désactivé,
    // le comportement reste strictement celui d'avant (mode observation).
    const settings = await prismaAuth.appSettings.findUnique({
        where: { id: "global" },
        select: { perimeterEnforcementEnabled: true },
    });
    if (!settings?.perimeterEnforcementEnabled) return unrestrictedScope();

    // Filtrage actif : sans session, aucune donnée.
    const session = await auth();
    if (!session?.user) return emptyScope();

    return resolveScopeForUser(session.user.id, tenantId);
}

/** Portée d'un utilisateur donné (partagée par la session et les clés API). */
async function resolveScopeForUser(userId: string, tenantId: ServerId): Promise<AccessScope> {
    const user = await prismaAuth.user.findUnique({
        where: { id: userId },
        select: {
            role: true,
            canViewLogs: true,
            canViewFullPhoneNumbers: true,
            tenantAccess: { select: { tenantId: true } },
        },
    });
    if (!user) return emptyScope();

    const maskPhoneNumbers = !user.canViewFullPhoneNumbers;
    const allowedTenants = user.tenantAccess.map((t) => t.tenantId);

    // L'ADMIN n'est pas limité par tenant ; les autres doivent y être autorisés.
    if (user.role !== "ADMIN" && !allowedTenants.includes(tenantId)) {
        return emptyScope(maskPhoneNumbers);
    }

    // ADMIN / MODERATOR : accès global aux données du tenant. Le droit aux
    // logs reste individuel — comme le masquage des numéros, il s'applique
    // quel que soit le rôle.
    if (user.role === "ADMIN" || user.role === "MODERATOR") {
        return {
            unrestricted: true,
            queueNumbers: null,
            extensionNumbers: null,
            maskPhoneNumbers,
            canViewLogs: user.canViewLogs,
            empty: false,
        };
    }

    // AGENT : aucun accès pour l'instant.
    if (user.role === "AGENT") return emptyScope(maskPhoneNumbers);

    // MANAGER : périmètre explicite de files + extensions qui en découlent.
    const perimeter = await prismaAuth.userQueuePerimeter.findMany({
        where: { userId, queue: { tenantId } },
        select: { queue: { select: { queueNumber: true } } },
    });
    const queueNumbers = perimeter.map((p) => p.queue.queueNumber);

    if (queueNumbers.length === 0) {
        // Un manager sans périmètre peut tout de même avoir des surcharges.
        const onlyOverrides = await resolveExtensions(userId, tenantId, []);
        if (onlyOverrides.length === 0) return emptyScope(maskPhoneNumbers);
        return {
            unrestricted: false,
            queueNumbers: [],
            extensionNumbers: onlyOverrides,
            maskPhoneNumbers,
            canViewLogs: user.canViewLogs,
            empty: false,
        };
    }

    const extensionNumbers = await resolveExtensions(userId, tenantId, queueNumbers);

    return {
        unrestricted: false,
        queueNumbers,
        extensionNumbers,
        maskPhoneNumbers,
        canViewLogs: user.canViewLogs,
        empty: false,
    };
}

/**
 * Portée d'une CLÉ API : celle de son propriétaire, résolue à chaque requête.
 *
 * Résolution dynamique et non figée à la création (cf. PRD droits d'accès D11) :
 * si le périmètre du propriétaire est réduit, ses clés le sont aussitôt ; si son
 * compte disparaît, ses clés cessent de fonctionner.
 *
 * Sans cela, un manager créerait une clé et lirait l'intégralité des données via
 * l'API — le filtrage de l'interface ne servirait plus à rien.
 */
export async function resolveApiKeyScope(apiKeyId: string, tenantId: ServerId): Promise<AccessScope> {
    const settings = await prismaAuth.appSettings.findUnique({
        where: { id: "global" },
        select: { perimeterEnforcementEnabled: true },
    });
    if (!settings?.perimeterEnforcementEnabled) return unrestrictedScope();

    const key = await prismaAuth.apiKey.findUnique({
        where: { id: apiKeyId },
        select: { createdBy: true },
    });

    // Clé interne (créée par le système, sans propriétaire) : portée complète.
    // Elle n'est utilisée que par les appels serveur-à-serveur de l'application.
    if (!key?.createdBy || key.createdBy === "system") return unrestrictedScope();

    return resolveScopeForUser(key.createdBy, tenantId);
}

/** Extensions déduites des files du périmètre, surcharges appliquées. */
async function resolveExtensions(userId: string, tenantId: string, queueNumbers: string[]): Promise<string[]> {
    const links = queueNumbers.length
        ? await prismaAuth.queueAgentLink.findMany({
              where: { tenantId, queueNumber: { in: queueNumbers } },
              select: { extensionNumber: true },
          })
        : [];

    const extensions = new Set(links.map((l) => l.extensionNumber));

    const overrides = await prismaAuth.userExtensionOverride.findMany({
        where: { userId, tenantId },
        select: { extensionNumber: true, mode: true },
    });
    for (const o of overrides) {
        if (o.mode === "INCLUDE") extensions.add(o.extensionNumber);
        else extensions.delete(o.extensionNumber);
    }

    return [...extensions];
}
