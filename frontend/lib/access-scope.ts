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

/**
 * Postes autorisés — deux formes, parce qu'il y a deux besoins.
 *
 * `only` : la liste EXPLICITE des agents des files du périmètre. C'est le
 * manager : il voit ses agents, personne d'autre.
 *
 * `allExcept` : TOUS les postes du tenant sauf ceux listés. C'est le rôle
 * global : ses exclus sont les agents exclusifs des files hors périmètre —
 * les collaborateurs des clients hébergés. Exprimé en négatif à dessein :
 *   - un poste inconnu de l'annuaire (aucun appel depuis douze mois) reste
 *     visible, là où une liste positive l'aurait silencieusement effacé des
 *     périodes anciennes ;
 *   - la liste tient en quelques dizaines de valeurs au lieu de plusieurs
 *     centaines, et se calcule sans consulter l'annuaire des postes.
 */
export type ExtensionScope =
    | { kind: "only"; numbers: string[] }
    | { kind: "allExcept"; numbers: string[] };

/** Un poste donné est-il dans la portée ? Le pendant de `isQueueInScope`. */
export function isExtensionInScope(scope: AccessScope, extensionNumber: string): boolean {
    if (scope.unrestricted) return true;
    if (scope.empty) return false;
    return scope.extensions.kind === "only"
        ? scope.extensions.numbers.includes(extensionNumber)
        : !scope.extensions.numbers.includes(extensionNumber);
}

export interface AccessScope {
    /**
     * true = aucune restriction de files. Ne subsiste QUE lorsque le filtrage
     * global est désactivé (mode observation) ou pour les vues d'infrastructure
     * (monitoring de licence). Depuis août 2026, aucun rôle ne l'obtient : un
     * ADMIN voit son périmètre, comme tout le monde.
     */
    unrestricted: boolean;
    /** Files autorisées. `null` = toutes. */
    queueNumbers: string[] | null;
    /**
     * Postes autorisés, cf. ExtensionScope.
     *
     * ⚠️ Reconnus en DESTINATION uniquement par les filtres SQL : un appel
     * reçu par un agent du périmètre est visible, un appel qu'il émet vers
     * l'extérieur du périmètre ne l'est pas. Sans conséquence tant que les
     * écrans ne montrent que le flux entrant ; à revoir pour un tableau de
     * bord des sortants (cf. buildScopeFilter et le filtre des journaux).
     */
    extensions: ExtensionScope;
    /** Masquer les numéros des appelants (nLPD/RGPD) */
    maskPhoneNumbers: boolean;
    /**
     * Peut consulter les journaux sans se restreindre à une file (« vue
     * Entreprise »). Affordance d'INTERFACE, pas une étendue de données : la
     * population reste bornée par le périmètre dans tous les cas.
     */
    canBrowseAllQueues: boolean;
    /**
     * Autorisé à consulter les logs d'appels (écran + liens des KPI).
     * Distinct de `empty` : c'est un droit d'accès à la FONCTION, pas une
     * étendue de données — un manager sans ce droit garde ses statistiques.
     */
    canViewLogs: boolean;
    /** Autorisé à consulter l'écran Extension / DDI — même logique que les logs. */
    canViewExtensionStats: boolean;
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

/**
 * Portée sans restriction — le filtrage global désactivé (mode observation),
 * et les vues d'INFRASTRUCTURE qui doivent voir la machine entière : le
 * monitoring de licence compte les appels simultanés du tenant, clients
 * hébergés compris, puisque ce sont eux qui occupent les lignes 3CX.
 */
export function unrestrictedScope(): AccessScope {
    return {
        unrestricted: true,
        queueNumbers: null,
        extensions: { kind: "allExcept", numbers: [] },
        maskPhoneNumbers: false,
        canBrowseAllQueues: true,
        canViewLogs: true,
        canViewExtensionStats: true,
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
        extensions: { kind: "only", numbers: [] },
        maskPhoneNumbers,
        canBrowseAllQueues: false,
        canViewLogs: true,
        canViewExtensionStats: true,
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
            canViewExtensionStats: true,
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

    // AGENT : aucun accès pour l'instant.
    if (user.role === "AGENT") return emptyScope(maskPhoneNumbers);

    // Périmètre EXPLICITE de files — pour tous les rôles qui consultent.
    // L'ADMIN et le MODERATOR en ont un comme les managers depuis août 2026 :
    // le contournement par le rôle (« tout voir ») rendait impossible de
    // sortir les clients hébergés des chiffres autrement qu'en supprimant
    // leurs appels de TOUTES les vues, journaux compris — un mécanisme
    // exclusif qui faisait disparaître aussi la part travaillée par nos
    // équipes sur les appels mixtes.
    const perimeter = await prismaAuth.userQueuePerimeter.findMany({
        where: { userId, queue: { tenantId } },
        select: { queue: { select: { queueNumber: true } } },
    });
    const queueNumbers = perimeter.map((p) => p.queue.queueNumber);

    // ADMIN / MODERATOR : leurs files, mais TOUS les postes du tenant — y
    // compris ceux qui n'appartiennent à aucune file (direction, back-office :
    // ~188 postes recensés en août 2026), que personne ne verrait autrement.
    // Seuls les agents EXCLUSIFS des files hors périmètre restent dehors : ce
    // sont les collaborateurs des clients hébergés.
    const globalRole = user.role === "ADMIN" || user.role === "MODERATOR";
    if (globalRole) {
        if (queueNumbers.length === 0) return emptyScope(maskPhoneNumbers);
        return {
            unrestricted: false,
            queueNumbers,
            extensions: { kind: "allExcept", numbers: await resolveForeignExtensions(tenantId, queueNumbers) },
            maskPhoneNumbers,
            canBrowseAllQueues: true,
            canViewLogs: user.canViewLogs,
            canViewExtensionStats: user.canViewExtensionStats,
            empty: false,
        };
    }

    // MANAGER : périmètre explicite de files + extensions qui en découlent.
    if (queueNumbers.length === 0) {
        // Un manager sans périmètre peut tout de même avoir des surcharges.
        const onlyOverrides = await resolveExtensions(userId, tenantId, []);
        if (onlyOverrides.length === 0) return emptyScope(maskPhoneNumbers);
        return {
            unrestricted: false,
            queueNumbers: [],
            extensions: { kind: "only", numbers: onlyOverrides },
            maskPhoneNumbers,
            canBrowseAllQueues: false,
            canViewLogs: user.canViewLogs,
            canViewExtensionStats: user.canViewExtensionStats,
            empty: false,
        };
    }

    const extensionNumbers = await resolveExtensions(userId, tenantId, queueNumbers);

    return {
        unrestricted: false,
        queueNumbers,
        extensions: { kind: "only", numbers: extensionNumbers },
        maskPhoneNumbers,
        canBrowseAllQueues: false,
        canViewLogs: user.canViewLogs,
        canViewExtensionStats: user.canViewExtensionStats,
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

/**
 * Postes ÉTRANGERS à un rôle global : les agents EXCLUSIFS des files hors
 * périmètre — c'est-à-dire les collaborateurs des clients hébergés.
 *
 * « Exclusif » est la nuance qui protège les postes mixtes : un collaborateur
 * qui sert à la fois une file du périmètre et celle d'un client reste nôtre —
 * son travail pour nous ne doit pas disparaître.
 *
 * Ne consulte QUE les liens file/agent, déjà en cache et préchauffés au
 * démarrage : la résolution de portée tourne à chaque requête, elle ne doit
 * jamais déclencher de balayage de CDR.
 */
async function resolveForeignExtensions(tenantId: ServerId, perimeterQueues: string[]): Promise<string[]> {
    try {
        const { getQueueMembersRaw } = await import("@/services/repositories/cdr.repository");
        const members = await getQueueMembersRaw(tenantId);

        const inPerimeter = new Set(perimeterQueues);
        const insiders = new Set<string>();
        const foreign = new Set<string>();
        for (const row of members) {
            (inPerimeter.has(row.queue_number) ? insiders : foreign).add(row.agent_extension);
        }
        for (const ext of insiders) foreign.delete(ext);
        return [...foreign];
    } catch {
        // Annuaire indisponible : n'exclure personne plutôt que de masquer à
        // tort — la portée reste bornée par les files du périmètre.
        return [];
    }
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
