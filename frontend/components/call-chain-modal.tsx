"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { X, ArrowRight, Phone, PhoneOff, PhoneMissed } from "lucide-react";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

import { getCallChain } from "@/services/logs.service";
import type { CallChainSegment, CallStatus } from "@/types/logs.types";

interface CallChainModalProps {
    callHistoryId: string | null;
    onClose: () => void;
}

const statusConfig: Record<CallStatus, { icon: typeof Phone; label: string; className: string }> = {
    answered: { icon: Phone, label: "Répondu", className: "bg-emerald-100 text-emerald-800" },
    missed: { icon: PhoneOff, label: "Manqué", className: "bg-rose-100 text-rose-800" },
    abandoned: { icon: PhoneMissed, label: "Abandonné", className: "bg-amber-100 text-amber-800" },
};

export function CallChainModal({ callHistoryId, onClose }: CallChainModalProps) {
    const [segments, setSegments] = useState<CallChainSegment[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (callHistoryId) {
            setIsLoading(true);
            getCallChain(callHistoryId)
                .then(setSegments)
                .finally(() => setIsLoading(false));
        }
    }, [callHistoryId]);

    const formatTime = (iso: string) => {
        if (!iso) return "-";
        return format(new Date(iso), "HH:mm:ss", { locale: fr });
    };

    return (
        <Dialog open={!!callHistoryId} onOpenChange={() => onClose()}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Phone className="h-5 w-5" />
                        Chaîne d&apos;appel
                        <span className="text-sm font-mono text-slate-500">
                            ...{callHistoryId?.slice(-8)}
                        </span>
                    </DialogTitle>
                </DialogHeader>

                {isLoading ? (
                    <div className="h-48 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" />
                    </div>
                ) : segments.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                        Aucun segment trouvé
                    </div>
                ) : (
                    <div className="space-y-4 py-4">
                        {/* Timeline */}
                        <div className="relative">
                            {segments.map((seg, idx) => {
                                const config = statusConfig[seg.status];
                                const Icon = config.icon;
                                const isLast = idx === segments.length - 1;

                                return (
                                    <div key={seg.id} className="relative flex gap-4 pb-6">
                                        {/* Timeline line */}
                                        {!isLast && (
                                            <div className="absolute left-[19px] top-10 w-0.5 h-full bg-slate-200" />
                                        )}

                                        {/* Icon */}
                                        <div className={`relative z-10 flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${config.className}`}>
                                            <Icon className="h-5 w-5" />
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 bg-slate-50 rounded-lg p-4 border border-slate-200">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-sm font-medium text-slate-900">
                                                    {formatTime(seg.startedAt)}
                                                </span>
                                                <Badge variant="outline" className={config.className}>
                                                    {config.label}
                                                </Badge>
                                            </div>

                                            {/* Source → Destination */}
                                            <div className="flex items-center gap-2 text-sm">
                                                <div className="flex-1">
                                                    <div className="font-mono font-medium">{seg.sourceNumber}</div>
                                                    {seg.sourceName && (
                                                        <div className="text-xs text-slate-500">{seg.sourceName}</div>
                                                    )}
                                                    <div className="text-xs text-slate-400">{seg.sourceType}</div>
                                                </div>

                                                <ArrowRight className="h-4 w-4 text-slate-400 flex-shrink-0" />

                                                <div className="flex-1 text-right">
                                                    <div className="font-mono font-medium">{seg.destinationNumber}</div>
                                                    {seg.destinationName && (
                                                        <div className="text-xs text-slate-500">{seg.destinationName}</div>
                                                    )}
                                                    <div className="text-xs text-slate-400">{seg.destinationType}</div>
                                                </div>
                                            </div>

                                            {/* Footer */}
                                            <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-200 text-xs text-slate-500">
                                                <span>Durée: {seg.durationFormatted}</span>
                                                <span>{seg.terminationReason}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
