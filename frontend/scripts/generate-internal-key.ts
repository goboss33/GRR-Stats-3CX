import { prismaAuth as prisma } from "../lib/prisma-auth";
import bcrypt from "bcryptjs";
import crypto from "crypto";

async function generateInternalApiKey() {
    const plainKey = `sk_internal_${crypto.randomBytes(32).toString("hex")}`;
    const keyHash = await bcrypt.hash(plainKey, 10);

    const apiKey = await prisma.apiKey.upsert({
        where: { id: "internal" },
        update: {
            keyHash,
            name: "Internal Server Actions",
            description: "Clé interne utilisée par les Server Actions pour appeler l'API Analytics",
            quotaPerMinute: 1000,
            isActive: true,
            revokedAt: null,
            revokedBy: null,
        },
        create: {
            id: "internal",
            keyHash,
            name: "Internal Server Actions",
            description: "Clé interne utilisée par les Server Actions pour appeler l'API Analytics",
            quotaPerMinute: 1000,
            isActive: true,
            createdBy: "system",
        },
    });

    console.log("\n========================================");
    console.log("  Internal API Key Generated");
    console.log("========================================\n");
    console.log(`  ID:          ${apiKey.id}`);
    console.log(`  Name:        ${apiKey.name}`);
    console.log(`  Quota/min:   ${apiKey.quotaPerMinute}`);
    console.log(`\n  PLAIN KEY (copy this to .env):`);
    console.log(`  ${plainKey}\n`);
    console.log("========================================\n");
    console.log("  Add this to your .env file:");
    console.log(`  INTERNAL_API_KEY="${plainKey}"`);
    console.log("\n========================================\n");

    await prisma.$disconnect();
}

generateInternalApiKey().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
});
