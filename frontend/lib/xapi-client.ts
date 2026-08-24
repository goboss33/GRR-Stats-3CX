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

    return {
        ok: true,
        accessToken: token,
        expiresInSeconds: typeof expires === "number" ? expires : null,
    };
}
