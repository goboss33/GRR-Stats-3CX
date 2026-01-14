const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const types = await prisma.$queryRaw`SELECT DISTINCT source_dn_type, destination_dn_type FROM cdroutput LIMIT 50`;
    console.log('DN Types found in database:');
    console.log(JSON.stringify(types, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
