/**
 * Microsoft Graph — la partie PURE du diagnostic, sans réseau ni secret.
 *
 * Importable depuis un composant client (la modale de réglages s'en sert pour
 * dire « expire dans 12 jours ») : rien ici ne touche à `node:*`, à Prisma ni
 * au coffre. Tout ce qui parle au réseau vit dans lib/graph-client.
 */

/**
 * Les deux permissions d'APPLICATION dont l'annuaire a besoin.
 *
 * `User.ReadBasic.All` ne suffit pas : son profil de base couvre nom, prénom,
 * e-mail et photo, mais PAS le titre de poste. `ProfilePhoto.Read.All` est
 * distincte : sans elle, la lecture d'une photo répond 403 même avec
 * `User.Read.All`.
 */
export const ROLES_GRAPH_REQUIS = ["User.Read.All", "ProfilePhoto.Read.All"] as const;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAINE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/**
 * ID de l'annuaire (locataire) : un GUID, ou un domaine vérifié du tenant
 * (« contoso.onmicrosoft.com ») — Microsoft accepte les deux dans l'URL de
 * jeton. Renvoie null si inexploitable.
 */
export function normaliserTenantId(raw: string): string | null {
    const v = raw.trim().toLowerCase();
    if (!v) return null;
    return GUID.test(v) || DOMAINE.test(v) ? v : null;
}

/** ID d'application (client) : toujours un GUID. */
export function normaliserClientId(raw: string): string | null {
    const v = raw.trim().toLowerCase();
    if (!v) return null;
    return GUID.test(v) ? v : null;
}

/**
 * Traduit les codes d'erreur du point d'entrée de jeton (AADSTS…) en phrase
 * qui dit QUOI FAIRE. Le code brut reste en fin de phrase : c'est ce qu'on
 * cherche dans la documentation Microsoft quand la phrase ne suffit pas.
 */
export function expliquerErreurJeton(codes: number[], description: string | null): string {
    const code = codes[0];
    const brut = description ? ` (${description.split(/\r?\n/)[0].slice(0, 160)})` : "";
    switch (code) {
        case 7000222:
            return "Le secret client a EXPIRÉ : créez-en un nouveau dans Entra (Certificats et secrets), puis enregistrez-le ici." + brut;
        case 7000215:
            return "Secret client refusé : la valeur collée n'est pas celle d'Entra (attention à copier la colonne « Valeur », pas « ID du secret »)." + brut;
        case 700016:
            return "Application introuvable dans cet annuaire : vérifiez l'ID d'application (client) et l'ID de l'annuaire." + brut;
        case 90002:
            return "Annuaire introuvable : l'ID de l'annuaire (locataire) est faux." + brut;
        case 700024:
            return "Le secret n'est pas dans sa période de validité." + brut;
        default:
            return `Microsoft a refusé la demande de jeton${brut || (code ? ` (code ${code})` : "")}.`;
    }
}

/**
 * Compare les permissions PORTÉES PAR LE JETON (claim `roles`) à celles
 * requises. Un jeton sans aucun rôle est le symptôme classique d'un
 * consentement d'administrateur pas encore accordé : les permissions sont
 * listées dans Entra, mais personne n'a cliqué « Accorder ».
 */
export function diagnostiquerRoles(roles: string[]): { accordes: string[]; manquants: string[] } {
    const presents = new Set(roles.map((r) => r.trim()));
    return {
        accordes: ROLES_GRAPH_REQUIS.filter((r) => presents.has(r)),
        manquants: ROLES_GRAPH_REQUIS.filter((r) => !presents.has(r)),
    };
}

/**
 * Lit le claim `roles` d'un jeton d'accès, SANS vérifier la signature — c'est
 * un outil de diagnostic (« voici ce que Microsoft déclare avoir accordé »),
 * pas un contrôle de sécurité.
 */
export function decoderRoles(accessToken: string): string[] {
    const parts = accessToken.split(".");
    if (parts.length !== 3) return [];
    try {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const payload = JSON.parse(atob(base64)) as { roles?: unknown };
        return Array.isArray(payload.roles) ? payload.roles.filter((r): r is string => typeof r === "string") : [];
    } catch {
        return [];
    }
}

/** Au-dessous de ce délai, on prévient : un secret se renouvelle dans Entra, pas en urgence. */
export const JOURS_PREAVIS_SECRET = 30;

export type EtatSecret =
    | { etat: "inconnu"; joursRestants: null }
    | { etat: "valide" | "bientot" | "expire"; joursRestants: number };

/**
 * Où en est le secret par rapport à la date d'expiration DÉCLARÉE par
 * l'administrateur ? (Graph ne la laisse pas lire sans Application.Read.All,
 * une permission large sur toutes les inscriptions — on préfère la demander.)
 */
export function etatSecret(expiresAt: Date | string | null | undefined, now: Date = new Date()): EtatSecret {
    if (!expiresAt) return { etat: "inconnu", joursRestants: null };
    const fin = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
    if (Number.isNaN(fin.getTime())) return { etat: "inconnu", joursRestants: null };
    const jours = Math.ceil((fin.getTime() - now.getTime()) / 86400000);
    if (jours < 0) return { etat: "expire", joursRestants: jours };
    if (jours <= JOURS_PREAVIS_SECRET) return { etat: "bientot", joursRestants: jours };
    return { etat: "valide", joursRestants: jours };
}
