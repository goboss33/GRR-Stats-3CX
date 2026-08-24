import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Coffre à secrets — chiffrement réversible des credentials SORTANTS.
 *
 * À ne pas confondre avec le hachage des clés API ENTRANTES (ApiKey.keyHash,
 * bcrypt) : une clé qu'on reçoit se vérifie sans jamais être relue, alors
 * qu'une clé qu'on PRÉSENTE à un tiers (la clé XAPI du 3CX) doit pouvoir être
 * relue en clair au moment de l'appel. D'où AES-256-GCM plutôt qu'un hachage.
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

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function encryptionKey(): Buffer {
    const secret = process.env.XAPI_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET;
    if (!secret) {
        throw new Error(
            "Chiffrement indisponible : ni XAPI_ENCRYPTION_KEY ni NEXTAUTH_SECRET n'est défini.",
        );
    }
    // SHA-256 du secret : ramène n'importe quelle longueur aux 32 octets
    // exigés par AES-256, de façon déterministe.
    return createHash("sha256").update(secret).digest();
}

/** Chiffre une valeur ; format « iv.tag.chiffré », le tout en base64url. */
export function sealSecret(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, encryptionKey(), iv);
    const sealed = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), sealed].map((b) => b.toString("base64url")).join(".");
}

/**
 * Déchiffre une valeur produite par sealSecret.
 * Renvoie `null` si le format est invalide, la valeur trafiquée, ou le secret
 * de chiffrement changé — jamais d'exception : un credential illisible doit
 * dégrader vers « non configuré », pas casser l'écran des réglages.
 */
export function openSecret(sealed: string | null | undefined): string | null {
    if (!sealed) return null;
    const parts = sealed.split(".");
    if (parts.length !== 3) return null;
    try {
        const [iv, tag, payload] = parts.map((p) => Buffer.from(p, "base64url"));
        const decipher = createDecipheriv(ALGO, encryptionKey(), iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
    } catch {
        return null;
    }
}
