// Types for Statistics module

export interface QueueKPIs {
    callsReceived: number;        // Appels entrant dans la queue (hors voicemail)
    callsAnswered: number;        // Répondus par un agent
    callsAbandoned: number;       // Abandonnés total
    abandonedBefore10s: number;   // Abandonnés < 10s
    abandonedAfter10s: number;    // Abandonnés >= 10s
    callsToVoicemail: number;     // Messagerie vocale (exclus des reçus)
    callsOverflow: number;        // Repartis ailleurs
    overflowDestinations: OverflowDestination[];
    avgWaitTimeSeconds: number;
    avgTalkTimeSeconds: number;
}

export interface OverflowDestination {
    destination: string;
    destinationName: string;
    count: number;
}

export interface AgentStats {
    extension: string;
    name: string;
    callsFromQueue: number;       // Appels via la queue
    callsDirect: number;          // Appels directs
    callsIntercepted: number;     // Appels interceptés (pickup)
    callsTransferred: number;     // Appels transférés
    totalAnswered: number;
    answerRate: number;           // % de réponse (0-100)
    avgHandlingTimeSeconds: number;
}

export interface DailyTrend {
    date: string;
    received: number;
    answered: number;
    abandoned: number;
}

export interface HourlyTrend {
    hour: number;
    received: number;
    answered: number;
    abandoned: number;
}

export interface QueueStatistics {
    queueNumber: string;
    queueName: string;
    period: {
        start: string;
        end: string;
    };
    kpis: QueueKPIs;
    agents: AgentStats[];
    dailyTrend: DailyTrend[];
    hourlyTrend: HourlyTrend[];
}

export interface StatisticsFilters {
    queueNumber: string;
    startDate: Date;
    endDate: Date;
}
