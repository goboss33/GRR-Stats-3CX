import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServers, ServerId } from "@/lib/prisma-cdr";
import { getAvailableServers } from "@/lib/servers";
import { prismaAuth } from "@/lib/prisma-auth";
import { requireApiRole } from "@/lib/auth-guard";
import { sealSecret } from "@/lib/secret-box";
import { normalizeXapiBaseUrl } from "@/lib/xapi-client";
import { invaliderCacheAnnuaire } from "@/services/queue-directory.service";

export async function GET() {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const cookieStore = await cookies();
        const currentServer = cookieStore.get("selectedServer")?.value || "gerofinance";
        
        const availableServerIds = getAvailableServers();
        const servers = getServers();
        
        const tenantSettings = await prismaAuth.tenantSettings.findMany();
        const settingsMap = new Map(tenantSettings.map(s => [s.serverId, s]));

        const availableServers = availableServerIds.map(id => ({
            id,
            name: servers[id].name,
            timezone: settingsMap.get(id)?.timezone || servers[id].timezone,
            licenceThreshold: settingsMap.get(id)?.licenceThreshold ?? servers[id].licenceThreshold,
            trunkThreshold: settingsMap.get(id)?.trunkThreshold ?? servers[id].trunkThreshold,
            xapiEnabled: settingsMap.get(id)?.xapiEnabled ?? false,
            xapiDirectoryEnabled: settingsMap.get(id)?.xapiDirectoryEnabled ?? false,
            // Adresse et ID client ne sont pas des secrets : ils s'affichent.
            xapiBaseUrl: settingsMap.get(id)?.xapiBaseUrl ?? "",
            xapiClientId: settingsMap.get(id)?.xapiClientId ?? "",
            // La clé elle-même ne sort JAMAIS du serveur : l'écran n'a besoin
            // que de savoir si elle est posée, et depuis quand.
            xapiKeyConfigured: Boolean(settingsMap.get(id)?.xapiKeyEncrypted),
            xapiKeyUpdatedAt: settingsMap.get(id)?.xapiKeyUpdatedAt?.toISOString() ?? null,
        }));

        return NextResponse.json({
            currentServer,
            availableServers,
        });
    } catch (error) {
        console.error("[tenants] Error:", error);
        return NextResponse.json(
            { error: "Failed to fetch tenants" },
            { status: 500 }
        );
    }
}

export async function POST(request: Request) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const { serverId, timezone, licenceThreshold, trunkThreshold, xapiEnabled, xapiDirectoryEnabled, xapiKey, xapiBaseUrl, xapiClientId } = await request.json();
        
        if (!serverId || typeof serverId !== "string") {
            return NextResponse.json(
                { error: "Invalid serverId" },
                { status: 400 }
            );
        }

        const availableServerIds = getAvailableServers();
        if (!availableServerIds.includes(serverId as ServerId)) {
            return NextResponse.json(
                { error: "Server not available" },
                { status: 400 }
            );
        }

        if (timezone && typeof timezone === "string") {
            try {
                Intl.DateTimeFormat(undefined, { timeZone: timezone });
            } catch {
                return NextResponse.json(
                    { error: "Invalid timezone" },
                    { status: 400 }
                );
            }

            await prismaAuth.tenantSettings.upsert({
                where: { serverId },
                update: { timezone },
                create: { serverId, timezone },
            });

            return NextResponse.json({ success: true, serverId, timezone });
        }

        if (licenceThreshold !== undefined) {
            if (typeof licenceThreshold !== "number" || licenceThreshold < 1 || licenceThreshold > 10000) {
                return NextResponse.json(
                    { error: "Invalid licenceThreshold. Must be between 1 and 10000." },
                    { status: 400 }
                );
            }

            await prismaAuth.tenantSettings.upsert({
                where: { serverId },
                update: { licenceThreshold },
                create: { serverId, licenceThreshold },
            });

            return NextResponse.json({ success: true, serverId, licenceThreshold });
        }

        if (trunkThreshold !== undefined) {
            if (typeof trunkThreshold !== "number" || trunkThreshold < 0 || trunkThreshold > 10000) {
                return NextResponse.json(
                    { error: "Invalid trunkThreshold. Must be between 0 and 10000." },
                    { status: 400 }
                );
            }

            await prismaAuth.tenantSettings.upsert({
                where: { serverId },
                update: { trunkThreshold },
                create: { serverId, trunkThreshold },
            });

            return NextResponse.json({ success: true, serverId, trunkThreshold });
        }

        // Surcouche XAPI — l'interrupteur. Éteindre CONSERVE la clé : on
        // rebascule sur le socle CDR sans avoir à la ressaisir au retour.
        if (xapiEnabled !== undefined) {
            if (typeof xapiEnabled !== "boolean") {
                return NextResponse.json({ error: "Invalid xapiEnabled" }, { status: 400 });
            }

            await prismaAuth.tenantSettings.upsert({
                where: { serverId },
                update: { xapiEnabled },
                create: { serverId, xapiEnabled },
            });

            // Éteindre la surcouche éteint aussi l'annuaire : les libellés
            // reviennent aux appels immédiatement, sans laisser un réglage
            // allumé qui ne pourrait plus rien faire.
            await invaliderCacheAnnuaire(serverId as ServerId);
            return NextResponse.json({ success: true, serverId, xapiEnabled });
        }

        // Annuaire XAPI pour les noms et départements de TOUTE l'application.
        // Distinct de l'interrupteur ci-dessus : on peut vouloir le journal
        // des équipes sans confier les libellés au PBX.
        if (xapiDirectoryEnabled !== undefined) {
            if (typeof xapiDirectoryEnabled !== "boolean") {
                return NextResponse.json({ error: "Invalid xapiDirectoryEnabled" }, { status: 400 });
            }

            await prismaAuth.tenantSettings.upsert({
                where: { serverId },
                update: { xapiDirectoryEnabled },
                create: { serverId, xapiDirectoryEnabled },
            });

            // Le changement doit se voir au rechargement suivant, pas dans
            // cinq minutes.
            await invaliderCacheAnnuaire(serverId as ServerId);
            return NextResponse.json({ success: true, serverId, xapiDirectoryEnabled });
        }

        // Adresse du PBX — normalisée à l'origine HTTPS : « /5001 » saisi au
        // lieu de « :5001 » est une faute de frappe courante, et un chemin
        // résiduel casserait tous les appels.
        if (xapiBaseUrl !== undefined) {
            if (typeof xapiBaseUrl !== "string") {
                return NextResponse.json({ error: "Invalid xapiBaseUrl" }, { status: 400 });
            }
            const raw = xapiBaseUrl.trim();
            const normalized = raw ? normalizeXapiBaseUrl(raw) : "";
            if (raw && !normalized) {
                return NextResponse.json(
                    { error: "Adresse invalide : attendu une URL HTTPS complète, port compris (ex. https://exemple.3cx.ch:5001)." },
                    { status: 400 },
                );
            }

            await prismaAuth.tenantSettings.upsert({
                where: { serverId },
                update: { xapiBaseUrl: normalized || null },
                create: { serverId, xapiBaseUrl: normalized || null },
            });

            return NextResponse.json({ success: true, serverId, xapiBaseUrl: normalized });
        }

        if (xapiClientId !== undefined) {
            if (typeof xapiClientId !== "string") {
                return NextResponse.json({ error: "Invalid xapiClientId" }, { status: 400 });
            }
            const trimmedId = xapiClientId.trim();
            if (trimmedId.length > 200) {
                return NextResponse.json({ error: "ID client trop long" }, { status: 400 });
            }

            await prismaAuth.tenantSettings.upsert({
                where: { serverId },
                update: { xapiClientId: trimmedId || null },
                create: { serverId, xapiClientId: trimmedId || null },
            });

            return NextResponse.json({ success: true, serverId, xapiClientId: trimmedId });
        }

        // La clé XAPI : chiffrée avant stockage, jamais relue par le client.
        // Chaîne vide = suppression volontaire.
        if (xapiKey !== undefined) {
            if (typeof xapiKey !== "string") {
                return NextResponse.json({ error: "Invalid xapiKey" }, { status: 400 });
            }

            const trimmed = xapiKey.trim();
            if (trimmed.length > 4096) {
                return NextResponse.json({ error: "Clé trop longue" }, { status: 400 });
            }

            const payload = trimmed
                ? { xapiKeyEncrypted: await sealSecret(trimmed), xapiKeyUpdatedAt: new Date() }
                : { xapiKeyEncrypted: null, xapiKeyUpdatedAt: null };

            await prismaAuth.tenantSettings.upsert({
                where: { serverId },
                update: payload,
                create: { serverId, ...payload },
            });

            return NextResponse.json({
                success: true,
                serverId,
                xapiKeyConfigured: Boolean(trimmed),
                xapiKeyUpdatedAt: payload.xapiKeyUpdatedAt?.toISOString() ?? null,
            });
        }

        const cookieStore = await cookies();
        cookieStore.set("selectedServer", serverId, {
            path: "/",
            maxAge: 60 * 60 * 24 * 365,
            httpOnly: false,
            sameSite: "lax",
        });

        return NextResponse.json({ success: true, serverId });
    } catch (error) {
        console.error("[tenants] Error:", error);
        return NextResponse.json(
            { error: "Failed to update tenant" },
            { status: 500 }
        );
    }
}
