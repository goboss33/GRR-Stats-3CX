// Smoke : exécute les requêtes SQL de découverte du registre contre la base CDR.
// (Le volet écriture, vers la base d'authentification, n'est pas couvert ici.)
import { getPrismaCdr } from "@/lib/prisma-cdr";

async function main() {
    const prisma = getPrismaCdr("gerofinance");

    const queues = await prisma.$queryRaw<{ number: string; name: string; first_seen: Date; last_seen: Date }[]>`
        WITH agg AS (
            SELECT destination_dn_number AS number,
                   MIN(cdr_started_at)   AS first_seen,
                   MAX(cdr_started_at)   AS last_seen
            FROM cdroutput
            WHERE destination_dn_type = 'queue' AND destination_dn_number IS NOT NULL
            GROUP BY 1
        ),
        latest AS (
            SELECT DISTINCT ON (destination_dn_number)
                   destination_dn_number AS number,
                   destination_dn_name   AS name
            FROM cdroutput
            WHERE destination_dn_type = 'queue' AND destination_dn_name IS NOT NULL
            ORDER BY destination_dn_number, cdr_started_at DESC
        )
        SELECT a.number, COALESCE(l.name, a.number) AS name, a.first_seen, a.last_seen
        FROM agg a
        LEFT JOIN latest l ON l.number = a.number
    `;
    console.log(`✅ Files découvertes : ${queues.length}`);
    console.log(`   ex. ${queues[0].number} | ${queues[0].name} | vue jusqu'au ${queues[0].last_seen.toISOString().slice(0, 10)}`);

    const allNames = await prisma.$queryRaw<{ number: string; name: string }[]>`
        SELECT DISTINCT destination_dn_number AS number, destination_dn_name AS name
        FROM cdroutput
        WHERE destination_dn_type = 'queue' AND destination_dn_name IS NOT NULL
    `;
    console.log(`✅ Couples (file, nom) pour l'historique : ${allNames.length}`);
    console.log(`   -> ${allNames.length - queues.length} nom(s) supplémentaire(s) = renommages détectés`);

    const links = await prisma.$queryRaw<{ queue_number: string; extension_number: string; last_seen: Date }[]>`
        SELECT parent.destination_dn_number AS queue_number,
               child.destination_dn_number  AS extension_number,
               MAX(child.cdr_started_at)    AS last_seen
        FROM cdroutput child
        JOIN cdroutput parent ON child.originating_cdr_id = parent.cdr_id
        WHERE child.creation_method = 'route_to'
          AND child.creation_forward_reason = 'polling'
          AND parent.destination_dn_type = 'queue'
          AND child.destination_dn_number IS NOT NULL
        GROUP BY 1, 2
    `;
    const distinctExt = new Set(links.map((l) => l.extension_number)).size;
    console.log(`✅ Rattachements agent -> file : ${links.length} (${distinctExt} extensions distinctes)`);

    await prisma.$disconnect();
}

main().catch((e) => { console.error("ECHEC:", e); process.exit(1); });
