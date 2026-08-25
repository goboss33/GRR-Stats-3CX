/**
 * Coffre à secrets — chiffrement réversible des credentials SORTANTS.
 *
 * À ne pas confondre avec le hachage des clés API ENTRANTES (ApiKey.keyHash,
 * bcrypt) : une clé qu'on reçoit se vérifie sans jamais être relue, alors
 * qu'une clé qu'on PRÉSENTE à un tiers (la clé XAPI du 3CX) doit pouvoir être
 * relue en clair au moment de l'appel. D'où AES-256-GCM plutôt qu'un hachage.
 *
 * Implémenté sur l'API WebCrypto (globalThis.crypto.subtle), disponible dans
 * Node comme dans le runtime edge : AUCUN import — le module `node:crypto`
 * cassait la compilation edge d'instrumentation.ts (schéma « node: » que
 * webpack ne résout pas), alors que le format produit ici est identique octet
 * pour octet (« iv.tag.chiffré » en base64url) : les valeurs déjà stockées
 * restent lisibles.
 *
 * Le GCM authentifie le chiffré : une valeur trafiquée en base est rejetée au
 * déchiffrement au lieu de produire une clé silencieusement fausse.
 *
 * ⚠️ La clé de chiffrement dérive de `XAPI_ENCRYPTION_KEY` si elle existe,
 * sinon de `NEXTAUTH_SECRET` (toujours présent, sinon l'application ne
 * démarre pas). Conséquence à connaître : faire tourner ce secret rend les
 * clés stockées illisibles — il faut alors les ressaisir dans les réglages.
 * Poser `XAPI_ENCRYPTION_KEY` en propre isole les deux cycles de vie.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;

function toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
    const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function encryptionKey(): Promise<CryptoKey> {
    const secret = process.env.XAPI_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET;
    if (!secret) {
        throw new Error(
            "Chiffrement indisponible : ni XAPI_ENCRYPTION_KEY ni NEXTAUTH_SECRET n'est défini.",
        );
    }
    // SHA-256 du secret : ramène n'importe quelle longueur aux 32 octets
    // exigés par AES-256, de façon déterministe.
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Chiffre une valeur ; format « iv.tag.chiffré », le tout en base64url. */
export async function sealSecret(plain: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await encryptionKey();
    // WebCrypto renvoie « chiffré || tag » concaténés : on sépare le tag pour
    // conserver le format historique à trois segments.
    const sealed = new Uint8Array(await crypto.subtle.encrypt(
        { name: "AES-GCM", iv }, key, new TextEncoder().encode(plain),
    ));
    const payload = sealed.slice(0, sealed.length - TAG_BYTES);
    const tag = sealed.slice(sealed.length - TAG_BYTES);
    return [iv, tag, payload].map(toBase64Url).join(".");
}

/**
 * Déchiffre une valeur produite par sealSecret.
 * Renvoie `null` si le format est invalide, la valeur trafiquée, ou le secret
 * de chiffrement changé — jamais d'exception : un credential illisible doit
 * dégrader vers « non configuré », pas casser l'écran des réglages.
 */
export async function openSecret(sealed: string | null | undefined): Promise<string | null> {
    if (!sealed) return null;
    const parts = sealed.split(".");
    if (parts.length !== 3) return null;
    try {
        const [iv, tag, payload] = parts.map(fromBase64Url);
        const combined = new Uint8Array(new ArrayBuffer(payload.length + tag.length));
        combined.set(payload);
        combined.set(tag, payload.length);
        const key = await encryptionKey();
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, combined);
        return new TextDecoder().decode(plain);
    } catch {
        return null;
    }
}
