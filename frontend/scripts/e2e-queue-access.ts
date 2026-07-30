// Vérifie la gestion des accès « depuis la file » contre une vraie base.
import { prismaAuth } from "@/lib/prisma-auth";
import { listQueueAccess, grantQueueAccess, revokeQueueAccess } from "@/services/user-access.service";

async function main() {
    const queue = await prismaAuth.queueRegistry.findFirst({ where: { tenantId: "gerofinance" } });
    if (!queue) throw new Error("Registre vide : lancer d'abord la découverte");

    const manager = await prismaAuth.user.upsert({
        where: { email: "manager.access@test.local" },
        update: { role: "MANAGER" },
        create: { email: "manager.access@test.local", password: "x", role: "MANAGER", firstName: "Test", lastName: "Acces" },
    });
    const admin = await prismaAuth.user.upsert({
        where: { email: "admin.access@test.local" },
        update: { role: "ADMIN" },
        create: { email: "admin.access@test.local", password: "x", role: "ADMIN" },
    });

    console.log(`\nFile testée : ${queue.queueNumber} — ${queue.currentName}`);

    await revokeQueueAccess(manager.id, queue.id);
    const before = await listQueueAccess(queue.id);
    console.log(`  avant  : ${before.granted.length} accès · ${before.assignable.length} assignable(s)`);

    console.log("\n=== Octroi ===");
    await grantQueueAccess(manager.id, queue.id);
    const after = await listQueueAccess(queue.id);
    console.log(`  après  : ${after.granted.map((u) => u.email).join(", ") || "(aucun)"}`);
    if (!after.granted.some((u) => u.id === manager.id)) throw new Error("Octroi non appliqué");
    if (after.assignable.some((u) => u.id === manager.id)) throw new Error("Toujours proposé à l'ajout");

    const tenant = await prismaAuth.userTenantAccess.findFirst({ where: { userId: manager.id, tenantId: "gerofinance" } });
    if (!tenant) throw new Error("Accès tenant non accordé automatiquement");
    console.log("  accès tenant accordé automatiquement ✅");

    console.log("\n=== Idempotence (second octroi) ===");
    await grantQueueAccess(manager.id, queue.id);
    const again = await listQueueAccess(queue.id);
    console.log(`  ${again.granted.length} accès (attendu 1)`);
    if (again.granted.length !== 1) throw new Error("Doublon créé");

    console.log("\n=== Les ADMIN n'apparaissent pas ===");
    const hasAdmin = again.granted.some((u) => u.id === admin.id) || again.assignable.some((u) => u.id === admin.id);
    console.log(`  admin présent dans les listes : ${hasAdmin} (attendu false)`);
    if (hasAdmin) throw new Error("Un ADMIN est listé alors que son accès est global");

    console.log("\n=== Retrait ===");
    await revokeQueueAccess(manager.id, queue.id);
    const removed = await listQueueAccess(queue.id);
    console.log(`  ${removed.granted.length} accès restant(s) (attendu 0)`);
    if (removed.granted.length !== 0) throw new Error("Retrait non appliqué");

    console.log("\n✅ TOUT PASSE\n");
    await prismaAuth.$disconnect();
}

main().catch((e) => { console.error("\n❌ ECHEC:", e); process.exit(1); });
