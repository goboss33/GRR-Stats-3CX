import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServers, ServerId } from "@/lib/prisma-cdr";
import { getAvailableServers } from "@/lib/servers";
import { prismaAuth } from "@/lib/prisma-auth";
import { requireApiRole } from "@/lib/auth-guard";
import { sealSecret } from "@/lib/secret-box";
import { normalizeXapiBaseUrl } from "@/lib/xapi-client";
import { normaliserClientId, normaliserTenantId } from "@/lib/graph-diagnostic";
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
            // Microsoft 365 : mêmes règles — identifiants affichables, secret
            // jamais renvoyé, seule sa présence et ses dates.
            m365Enabled: settingsMap.get(id)?.m365Enabled ?? false,
            m365TenantId: settingsMap.get(id)?.m365TenantId ?? "",
            m365ClientId: settingsMap.get(id)?.m365ClientId ?? "",
            m365SecretConfigured: Boolean(settingsMap.get(id)?.m365SecretEncrypted),
            m365SecretUpdatedAt: settingsMap.get(id)?.m365SecretUpdatedAt?.toISOString() ?? null,
            m365SecretExpiresAt: settingsMap.get(id)?.m365SecretExpiresAt?.toISOString() ?? null,
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
        const {
            serverId, timezone, licenceThreshold, trunkThreshold,
            xapiEnabled, xapiDirectoryEnabled, xapiKey, xapiBaseUrl, xapiClientId,
            m365Enabled, m365TenantId, m365ClientId, m365Secret, m365SecretExpiresAt,
        } = await request.json();
        
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

        // ---- Microsoft 365 : mêmes gestes que la XAPI, champ par champ ----
        if (m365Enabled !== undefined) {
            if (typeof m365Enabled !== "boolean") {
                return NextResponse.json({ error: "Invalid m365Enabled" }, { status: 400 });
            }
            await prismaAuth.tenantSettings.upsert({
                where: { serverId },
                update: { m365Enabled },
                create: { serverId, m365Enabled },
            });
            return NextResponse.json({ success: true, serverId, m365Enabled });
        }

        if (m365TenantId !== undefined) {
            if (typeof m365TenantId !== "string") {
                return NextResponse.json({ error: "Invalid m365TenantId" }, { status: 400 });
            }
            const normalise = m365TenantId.trim() ? normaliserTenantId(m365TenantId) : null;
            if (m365TenantId.trim() && !normalise) {
                return NextResponse.json({ error: "ID de l'annuaire invalide : attendu un GUID ou un domaine du tenant (ex. contoso.onmicrosoft.com)." }, { status: 400 });
            }
            await prismaAuth.tenantSettings.upsert({
                where: { serverId },
                update: { m365TenantId: normalise },
                create: { serverId, m365TenantId: normalise },
            });
            return NextResponse.json({ success: true, serverId, m365TenantId: normalise ?? "" });
        }

        if (m365ClientId !== undefined) {
            if (typeof m365ClientId !== "string") {
                return NextResponse.json({ error: "Invalid m365ClientId" }, { status: 400 });
            }
            const normalise = m365ClientId.trim() ? normaliserClientId(m365ClientId) : null;
            if (m365ClientId.trim() && !normalise) {
                return NextResponse.json({ error: "ID d'application invalide : attendu un GUID (page « Vue d'ensemble » de l'inscription)." }, { status: 400 });
            }
            await prismaAuth.tenantSettings.upsert({
                where: { serverId },
                update: { m365ClientId: normalise },
                create: { serverId, m365ClientId: normalise },
            });
            return NextResponse.json({ success: true, serverId, m365ClientId: normalise ?? "" });
        }

        // Le secret : chiffré avant stockage, jamais relu par le client.
        // Chaîne vide = suppression volontaire, date d'expiration comprise.
        if (m365Secret !== undefined) {
            if (typeof m365Secret !== "string") {
                return NextResponse.json({ error: "Invalid m365Secret" }, { status: 400 });
            }
            const trimmed = m365Secret.trim();
            if (trimmed.length > 4096) {
                return NextResponse.json({ error: "Secret trop long" }, { status: 400 });
            }
            const payload = trimmed
                ? { m365SecretEncrypted: await sealSecret(trimmed), m365SecretUpdatedAt: new Date() }
                : { m365SecretEncrypted: null, m365SecretUpdatedAt: null, m365SecretExpiresAt: null };
            await prismaAuth.tenantSettings.upsert({
                where: { serverId },
                update: payload,
                create: { serverId, ...payload },
            });
            return NextResponse.json({
                success: true,
                serverId,
                m365SecretConfigured: Boolean(trimmed),
                m365SecretUpdatedAt: payload.m365SecretUpdatedAt?.toISOString() ?? null,
                ...(trimmed ? {} : { m365SecretExpiresAt: null }),
            });
        }

        // Expiration déclarée du secret (« AAAA-MM-JJ » ou vide pour effacer).
        if (m365SecretExpiresAt !== undefined) {
            if (m365SecretExpiresAt !== null && typeof m365SecretExpiresAt !== "string") {
                return NextResponse.json({ error: "Invalid m365SecretExpiresAt" }, { status: 400 });
            }
            let date: Date | null = null;
            if (m365SecretExpiresAt && m365SecretExpiresAt.trim()) {
                date = new Date(`${m365SecretExpiresAt.trim().slice(0, 10)}T23:59:59Z`);
                if (Number.isNaN(date.getTime())) {
                    return NextResponse.json({ error: "Date d'expiration invalide" }, { status: 400 });
                }
            }
            await prismaAuth.tenantSettings.upsert({
                where: { serverId },
                update: { m365SecretExpiresAt: date },
                create: { serverId, m365SecretExpiresAt: date },
            });
            return NextResponse.json({ success: true, serverId, m365SecretExpiresAt: date?.toISOString() ?? null });
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
