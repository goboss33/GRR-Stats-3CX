"use client";

import { QueueKPIs } from "@/types/statistics.types";
import { Card, CardContent } from "@/components/ui/card";
import { Users, Phone, PhoneIncoming, PhoneMissed, ArrowRightLeft, Voicemail } from "lucide-react";

interface TeamBannerProps {
    kpis: QueueKPIs;
    queueName: string;
}

export function TeamBanner({ kpis, queueName }: TeamBannerProps) {
    const totalAnswered = kpis.callsAnswered + kpis.teamDirectAnswered;
    const queueRate = kpis.callsReceived > 0
        ? Math.round((kpis.callsAnswered / kpis.callsReceived) * 100)
        : 0;
    const directRate = kpis.teamDirectReceived > 0
        ? Math.round((kpis.teamDirectAnswered / kpis.teamDirectReceived) * 100)
        : 0;

    return (
        <Card className="border-blue-200 bg-gradient-to-r from-blue-50/80 to-slate-50/80">
            <CardContent className="py-5 px-6">
                <div className="flex flex-col gap-3">
                    {/* Header */}
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                        <Users className="h-4 w-4" />
                        <span>Bilan de l'équipe · {queueName}</span>
                    </div>

                    {/* Main metric: total answered */}
                    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                        <div className="flex items-center gap-2">
                            <Phone className="h-5 w-5 text-emerald-600" />
                            <span className="text-3xl font-bold text-slate-900">{totalAnswered}</span>
                            <span className="text-sm text-slate-500">appels répondus</span>
                        </div>

                        {/* Breakdown: Queue + Directs */}
                        <div className="flex flex-wrap items-center gap-4 text-sm">
                            <div className="flex items-center gap-1.5">
                                <PhoneIncoming className="h-4 w-4 text-emerald-600" />
                                <span className="text-slate-600">Queue:</span>
                                <span className="font-semibold text-emerald-700">
                                    {kpis.callsAnswered}/{kpis.callsReceived}
                                </span>
                                <span className="text-xs text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full font-medium">
                                    {queueRate}%
                                </span>
                            </div>
                            <span className="text-slate-300">·</span>
                            <div className="flex items-center gap-1.5">
                                <Phone className="h-4 w-4 text-blue-600" />
                                <span className="text-slate-600">Directs:</span>
                                <span className="font-semibold text-blue-700">
                                    {kpis.teamDirectAnswered}/{kpis.teamDirectReceived}
                                </span>
                                <span className="text-xs text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full font-medium">
                                    {directRate}%
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Secondary: abandoned, overflow, voicemail */}
                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                        <div className="flex items-center gap-1">
                            <PhoneMissed className="h-3.5 w-3.5 text-red-500" />
                            <span>{kpis.callsAbandoned} abandonné{kpis.callsAbandoned !== 1 ? "s" : ""}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <ArrowRightLeft className="h-3.5 w-3.5 text-amber-500" />
                            <span>{kpis.callsOverflow} redirigé{kpis.callsOverflow !== 1 ? "s" : ""}</span>
                        </div>
                        {kpis.callsToVoicemail > 0 && (
                            <div className="flex items-center gap-1">
                                <Voicemail className="h-3.5 w-3.5 text-purple-500" />
                                <span>{kpis.callsToVoicemail} messagerie</span>
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
