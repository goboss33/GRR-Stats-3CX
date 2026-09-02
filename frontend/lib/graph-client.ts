import { decoderRoles, expliquerErreurJeton } from "@/lib/graph-diagnostic";

/**
 * Client Microsoft Graph — première brique : le jeton et la sonde.
 *
 * Authentification OAuth2 « client credentials » : l'inscription d'application
 * DÉDIÉE présente son ID et son secret à Entra et reçoit un jeton de courte
 * durée. Le secret ne quitte jamais le serveur.
 *
 * DOCTRINE, la même que pour la XAPI : rien ici ne doit devenir indispensable.
 * Chaque échec est une valeur de retour, jamais une exception jusqu'à un écran.
 * Sans Microsoft 365, les collaborateurs s'affichent avec leurs initiales, et
 * l'application est complète.
 */

const TIMEOUT_MS = 10_000;
const GRAPH = "https://graph.microsoft.com/v1.0";

export type GraphTokenResult =
    | { ok: true; accessToken: string; roles: string[]; expiresInSeconds: number | null }
    | { ok: false; reason: string; codes: number[] };

/** Demande un jeton d'application à Entra pour l'annuaire donné. */
export async function requestGraphToken(
    tenantId: string,
    clientId: string,
    secret: string,
): Promise<GraphTokenResult> {
    if (!tenantId.trim()) return { ok: false, reason: "ID de l'annuaire manquant.", codes: [] };
    if (!clientId.trim()) return { ok: false, reason: "ID d'application manquant.", codes: [] };
    if (!secret) return { ok: false, reason: "Aucun secret client enregistré.", codes: [] };

    let response: Response;
    try {
        response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId.trim())}/oauth2/v2.0/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "client_credentials",
                client_id: clientId.trim(),
                client_secret: secret,
                // « .default » = toutes les permissions d'application consenties
                // sur Graph : c'est le seul scope valable en client credentials.
                scope: "https://graph.microsoft.com/.default",
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
            cache: "no-store",
        });
    } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: `Entra injoignable (${cause}).`, codes: [] };
    }

    let payload: Record<string, unknown> = {};
    try {
        payload = (await response.json()) as Record<string, unknown>;
    } catch {
        return { ok: false, reason: `Réponse d'Entra illisible (HTTP ${response.status}).`, codes: [] };
    }

    if (!response.ok) {
        const codes = Array.isArray(payload.error_codes)
            ? payload.error_codes.filter((c): c is number => typeof c === "number")
            : [];
        const description = typeof payload.error_description === "string" ? payload.error_description : null;
        return { ok: false, reason: expliquerErreurJeton(codes, description), codes };
    }

    const token = payload.access_token;
    if (typeof token !== "string" || !token) {
        return { ok: false, reason: "Réponse d'Entra sans jeton d'accès.", codes: [] };
    }
    return {
        ok: true,
        accessToken: token,
        roles: decoderRoles(token),
        expiresInSeconds: typeof payload.expires_in === "number" ? payload.expires_in : null,
    };
}

export interface SondeGraph {
    /** Lecture de la liste des utilisateurs, titre de poste compris. */
    utilisateurs: "ok" | "refuse" | "erreur";
    /** Le titre de poste est-il bien renvoyé (preuve de User.Read.All, pas ReadBasic) ? */
    titre: boolean;
    /** Lecture d'une photo : « aucune » = permission OK, l'utilisateur n'en a pas. */
    photo: "ok" | "aucune" | "refuse" | "erreur" | "non-teste";
    detail: string | null;
}

/**
 * Éprouve le jeton sur les deux appels dont l'annuaire vivra : la liste des
 * utilisateurs avec leur titre, puis une photo. Un 403 sur l'un ou l'autre
 * désigne la permission manquante sans deviner.
 */
export async function sonderGraph(accessToken: string): Promise<SondeGraph> {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const sonde: SondeGraph = { utilisateurs: "erreur", titre: false, photo: "non-teste", detail: null };

    let premierId: string | null = null;
    try {
        const r = await fetch(`${GRAPH}/users?$top=1&$select=id,displayName,mail,jobTitle`, {
            headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store",
        });
        if (r.status === 403) {
            sonde.utilisateurs = "refuse";
            sonde.detail = "Lecture des utilisateurs refusée (403) : User.Read.All manque, ou le consentement d'administrateur n'a pas été accordé.";
            return sonde;
        }
        if (!r.ok) {
            sonde.detail = `Lecture des utilisateurs : HTTP ${r.status}.`;
            return sonde;
        }
        const body = (await r.json()) as { value?: Record<string, unknown>[] };
        const premier = body.value?.[0];
        sonde.utilisateurs = "ok";
        // Graph renvoie la clé `jobTitle` (même à null) dès que la permission
        // le permet ; avec ReadBasic seul, la propriété n'est pas servie.
        sonde.titre = !!premier && Object.prototype.hasOwnProperty.call(premier, "jobTitle");
        premierId = typeof premier?.id === "string" ? premier.id : null;
    } catch (error) {
        sonde.detail = `Graph injoignable (${error instanceof Error ? error.message : String(error)}).`;
        return sonde;
    }

    if (!premierId) {
        sonde.detail = "Annuaire sans utilisateur : impossible d'éprouver la lecture d'une photo.";
        return sonde;
    }

    try {
        const r = await fetch(`${GRAPH}/users/${encodeURIComponent(premierId)}/photos/96x96/$value`, {
            headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store",
        });
        if (r.ok) sonde.photo = "ok";
        else if (r.status === 404) sonde.photo = "aucune";
        else if (r.status === 403) {
            sonde.photo = "refuse";
            sonde.detail = "Lecture d'une photo refusée (403) : ProfilePhoto.Read.All manque.";
        } else {
            sonde.photo = "erreur";
            sonde.detail = `Lecture d'une photo : HTTP ${r.status}.`;
        }
    } catch (error) {
        sonde.photo = "erreur";
        sonde.detail = `Graph injoignable pendant la lecture d'une photo (${error instanceof Error ? error.message : String(error)}).`;
    }
    return sonde;
}
