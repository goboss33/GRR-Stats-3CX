// Vérifie le pré-remplissage des étiquettes sur les vraies files (script d'analyse).
import { getPrismaCdr } from "@/lib/prisma-cdr";
import { parseQueueName } from "@/services/domain/queue-naming";

async function main() {
    const prisma = getPrismaCdr("gerofinance");
    const rows = await prisma.$queryRaw<{ number: string; name: string }[]>`
        SELECT DISTINCT ON (destination_dn_number)
               destination_dn_number AS number,
               destination_dn_name   AS name
        FROM cdroutput
        WHERE destination_dn_type = 'queue' AND destination_dn_name IS NOT NULL
        ORDER BY destination_dn_number, cdr_started_at DESC`;

    let withRegion = 0;
    const unresolved: string[] = [];
    const regions = new Map<string, number>();

    for (const r of rows) {
        const tags = parseQueueName(r.name);
        if (tags.region) {
            withRegion++;
            regions.set(tags.region, (regions.get(tags.region) ?? 0) + 1);
        } else {
            unresolved.push(`${r.number} | ${r.name}`);
        }
    }

    console.log(`\nFiles analysées : ${rows.length}`);
    console.log(`Région reconnue : ${withRegion} (${Math.round((withRegion / rows.length) * 100)} %)`);
    console.log(`À classer à la main : ${unresolved.length}\n`);
    console.log("Répartition par région :");
    [...regions.entries()].sort((a, b) => b[1] - a[1]).forEach(([r, n]) => console.log(`  ${r.padEnd(15)} ${n}`));
    console.log("\nFiles sans région reconnue :");
    unresolved.forEach((u) => console.log(`  ${u}`));

    await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
