// ⚠️ Client d'AUTHENTIFICATION (DATABASE_URL_AUTH) : c'est la base que lit
// l'application. Le client racine "@prisma/client" pointe sur DATABASE_URL et
// créerait les comptes dans la mauvaise base.
import { PrismaClient } from "@prisma/auth-client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
    console.log("🌱 Seeding database...");

    // Le mot de passe de seed est fourni via l'environnement (jamais en dur).
    const seedPassword = process.env.SEED_ADMIN_PASSWORD;
    if (!seedPassword || seedPassword.length < 8) {
        throw new Error(
            "SEED_ADMIN_PASSWORD manquant ou trop court (min. 8 caractères). " +
            "Définissez cette variable d'environnement avant de lancer le seed."
        );
    }
    const hashedPassword = await bcrypt.hash(seedPassword, 10);

    const admin = await prisma.user.upsert({
        where: { email: "admin@demo.com" },
        update: {},
        create: {
            email: "admin@demo.com",
            firstName: "Admin",
            lastName: "istrator",
            password: hashedPassword,
            role: "ADMIN",
        },
    });
    console.log(`✅ Created Admin: ${admin.email}`);

    const manager = await prisma.user.upsert({
        where: { email: "manager@demo.com" },
        update: {},
        create: {
            email: "manager@demo.com",
            firstName: "Manager",
            lastName: "User",
            password: hashedPassword,
            role: "MANAGER",
        },
    });
    console.log(`✅ Created Superuser: ${manager.email}`);

    const user = await prisma.user.upsert({
        where: { email: "user@demo.com" },
        update: {},
        create: {
            email: "user@demo.com",
            firstName: "Regular",
            lastName: "User",
            password: hashedPassword,
            role: "AGENT",
        },
    });
    console.log(`✅ Created User: ${user.email}`);

    console.log("🎉 Seeding complete!");
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
