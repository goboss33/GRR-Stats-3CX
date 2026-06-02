import type { CallStatus, CallDirection } from "@/services/domain/call.types";

export interface ExtensionStats {
    extension: string;
    totalCalls: number;
    inbound: {
        total: number;
        answered: number;
        missed: number;
        voicemail: number;
        busy: number;
        answerRate: number;
    };
    outbound: {
        total: number;
        successful: number;
        failed: number;
    };
    duration: {
        totalSeconds: number;
        averageSeconds: number;
        maxSeconds: number;
        totalFormatted: string;
        averageFormatted: string;
        maxFormatted: string;
    };
}

export interface ExtensionStatisticsResponse {
    extensions: ExtensionStats[];
    period: {
        start: string;
        end: string;
    };
    totals: {
        totalCalls: number;
        totalInbound: number;
        totalOutbound: number;
        totalAnswered: number;
        totalMissed: number;
        overallAnswerRate: number;
        totalDurationSeconds: number;
        averageDurationSeconds: number;
    };
}
