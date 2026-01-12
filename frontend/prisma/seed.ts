import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
    console.log("🌱 Seeding database...");

    // Hash passwords
    const hashedPassword = await bcrypt.hash("1234", 10);

    // Create Admin user
    const admin = await prisma.user.upsert({
        where: { email: "admin@demo.com" },
        update: {},
        create: {
            email: "admin@demo.com",
            name: "Administrator",
            password: hashedPassword,
            role: "ADMIN",
        },
    });
    console.log(`✅ Created Admin: ${admin.email}`);

    // Create Superuser (Manager)
    const manager = await prisma.user.upsert({
        where: { email: "manager@demo.com" },
        update: {},
        create: {
            email: "manager@demo.com",
            name: "Manager User",
            password: hashedPassword,
            role: "SUPERUSER",
        },
    });
    console.log(`✅ Created Superuser: ${manager.email}`);

    // Create Regular User
    const user = await prisma.user.upsert({
        where: { email: "user@demo.com" },
        update: {},
        create: {
            email: "user@demo.com",
            name: "Regular User",
            password: hashedPassword,
            role: "USER",
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
