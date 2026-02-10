// Types for Statistics module

export interface QueueKPIs {
    callsReceived: number;        // Appels entrant dans la queue (hors voicemail)
    callsAnswered: number;        // Répondus par un agent
    callsAnsweredAndTransferred: number; // Répondus puis transférés (sous-ensemble de callsAnswered)
    callsAbandoned: number;       // Abandonnés total
    abandonedBefore10s: number;   // Abandonnés < 10s
    abandonedAfter10s: number;    // Abandonnés >= 10s
    callsToVoicemail: number;     // Messagerie vocale (exclus des reçus)
    callsOverflow: number;        // Repartis ailleurs (débordement automatique)
    overflowDestinations: OverflowDestination[];
    transferDestinations: TransferDestination[];  // Destinations des transferts actifs
    avgWaitTimeSeconds: number;
    avgTalkTimeSeconds: number;
}

export interface OverflowDestination {
    destination: string;
    destinationName: string;
    count: number;
}

export interface TransferDestination {
    destination: string;         // numéro
    destinationName: string;     // nom
    destinationType: string;     // 'extension' | 'queue' | autre
    count: number;
}

export interface AgentStats {
    extension: string;
    name: string;
    callsReceived: number;           // Appels uniques reçus (DISTINCT call_history_id)
    attempts: number;                // Sollicitations (total sonneries via queue)
    answered: number;                // Appels répondus via la queue
    transferred: number;             // Appels répondus puis transférés
    answerRate: number;              // answered / callsReceived (%)
    availabilityRate: number;        // callsReceived / totalQueueCalls (%)
    avgHandlingTimeSeconds: number;
    totalHandlingTimeSeconds: number; // Durée totale au tel
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
