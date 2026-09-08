/**
 * Client XAPI 3CX (v20) — première brique : l'obtention du jeton.
 *
 * L'API de configuration s'authentifie en OAuth2 « client credentials » : on
 * présente l'ID CLIENT et la CLÉ du principal de service à /connect/token, et
 * on reçoit un jeton de courte durée à porter sur les appels suivants. La clé
 * n'est donc jamais envoyée aux points d'entrée métier.
 *
 * DOCTRINE : rien ici ne doit devenir indispensable. Chaque échec est une
 * valeur de retour, jamais une exception qui remonterait jusqu'à un écran —
 * l'application doit continuer de fonctionner sur le socle CDR quoi qu'il
 * arrive au PBX.
 */

/** Délai au-delà duquel on considère le PBX injoignable (ms). */
const TIMEOUT_MS = 10_000;

/**
 * UN jeton par (PBX, ID client, clé), partagé par tous les appelants — le
 * relevé nocturne du journal, l'échantillonnage de présence à la minute, le
 * test des réglages. Vérifié le 8 sept. 2026 : le 3CX INVALIDE le jeton
 * précédent dès qu'il en émet un nouveau pour le même principal de service ;
 * deux appelants demandant chacun le leur se coupaient l'herbe sous le pied à
 * tour de rôle (le journal a fait tomber l'échantillonneur à 16:21:58).
 * Réutilisé tant qu'il lui reste plus que la marge ; jamais mis en cache si
 * le PBX n'annonce pas sa durée de vie.
 */
const JETON_MARGE_S = 120;
const jetons = new Map<string, { token: string; expiresAt: number; expiresInSeconds: number | null }>();

/** Empreinte courte de la clé pour la clé de cache — pas une protection, une distinction. */
function empreinte(texte: string): string {
    let h = 5381;
    for (let i = 0; i < texte.length; i++) h = ((h * 33) ^ texte.charCodeAt(i)) >>> 0;
    return h.toString(16);
}

function cleJeton(origin: string, clientId: string, apiKey: string): string {
    return `${origin}|${clientId.trim()}|${empreinte(apiKey)}`;
}

/**
 * Oublie le jeton partagé de ce principal — à appeler après un 401 sur un
 * appel métier (jeton révoqué par une émission concurrente, ou périmé côté
 * PBX) : le prochain requestXapiToken en obtient un frais.
 */
export function forgetXapiToken(baseUrl: string, clientId: string): void {
    const origin = normalizeXapiBaseUrl(baseUrl);
    if (!origin) return;
    const prefixe = `${origin}|${clientId.trim()}|`;
    for (const cle of [...jetons.keys()]) {
        if (cle.startsWith(prefixe)) jetons.delete(cle);
    }
}

export type XapiTokenResult =
    | { ok: true; accessToken: string; expiresInSeconds: number | null }
    | { ok: false; reason: string };

/**
 * Normalise l'adresse du PBX : protocole obligatoire en HTTPS (on y envoie un
 * credential), barre oblique finale retirée. Renvoie null si inexploitable.
 */
export function normalizeXapiBaseUrl(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return null;
    }
    if (url.protocol !== "https:") return null;
    // On ne garde que l'origine : un chemin saisi par erreur (« /5001 » au
    // lieu de « :5001 ») ne doit pas se retrouver collé devant /connect/token.
    return url.origin;
}

/**
 * Demande un jeton au PBX. Sert au bouton « Tester la connexion » et, plus
 * tard, à toute lecture XAPI.
 */
export async function requestXapiToken(
    baseUrl: string,
    clientId: string,
    apiKey: string,
): Promise<XapiTokenResult> {
    const origin = normalizeXapiBaseUrl(baseUrl);
    if (!origin) {
        return { ok: false, reason: "Adresse invalide : attendu une URL HTTPS complète, port compris (ex. https://exemple.3cx.ch:5001)." };
    }
    if (!clientId.trim()) return { ok: false, reason: "ID client manquant." };
    if (!apiKey) return { ok: false, reason: "Aucune clé API enregistrée." };

    const cle = cleJeton(origin, clientId, apiKey);
    const enCache = jetons.get(cle);
    if (enCache && enCache.expiresAt > Date.now()) {
        return { ok: true, accessToken: enCache.token, expiresInSeconds: enCache.expiresInSeconds };
    }

    let response: Response;
    try {
        response = await fetch(`${origin}/connect/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "client_credentials",
                client_id: clientId.trim(),
                client_secret: apiKey,
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
            cache: "no-store",
        });
    } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        // Injoignable, DNS, certificat, délai dépassé : on rend le motif brut,
        // c'est ce qui permet à l'administrateur de diagnostiquer.
        return { ok: false, reason: `PBX injoignable (${cause}).` };
    }

    if (!response.ok) {
        // 400/401 = identifiants refusés ; 404 = souvent l'API de
        // configuration non activée sur le principal de service.
        const detail = await response.text().catch(() => "");
        const hint = response.status === 400 || response.status === 401
            ? "ID client ou clé refusés par le PBX."
            : response.status === 404
                ? "Point d'entrée introuvable : vérifier l'adresse et que « Accès à l'API de configuration » est activé."
                : "Réponse inattendue du PBX.";
        return { ok: false, reason: `${hint} (HTTP ${response.status}${detail ? ` — ${detail.slice(0, 200)}` : ""})` };
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        return { ok: false, reason: "Réponse du PBX illisible (JSON attendu)." };
    }

    const token = (payload as { access_token?: unknown })?.access_token;
    if (typeof token !== "string" || !token) {
        return { ok: false, reason: "Réponse du PBX sans jeton d'accès." };
    }
    const expires = (payload as { expires_in?: unknown })?.expires_in;
    const expiresInSeconds = typeof expires === "number" ? expires : null;
    if (expiresInSeconds !== null && expiresInSeconds > 2 * JETON_MARGE_S) {
        jetons.set(cle, { token, expiresAt: Date.now() + (expiresInSeconds - JETON_MARGE_S) * 1000, expiresInSeconds });
    }

    return { ok: true, accessToken: token, expiresInSeconds };
}

/**
 * Claims utiles d'un jeton XAPI, décodés SANS vérification de signature —
 * outil de diagnostic, pas de sécurité : on lit ce que le PBX déclare avoir
 * accordé (rôle du principal de service, sujet, expiration). C'est la pièce
 * à conviction des erreurs 403 : « lecture refusée » + « rôle: Reports »
 * désigne la cause sans deviner.
 */
export function decodeTokenClaims(accessToken: string): Record<string, string> {
    const parts = accessToken.split(".");
    if (parts.length !== 3) return {};
    try {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const payload = JSON.parse(atob(base64)) as Record<string, unknown>;
        const out: Record<string, string> = {};
        for (const [key, value] of Object.entries(payload)) {
            const flat = Array.isArray(value) ? value.join(", ") : value;
            if (typeof flat !== "string" && typeof flat !== "number") continue;
            // Les claims parlantes : rôle (nom complet schéma inclus), sujet,
            // identifiant client. Le reste (nbf, iat, jti…) est du bruit.
            if (/role/i.test(key)) out.role = String(flat);
            else if (key === "sub" || key === "client_id" || key === "name") out[key] = String(flat);
            else if (key === "exp") out.exp = new Date(Number(flat) * 1000).toISOString();
        }
        return out;
    } catch {
        return {};
    }
}
