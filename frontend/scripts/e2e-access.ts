// Test de bout en bout du registre et des périmètres, contre une vraie base.
// Valide les chemins d'ÉCRITURE (jamais exercés jusqu'ici) :
//   découverte -> registre -> périmètre utilisateur -> portée effective.
import { prismaAuth } from "@/lib/prisma-auth";
import { discoverQueues, listRegistryQueues } from "@/services/queue-registry.service";
import { setUserAccess, describeUserScope } from "@/services/user-access.service";

const TENANT = "gerofinance" as const;

async function main() {
    console.log("\n=== 1. Découverte des files ===");
    const result = await discoverQueues(TENANT);
    console.log(`   ${result.discovered} découvertes · ${result.created} créées · ${result.agentLinks} liens agents`);
    console.log(`   ${result.renamed.length} renommage(s) :`);
    result.renamed.forEach((r) => console.log(`     ${r.queueNumber} : « ${r.from} » → « ${r.to} »`));

    console.log("\n=== 2. Idempotence (2e passage) ===");
    const again = await discoverQueues(TENANT);
    console.log(`   ${again.created} création(s) au 2e passage (attendu : 0)`);
    if (again.created !== 0) throw new Error("Découverte NON idempotente");

    console.log("\n=== 3. État du registre ===");
    const registry = await listRegistryQueues(TENANT);
    const withRegion = registry.filter((q) => q.region).length;
    const renamedInDb = await prismaAuth.queueNameHistory.groupBy({
        by: ["queueId"],
        _count: { name: true },
        having: { name: { _count: { gt: 1 } } },
    });
    console.log(`   ${registry.length} files · ${withRegion} avec région · ${renamedInDb.length} avec plusieurs noms`);
    const sample = registry.find((q) => q.region === "PULLY");
    console.log(`   exemple : ${sample?.queueNumber} | ${sample?.currentName} | ${sample?.entity}/${sample?.region}/${sample?.service} | ${sample?.agentCount} agents`);

    console.log("\n=== 4. Périmètre d'un manager (files PULLY) ===");
    const pully = registry.filter((q) => q.region === "PULLY");
    const user = await prismaAuth.user.upsert({
        where: { email: "manager.pully@test.local" },
        update: { role: "MANAGER" },
        create: { email: "manager.pully@test.local", password: "x", role: "MANAGER", firstName: "Test", lastName: "Pully" },
    });
    await setUserAccess(user.id, {
        tenants: [TENANT],
        queueIds: pully.map((q) => q.id),
        extensionOverrides: [{ tenantId: TENANT, extensionNumber: "9999", mode: "INCLUDE" }],
        canViewLogs: true,
        canViewExtensionStats: true,
        canViewFullPhoneNumbers: false,
        canCreateApiKeys: false,
    });
    const scope = await describeUserScope(user.id);
    console.log(`   ${scope.queues.length} files (attendu ${pully.length})`);
    console.log(`   ${scope.extensions.length} extensions visibles (${scope.autoExtensionCount} déduites + ${scope.includedByOverride.length} ajoutée(s))`);
    console.log(`   tenants : ${scope.tenants.join(", ")} · illimité : ${scope.unrestricted}`);
    if (scope.queues.length !== pully.length) throw new Error("Périmètre incohérent");
    if (!scope.extensions.includes("9999")) throw new Error("Surcharge INCLUDE non appliquée");

    console.log("\n=== 5. Remplacement du périmètre (transaction) ===");
    await setUserAccess(user.id, {
        tenants: [TENANT],
        queueIds: pully.slice(0, 2).map((q) => q.id),
        extensionOverrides: [],
        canViewLogs: true,
        canViewExtensionStats: true,
        canViewFullPhoneNumbers: false,
        canCreateApiKeys: false,
    });
    const scope2 = await describeUserScope(user.id);
    console.log(`   ${scope2.queues.length} files (attendu 2) · logs : ${scope2.canViewLogs}`);
    if (scope2.queues.length !== 2) throw new Error("Remplacement du périmètre incorrect");
    if (scope2.extensions.includes("9999")) throw new Error("Ancienne surcharge non supprimée");

    console.log("\n=== 6. Portée d'un ADMIN (doit être globale) ===");
    const admin = await prismaAuth.user.upsert({
        where: { email: "admin@test.local" },
        update: { role: "ADMIN" },
        create: { email: "admin@test.local", password: "x", role: "ADMIN" },
    });
    const adminScope = await describeUserScope(admin.id);
    console.log(`   illimité : ${adminScope.unrestricted} · ${adminScope.queues.length} files vues`);

    console.log("\n=== 7. Sémantique du filtrage SQL (contre les vraies données) ===");
    // Rejoue la condition « l'appel touche le périmètre » utilisée par logs.service.
    const { getPrismaCdr } = await import("@/lib/prisma-cdr");
    const cdr = getPrismaCdr(TENANT);
    const start = new Date("2026-07-10T00:00:00.000Z");
    const end = new Date("2026-07-11T00:00:00.000Z");

    const pullyNumbers = pully.map((q) => q.queueNumber);

    const [{ n: total }] = await cdr.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT call_history_id)::bigint AS n FROM cdroutput
        WHERE cdr_started_at >= ${start} AND cdr_started_at <= ${end}`;

    const [{ n: scoped }] = await cdr.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(DISTINCT call_history_id)::bigint AS n FROM cdroutput
         WHERE cdr_started_at >= $1 AND cdr_started_at <= $2
           AND call_history_id IN (
               SELECT call_history_id FROM cdroutput
               WHERE cdr_started_at >= $1 AND cdr_started_at <= $2
                 AND (destination_dn_type = 'queue' AND destination_dn_number IN (${pullyNumbers.map((_, i) => `$${i + 3}`).join(", ")}))
           )`,
        start, end, ...pullyNumbers,
    );

    console.log(`   ${Number(total)} appels au total le 10/07 · ${Number(scoped)} touchant les files PULLY`);
    if (Number(scoped) === 0) throw new Error("Filtrage dégénéré : aucun appel visible");
    if (Number(scoped) >= Number(total)) throw new Error("Filtrage inopérant : autant d'appels que sans filtre");
    console.log(`   -> sous-ensemble strict : filtrage opérant ✅`);
    await cdr.$disconnect();

    console.log("\n✅ TOUT PASSE\n");
    await prismaAuth.$disconnect();
}

main().catch((e) => { console.error("\n❌ ECHEC:", e); process.exit(1); });
