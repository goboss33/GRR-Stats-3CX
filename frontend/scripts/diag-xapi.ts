// Diagnostic de la surcouche XAPI d'un tenant : jeton, claims du principal,
// et statut de lecture des entités de base. Lecture seule.
//
// Usage : npx tsx scripts/diag-xapi.ts [serverId=gerofinance]
//
// Utilise les identifiants ENREGISTRÉS dans la base auth accessible depuis ce
// poste (Réglages > Tenant). N'affiche NI la clé NI le jeton — seulement les
// claims déclaratives et les statuts HTTP.
import { getServerXapiConfig, isXapiUsable } from "@/lib/xapi-config";
import { requestXapiToken, decodeTokenClaims } from "@/lib/xapi-client";
import type { ServerId } from "@/lib/prisma-cdr";

const SERVER = (process.argv[2] ?? "gerofinance") as ServerId;

async function main() {
    const config = await getServerXapiConfig(SERVER);
    console.log(`\nTenant ${SERVER} — surcouche ${config.enabled ? "activée" : "désactivée"}, ` +
        `adresse ${config.baseUrl ?? "absente"}, ID client ${config.clientId ?? "absent"}, ` +
        `clé ${config.key ? "lisible" : "absente/illisible"}`);
    if (!isXapiUsable(config)) {
        console.log("→ Surcouche non exploitable depuis ce poste : saisir les identifiants dans Réglages > Tenant de CETTE instance.");
        return;
    }

    const token = await requestXapiToken(config.baseUrl!, config.clientId!, config.key!);
    if (!token.ok) { console.log(`✖ Jeton refusé : ${token.reason}`); return; }
    console.log(`✓ Jeton délivré (expire dans ${token.expiresInSeconds ?? "?"} s)`);
    const claims = decodeTokenClaims(token.accessToken);
    console.log(`  Claims : ${JSON.stringify(claims)}`);

    for (const path of [
        "/xapi/v1/Queues?%24top=1&%24select=Id,Number,Name",
        "/xapi/v1/Queues?%24top=1&%24expand=Agents",
        "/xapi/v1/Users?%24top=1&%24select=Id,Number",
        "/xapi/v1/Groups?%24top=1&%24select=Id",
    ]) {
        try {
            const res = await fetch(`${config.baseUrl}${path}`, {
                headers: { Authorization: `Bearer ${token.accessToken}` },
                signal: AbortSignal.timeout(15000),
            });
            const body = (await res.text()).trim();
            console.log(`\nGET ${path}\n  HTTP ${res.status}${res.ok ? "" : ` — corps: ${body ? body.slice(0, 250) : "vide"}`}`);
            if (res.ok) console.log(`  aperçu: ${body.slice(0, 350)}`);
        } catch (error) {
            console.log(`\nGET ${path}\n  injoignable (${error instanceof Error ? error.message : String(error)})`);
        }
    }
    console.log();
}
main().catch((e) => { console.error(e); process.exit(1); });
