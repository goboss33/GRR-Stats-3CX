// Types for Statistics module

export interface QueueKPIs {
    // PRIMARY: Appels uniques (DISTINCT call_history_id)
    callsReceived: number;        // Appels uniques entrants dans la queue (hors voicemail)
    callsAnswered: number;        // Appels uniques répondus par un agent
    callsAbandoned: number;       // Appels uniques abandonnés
    abandonedBefore10s: number;   // Appels uniques abandonnés < 10s
    abandonedAfter10s: number;    // Appels uniques abandonnés >= 10s
    callsToVoicemail: number;     // Messagerie vocale (exclus des reçus)
    callsOverflow: number;        // Appels uniques redirigés (débordement automatique)

    // SECONDARY: Passages (pour jauge ping-pong)
    totalPassages: number;        // Total passages incluant ping-pong
    pingPongCount: number;        // totalPassages - callsReceived
    pingPongPercentage: number;   // % de ping-pong

    // TEAM BANNER: Appels directs agrégés de l'équipe
    teamDirectReceived: number;   // Total appels directs reçus par les agents de la queue
    teamDirectAnswered: number;   // Total appels directs répondus par les agents de la queue

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
    // Queue stats (résolveur final)
    callsReceived: number;           // Appels uniques queue où le tel a sonné (DISTINCT call_history_id)
    answered: number;                // Appels uniques résolus (résolveur final = dernier à décrocher)
    abandoned: number;               // Appels abandonnés où le tel de l'agent a sonné (responsabilité partagée)
    overflow: number;                // Appels redirigés (overflow) où le tel de l'agent a sonné
    // Direct stats
    directReceived: number;          // Appels directs reçus
    directAnswered: number;          // Appels directs répondus
    directTalkTimeSeconds: number;   // Durée tel directs
    // Computed metrics
    answerRate: number;              // GLOBAL: (answered + directAnswered) / (callsReceived + directReceived) (%)
    avgHandlingTimeSeconds: number;  // Moyenne combinée queue + direct
    totalHandlingTimeSeconds: number; // Durée totale tel queue + direct
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
