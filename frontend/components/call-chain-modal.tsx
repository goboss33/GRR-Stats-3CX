"use client";

import { getSelectedServer } from "@/lib/selected-server";

import { useState, useEffect } from "react";
import { Phone } from "lucide-react";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

import { CallChainTimeline } from "@/components/call-chain-timeline";
import { getCallChain } from "@/services/logs.service";
import type { CallChainSegment } from "@/types/logs.types";


interface CallChainModalProps {
    callHistoryId: string | null;
    onClose: () => void;
}

export function CallChainModal({ callHistoryId, onClose }: CallChainModalProps) {
    const [segments, setSegments] = useState<CallChainSegment[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (callHistoryId) {
            setIsLoading(true);
            const serverId = getSelectedServer();
            getCallChain(serverId, callHistoryId)
                .then(setSegments)
                .finally(() => setIsLoading(false));
        }
    }, [callHistoryId]);

    return (
        <Dialog open={!!callHistoryId} onOpenChange={() => onClose()}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Phone className="h-5 w-5" />
                        Chaîne d&apos;appel
                        <span className="text-sm font-mono text-slate-500">
                            {callHistoryId}
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
                    <CallChainTimeline segments={segments} />
                )}
            </DialogContent>
        </Dialog>
    );
}
