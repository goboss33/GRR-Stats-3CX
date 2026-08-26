// Chronomètre la SEULE requête des collaborateurs (/api/analytics/agents) en
// répétant l'appel, pour deux usages :
//   - mesurer comment son coût grandit avec la fenêtre (1 mois, 2 mois, ...) ;
//   - vérifier qu'un correctif tient dans la durée (plusieurs passages).
// Lecture seule. Le serveur Next doit tourner.
//
// Usage : npx tsx scripts/bench-agents-fenetre.ts <file> <débutISO> <finISO> [passages=3]
//
// Mesures du 26 août 2026 sur la base locale, file 958 (la plus chargée), pour
// SIX collaborateurs : 1 mois ≈ 6 s · 2 mois ≈ 32 s · 3 mois ≈ 43 s — et un
// passage tombé en échec après 305 s, soit le délai d'attente de fetch (300 s).
// Croissance très au-delà du linéaire, insensible au cache.

import { readFileSync } from "node:fs";

// Ce script n'importe rien de l'app : il doit lire .env lui-même.
const env: Record<string, string> = {};
for (const ligne of readFileSync(".env", "utf8").split("\n")) {
    const l = ligne.trim();
    if (!l || l.startsWith("#") || !l.includes("=")) continue;
    // Les valeurs de .env sont parfois entre guillemets : on les retire.
    env[l.slice(0, l.indexOf("=")).trim()] = l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

const API = env.INTERNAL_API_URL || "http://localhost:3000";
const KEY = env.INTERNAL_API_KEY || "";
const [queue, start, end] = [process.argv[2], process.argv[3], process.argv[4]];
const PASSAGES = Number(process.argv[5] ?? 3);

async function main() {
    console.log(`\n  /api/analytics/agents — file ${queue}`);
    console.log(`  ${start} → ${end}\n`);
    for (let i = 1; i <= PASSAGES; i++) {
        const url = new URL(`${API}/api/analytics/agents`);
        url.searchParams.set("server", "gerofinance");
        url.searchParams.set("queueNumber", queue);
        url.searchParams.set("start", start);
        url.searchParams.set("end", end);
        url.searchParams.set("origin", "external");
        const t0 = Date.now();
        try {
            const res = await fetch(url.toString(), { headers: { "X-API-Key": KEY } });
            const body = await res.json();
            const n = Array.isArray(body?.agents) ? body.agents.length : "?";
            console.log(`  passage ${i} : ${((Date.now() - t0) / 1000).toFixed(2).padStart(8)} s   (${n} collaborateurs, HTTP ${res.status})`);
        } catch (e) {
            console.log(`  passage ${i} : ÉCHEC après ${((Date.now() - t0) / 1000).toFixed(2)} s — ${String(e).slice(0, 80)}`);
        }
    }
    console.log("");
    process.exit(0);
}

main();
