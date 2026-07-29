// Client d'authentification (DATABASE_URL_AUTH) — cf. note dans prisma/seed.ts.
import { PrismaClient } from "@prisma/auth-client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
    console.log(" Création de l'utilisateur administrateur...");

    const hashedPassword = await bcrypt.hash("J3sus-Chr1st", 10);

    const user = await prisma.user.upsert({
        where: { email: "geoffrey.bossens@grrsa.ch" },
        update: {
            firstName: "Geoffrey",
            lastName: "Bossens",
            role: "ADMIN",
            password: hashedPassword,
        },
        create: {
            email: "geoffrey.bossens@grrsa.ch",
            firstName: "Geoffrey",
            lastName: "Bossens",
            password: hashedPassword,
            role: "ADMIN",
        },
    });

    console.log(`✅ Utilisateur créé/mis à jour: ${user.email} (rôle: ${user.role})`);
}

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });