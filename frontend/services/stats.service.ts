"use server";

import { prisma } from "@/lib/prisma";
import {
    GlobalMetrics,
    TimelineDataPoint,
    ExtensionStats,
    RecentCall,
} from "@/types/stats.types";

/**
 * Get global metrics using optimized SQL aggregations
 */
export async function getGlobalMetrics(
    startDate: Date,
    endDate: Date
): Promise<GlobalMetrics> {
    // 1. Compter le total et les répondus directement en base
    const counts = await prisma.cdroutput.groupBy({
        by: ['processed'], // On doit grouper par quelque chose, 'processed' est souvent constant ou on ignore
        where: {
            cdr_started_at: {
                gte: startDate,
                lte: endDate,
            },
        },
        _count: {
            cdr_id: true, // Total calls
        },
    });

    // Pour avoir le décompte précis des répondus (où cdr_answered_at n'est pas null)
    // Prisma groupBy ne permet pas de filtre conditionnel dans le count, donc on fait deux requêtes rapides
    const totalCalls = await prisma.cdroutput.count({
        where: {
            cdr_started_at: { gte: startDate, lte: endDate },
        },
    });

    const answeredCalls = await prisma.cdroutput.count({
        where: {
            cdr_started_at: { gte: startDate, lte: endDate },
            cdr_answered_at: { not: null },
        },
    });

    const missedCalls = totalCalls - answeredCalls;

    // 2. Calculer la durée moyenne (DMT) via SQL brut pour la performance
    // On demande à Postgres de faire la moyenne de (fin - début)
    const avgResult = await prisma.$queryRaw<[{ avg_duration: number | null }]>`
        SELECT AVG(EXTRACT(EPOCH FROM (cdr_ended_at - cdr_answered_at))) as avg_duration
        FROM cdroutput
        WHERE cdr_started_at >= ${startDate}
          AND cdr_started_at <= ${endDate}
          AND cdr_answered_at IS NOT NULL
          AND cdr_ended_at IS NOT NULL
    `;

    const avgDurationSeconds = avgResult[0]?.avg_duration
        ? Math.round(Number(avgResult[0].avg_duration))
        : 0;

    const answerRate = totalCalls > 0 ? (answeredCalls / totalCalls) * 100 : 0;

    return {
        totalCalls,
        answeredCalls,
        missedCalls,
        avgDurationSeconds,
        answerRate: Math.round(answerRate * 10) / 10,
    };
}

/**
 * Get timeline data grouped by SQL (date_trunc)
 */
export async function getTimelineData(
    startDate: Date,
    endDate: Date
): Promise<TimelineDataPoint[]> {
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    // Si la période est <= 2 jours, on groupe par heure, sinon par jour
    const interval = diffDays <= 2 ? 'hour' : 'day';

    // Requête SQL optimisée pour grouper par temps
    // COALESCE(SUM(...), 0) assure qu'on reçoit 0 au lieu de null
    const rawData = await prisma.$queryRaw<Array<{ date_group: Date, answered: bigint, missed: bigint }>>`
        SELECT 
            date_trunc(${interval}, cdr_started_at) as date_group,
            COUNT(CASE WHEN cdr_answered_at IS NOT NULL THEN 1 END) as answered,
            COUNT(CASE WHEN cdr_answered_at IS NULL THEN 1 END) as missed
        FROM cdroutput
        WHERE cdr_started_at >= ${startDate}
          AND cdr_started_at <= ${endDate}
        GROUP BY date_group
        ORDER BY date_group ASC
    `;

    // Transformation pour le frontend
    return rawData.map((row) => {
        const date = new Date(row.date_group);
        let label = "";

        if (interval === 'hour') {
            // Format HH:00
            label = `${String(date.getHours()).padStart(2, "0")}:00`;
        } else {
            // Format DD/MM
            label = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
        }

        return {
            date: date.toISOString(),
            label,
            answered: Number(row.answered), // BigInt vers Number
            missed: Number(row.missed),
        };
    });
}

/**
 * Get top extensions using SQL Group By
 */
export async function getTopExtensions(
    startDate: Date,
    endDate: Date,
    limit: number = 10
): Promise<ExtensionStats[]> {
    // Agrégation puissante pour avoir le total ET les répondus par extension en une seule passe
    const rawStats = await prisma.$queryRaw<Array<{
        extension: string,
        total: bigint,
        answered: bigint
    }>>`
        SELECT 
            destination_dn_number as extension,
            COUNT(*) as total,
            COUNT(CASE WHEN cdr_answered_at IS NOT NULL THEN 1 END) as answered
        FROM cdroutput
        WHERE cdr_started_at >= ${startDate}
          AND cdr_started_at <= ${endDate}
          AND destination_dn_number IS NOT NULL
        GROUP BY destination_dn_number
        ORDER BY total DESC
        LIMIT ${limit}
    `;

    return rawStats.map((row) => {
        const total = Number(row.total);
        const answered = Number(row.answered);
        const answerRate = total > 0 ? (answered / total) * 100 : 0;

        return {
            extensionNumber: row.extension || "Inconnu",
            totalCalls: total,
            answeredCalls: answered,
            answerRate: Math.round(answerRate * 10) / 10,
        };
    });
}

/**
 * Get recent calls (Restricted to 50, optimized select)
 */
export async function getRecentCalls(limit: number = 50): Promise<RecentCall[]> {
    const calls = await prisma.cdroutput.findMany({
        orderBy: {
            cdr_started_at: "desc",
        },
        take: limit,
        select: {
            cdr_id: true,
            cdr_started_at: true,
            cdr_answered_at: true,
            cdr_ended_at: true,
            source_dn_number: true,
            destination_dn_number: true,
        },
    });

    return calls.map((call) => {
        let durationSeconds = 0;
        if (call.cdr_answered_at && call.cdr_ended_at) {
            durationSeconds = Math.round(
                (new Date(call.cdr_ended_at).getTime() -
                    new Date(call.cdr_answered_at).getTime()) /
                1000
            );
        }

        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        const durationFormatted = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

        return {
            id: call.cdr_id,
            startedAt: call.cdr_started_at ? new Date(call.cdr_started_at).toISOString() : "",
            sourceExtension: call.source_dn_number || "-",
            destinationExtension: call.destination_dn_number || "-",
            status: call.cdr_answered_at ? "answered" : "missed",
            durationSeconds,
            durationFormatted,
        };
    });
}