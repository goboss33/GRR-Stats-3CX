"use server";

import { getPrismaCdr, type ServerId } from "@/lib/prisma-cdr";
import { prismaAuth } from "@/lib/prisma-auth";
import { getClassificationRules } from "@/lib/classification-rules";
import { cdrTable } from "@/services/domain/call-classification";

/**
 * JOURNAL DES CHANGEMENTS DES FILES — trois sources, une chronologie.
 *
 * La table QueueNameHistory ne peut PAS servir ici : sa contrainte d'unicité
 * (file, nom) en fait un ensemble de noms, pas une suite d'événements, et sa
 * date est celle de la découverte qui les a vus. Mesuré le 1er septembre 2026 :
 * 184 lignes réparties sur 6 instants, dont deux noms d'une même file
 * enregistrés à 17 millisecondes d'écart — aucune chronologie n'en sort.
 *
 * Ce qui date VRAIMENT, et d'où :
 *
 *   - RENOMMAGES  ← les appels. La période pendant laquelle chaque nom a été
 *                   porté se lit dans les CDR, au jour près, depuis l'origine.
 *   - DÉPARTEMENTS ← l'annuaire XAPI, qui date ses mouvements depuis le
 *                   25 août 2026. Les appels ne portent pas cette information
 *                   de façon fiable.
 *   - ARCHIVAGES  ← la table QueueStatusChange, alimentée depuis le
 *                   1er septembre 2026. Rien avant : un archivage ne laisse
 *                   aucune trace ailleurs, il fallait commencer à l'écrire.
 *
 * Chaque ligne porte donc sa source, et l'écran le dit — un journal qui tait
 * ses angles morts ment par omission.
 */

export type SourceChangement = "appels" | "xapi" | "app";

export interface Changement {
    date: string;
    queueNumber: string;
    /** Nom de la file au moment de la lecture, pour s'y retrouver. */
    queueName: string;
    type: "renommage" | "departement" | "apparition" | "statut";
    avant: string | null;
    apres: string | null;
    source: SourceChangement;
    /** Auteur, quand le geste est humain. */
    par?: string | null;
}

/** Ligne brute des spans de noms lus dans les CDR. */
interface SpanRow {
    queue_number: string;
    name: string;
    debut: Date;
    nom_precedent: string | null;
}

export async function getQueueChangeLog(serverId: ServerId, limite = 400): Promise<Changement[]> {
    const rules = await getClassificationRules();
    const prisma = getPrismaCdr(serverId);

    const [spans, annuaire, statuts, registre] = await Promise.all([
        // Périodes de port de chaque nom, et le nom qui précédait. Un balayage
        // complet de la table : l'écran est administratif et consulté
        // rarement, on préfère l'exactitude à la ruse.
        //
        // Limite connue : une file qui reprendrait un nom déjà porté (A → B → A)
        // n'aurait qu'une ligne pour A, aux bornes élargies — l'ordre pourrait
        // s'en trouver faussé. Cas non observé, et sans conséquence sur le fond.
        prisma.$queryRawUnsafe<SpanRow[]>(`
            WITH spans AS (
                SELECT destination_dn_number AS queue_number,
                       destination_dn_name   AS name,
                       MIN(cdr_started_at)   AS debut
                FROM ${cdrTable(rules)}
                WHERE destination_dn_type = 'queue'
                  AND destination_dn_name IS NOT NULL
                  AND destination_dn_number IS NOT NULL
                GROUP BY 1, 2
            )
            SELECT queue_number, name, debut,
                   LAG(name) OVER (PARTITION BY queue_number ORDER BY debut) AS nom_precedent
            FROM spans
            ORDER BY debut DESC`),
        prismaAuth.queueDirectoryInterval.findMany({
            where: { serverId },
            select: { queueNumber: true, queueName: true, department: true, firstSeenAt: true, closedAt: true },
            orderBy: { firstSeenAt: "desc" },
        }),
        prismaAuth.queueStatusChange.findMany({
            where: { tenantId: serverId },
            orderBy: { changedAt: "desc" },
            take: limite,
        }),
        prismaAuth.queueRegistry.findMany({
            where: { tenantId: serverId },
            select: { queueNumber: true, currentName: true, firstSeenAt: true },
        }),
    ]);

    const nomCourant = new Map(registre.map((q) => [q.queueNumber, q.currentName]));
    const libelle = (n: string) => nomCourant.get(n) ?? `File ${n}`;
    const out: Changement[] = [];

    // 1) Renommages, datés par le premier appel portant le nouveau nom.
    for (const s of spans) {
        if (!s.nom_precedent || s.nom_precedent === s.name) continue;
        out.push({
            date: s.debut.toISOString(),
            queueNumber: s.queue_number,
            queueName: libelle(s.queue_number),
            type: "renommage",
            avant: s.nom_precedent,
            apres: s.name,
            source: "appels",
        });
    }

    // 2) Apparition d'une file : son tout premier appel.
    for (const q of registre) {
        out.push({
            date: q.firstSeenAt.toISOString(),
            queueNumber: q.queueNumber,
            queueName: libelle(q.queueNumber),
            type: "apparition",
            avant: null,
            apres: q.currentName,
            source: "appels",
        });
    }

    // 3) Changements de département vus par la XAPI. Une ligne d'annuaire
    //    ouverte APRÈS une autre fermée sur la même file, avec un département
    //    différent, est un mouvement ; la toute première ligne ne l'est pas
    //    (c'est la découverte de l'existant, pas un changement).
    const parFile = new Map<string, typeof annuaire>();
    for (const ligne of annuaire) {
        const liste = parFile.get(ligne.queueNumber) ?? [];
        liste.push(ligne);
        parFile.set(ligne.queueNumber, liste);
    }
    for (const [numero, lignes] of parFile) {
        // Du plus ancien au plus récent pour comparer chaque ligne à la précédente.
        const ordonnees = [...lignes].sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
        for (let i = 1; i < ordonnees.length; i++) {
            const avant = ordonnees[i - 1], apres = ordonnees[i];
            if (avant.department === apres.department) continue;
            out.push({
                date: apres.firstSeenAt.toISOString(),
                queueNumber: numero,
                queueName: libelle(numero),
                type: "departement",
                avant: avant.department,
                apres: apres.department,
                source: "xapi",
            });
        }
    }

    // 4) Archivages et réactivations — la seule source possible.
    for (const s of statuts) {
        out.push({
            date: s.changedAt.toISOString(),
            queueNumber: s.queueNumber,
            queueName: libelle(s.queueNumber),
            type: "statut",
            avant: s.previousStatus,
            apres: s.newStatus,
            source: "app",
            par: s.changedByName,
        });
    }

    return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limite);
}
