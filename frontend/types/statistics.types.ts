// Types for Statistics module

export interface QueueKPIs {
    // PASSAGES (Method N°2): Count ALL passages through queue, including ping-pong
    callsReceived: number;        // Total passages entrant dans la queue (hors voicemail)
    callsAnswered: number;        // Passages répondus par un agent
    callsAnsweredAndTransferred: number; // Passages répondus puis transférés hors queue
    callsAbandoned: number;       // Passages abandonnés total
    abandonedBefore10s: number;   // Passages abandonnés < 10s
    abandonedAfter10s: number;    // Passages abandonnés >= 10s
    callsToVoicemail: number;     // Messagerie vocale (exclus des reçus)
    callsOverflow: number;        // Passages repartis ailleurs (débordement automatique)

    // APPELS UNIQUES (Method N°2): Count unique calls (DISTINCT call_history_id)
    uniqueCalls: number;          // Nombre d'appels uniques (DISTINCT call_history_id)
    uniqueCallsAnswered: number;  // Appels uniques avec au moins un passage répondu
    uniqueCallsAbandoned: number; // Appels uniques avec au moins un passage abandonné
    uniqueCallsOverflow: number;  // Appels uniques avec au moins un passage overflow

    // PING-PONG METRICS (Method N°2): Measure multi-passage calls
    pingPongCount: number;        // Nombre d'appels avec passages multiples (callsReceived - uniqueCalls)
    pingPongPercentage: number;   // Pourcentage d'appels avec ping-pong ((callsReceived - uniqueCalls) / callsReceived * 100)

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
    // Queue stats
    callsReceived: number;           // Appels uniques queue où le tel a sonné (DISTINCT call_history_id)
    answered: number;                // Appels répondus via la queue
    transferred: number;             // Appels transférés hors queue après réponse
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
