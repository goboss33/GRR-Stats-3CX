import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
    console.log("🌱 Seeding database...");

    const hashedPassword = await bcrypt.hash("1234", 10);

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
            role: "SUPERUSER",
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
