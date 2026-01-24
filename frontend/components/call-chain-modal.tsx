"use client";

import { useState, useEffect, useMemo } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
    Phone,
    PhoneForwarded,
    PhoneOff,
    PhoneMissed,
    ArrowRight,
    Globe,
    Users,
    Clock,
    Shuffle,
    Bell,
    Voicemail,
    Radio,
    RotateCcw,
    RefreshCw
} from "lucide-react";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

import { getCallChain } from "@/services/logs.service";
import type { CallChainSegment, SegmentCategory } from "@/types/logs.types";

interface CallChainModalProps {
    callHistoryId: string | null;
    onClose: () => void;
}

// Category configuration with icons, labels and colors
const categoryConfig: Record<SegmentCategory, {
    icon: typeof Phone;
    label: string;
    className: string;
    description: string;
}> = {
    conversation: {
        icon: Phone,
        label: "Conversation",
        className: "bg-emerald-100 text-emerald-800 border-emerald-200",
        description: "Appel en conversation"
    },
    ringing: {
        icon: Bell,
        label: "Sonnerie",
        className: "bg-amber-100 text-amber-800 border-amber-200",
        description: "Extension a sonné"
    },
    routing: {
        icon: Shuffle,
        label: "Routage",
        className: "bg-slate-100 text-slate-600 border-slate-200",
        description: "Routage système"
    },
    queue: {
        icon: Users,
        label: "File d'attente",
        className: "bg-blue-100 text-blue-800 border-blue-200",
        description: "Attente en file"
    },
    bridge: {
        icon: Globe,
        label: "Bridge",
        className: "bg-purple-100 text-purple-800 border-purple-200",
        description: "Via Bridge EDIFEA"
    },
    ivr: {
        icon: Radio,
        label: "IVR/Script",
        className: "bg-cyan-100 text-cyan-800 border-cyan-200",
        description: "Serveur vocal"
    },
    voicemail: {
        icon: Voicemail,
        label: "Messagerie",
        className: "bg-indigo-100 text-indigo-800 border-indigo-200",
        description: "Messagerie vocale"
    },
    transfer: {
        icon: PhoneForwarded,
        label: "Transfert",
        className: "bg-teal-100 text-teal-800 border-teal-200",
        description: "Transfert en cours"
    },
    missed: {
        icon: PhoneOff,
        label: "Manqué",
        className: "bg-rose-100 text-rose-800 border-rose-200",
        description: "Appel non abouti"
    },
    unknown: {
        icon: PhoneMissed,
        label: "Autre",
        className: "bg-gray-100 text-gray-600 border-gray-200",
        description: "Segment"
    },
};

// Group ringing segments together - including answered calls that started at same time
interface SegmentGroup {
    type: "single" | "ringing_group";
    segments: CallChainSegment[];
    category: SegmentCategory;
    answeredSegment?: CallChainSegment; // The segment that was answered in this group
}

// Check if two segments started at approximately the same time (within 2 seconds)
function sameTimeWindow(time1: string, time2: string): boolean {
    const t1 = new Date(time1).getTime();
    const t2 = new Date(time2).getTime();
    return Math.abs(t1 - t2) < 2000; // 2 seconds tolerance
}

// Check if segment is a queue distribution (route_to polling from queue)
function isQueueDistribution(seg: CallChainSegment): boolean {
    return seg.creationMethod === "route_to" &&
        seg.creationForwardReason === "polling" &&
        seg.destinationType?.toLowerCase() === "extension";
}

function groupSegments(segments: CallChainSegment[]): SegmentGroup[] {
    const groups: SegmentGroup[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];

        // Skip if already processed
        if (processed.has(seg.id)) continue;

        // Check if this is a queue distribution segment
        if (isQueueDistribution(seg)) {
            // Find all segments that started at the same time (simultaneous ring)
            const simultaneousSegments: CallChainSegment[] = [];
            let answeredSeg: CallChainSegment | undefined;

            for (let j = i; j < segments.length; j++) {
                const other = segments[j];
                if (processed.has(other.id)) continue;

                // Check if it's part of same distribution (same start time, queue distribution)
                if (isQueueDistribution(other) && sameTimeWindow(seg.startedAt, other.startedAt)) {
                    simultaneousSegments.push(other);
                    processed.add(other.id);

                    // Track if this segment was answered
                    if (other.answeredAt) {
                        answeredSeg = other;
                    }
                }
            }

            // If we found multiple simultaneous segments, group them as ringing
            if (simultaneousSegments.length > 1) {
                groups.push({
                    type: "ringing_group",
                    segments: simultaneousSegments,
                    category: "ringing",
                    answeredSegment: answeredSeg
                });

                // If someone answered, add a separate conversation group
                if (answeredSeg) {
                    groups.push({
                        type: "single",
                        segments: [answeredSeg],
                        category: "conversation"
                    });
                }
                continue;
            }

            // Single segment - check if it's ringing or conversation
            processed.add(seg.id);
            groups.push({
                type: "single",
                segments: [seg],
                category: seg.category
            });
            continue;
        }

        // Regular segment - just add as single
        processed.add(seg.id);
        groups.push({
            type: "single",
            segments: [seg],
            category: seg.category
        });
    }

    return groups;
}

// Check if segment is "technical" (routing, very short)
function isTechnicalSegment(seg: CallChainSegment): boolean {
    return seg.category === "routing" ||
        (seg.durationSeconds < 1 && seg.terminationReason === "redirected");
}

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

    // Group all segments chronologically (combine ringing)
    const groupedSegments = useMemo(() => groupSegments(segments), [segments]);

    // For each ringing group, find the next conversation segment to identify who answered
    const getNextAnsweringAgent = (groupIndex: number): string | null => {
        // Look for the next conversation group after this ringing group
        for (let i = groupIndex + 1; i < groupedSegments.length; i++) {
            const nextGroup = groupedSegments[i];
            if (nextGroup.category === 'conversation' && nextGroup.segments[0]?.answeredAt) {
                return nextGroup.segments[0].destinationNumber;
            }
            // If we hit another ringing group, stop searching
            if (nextGroup.type === 'ringing_group') {
                break;
            }
        }
        return null;
    };

    // Build a map of destinations that were already called before each segment (for fallback detection)
    // Key: segment id, Value: Set of destination numbers called before this segment
    const previouslyCalledMap = useMemo(() => {
        const map = new Map<string, Set<string>>();
        const calledDestinations = new Set<string>();

        // Sort segments chronologically
        const sortedSegments = [...segments].sort((a, b) =>
            new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
        );

        for (const seg of sortedSegments) {
            // Store the current set of previously called destinations for this segment
            map.set(seg.id, new Set(calledDestinations));
            // Add this destination to the set for future segments
            if (seg.destinationType?.toLowerCase() === 'extension') {
                calledDestinations.add(seg.destinationNumber);
            }
        }
        return map;
    }, [segments]);

    // Detect if a segment is a "fallback" (transfer to a previously called destination)
    const isFallbackSegment = (seg: CallChainSegment): boolean => {
        // Fallback conditions:
        // 1. Creation method is 'transfer' (not 'route_to' from queue polling)
        // 2. Destination was already called earlier in the call
        // 3. It's an extension (not queue, script, etc.)
        const previouslyCalled = previouslyCalledMap.get(seg.id);
        return (
            seg.creationMethod === 'transfer' &&
            seg.destinationType?.toLowerCase() === 'extension' &&
            previouslyCalled?.has(seg.destinationNumber) === true
        );
    };

    // Detect if a segment is a "retry" (busy rejection followed by another attempt to same agent)
    // Returns the retry count (0 = not a retry, 1 = first retry, 2 = second retry, etc.)
    const retryCountMap = useMemo(() => {
        const map = new Map<string, number>();
        const busyAttempts = new Map<string, number>(); // destinationNumber -> count of busy attempts

        // Sort segments chronologically
        const sortedSegments = [...segments].sort((a, b) =>
            new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
        );

        for (const seg of sortedSegments) {
            if (seg.destinationType?.toLowerCase() !== 'extension') continue;

            const destNum = seg.destinationNumber;
            const currentCount = busyAttempts.get(destNum) || 0;

            // If this segment ended with 'busy', increment the counter
            if (seg.terminationReasonDetails === 'busy' || seg.terminationReason === 'rejected') {
                busyAttempts.set(destNum, currentCount + 1);
                // If it's not the first attempt, mark as retry
                if (currentCount > 0) {
                    map.set(seg.id, currentCount);
                }
            } else if (seg.answeredAt) {
                // If answered, check if there were previous busy attempts
                if (currentCount > 0) {
                    map.set(seg.id, currentCount); // Mark as "finally answered after retries"
                }
                // Reset the counter
                busyAttempts.set(destNum, 0);
            }
        }
        return map;
    }, [segments]);

    const formatTime = (iso: string) => {
        if (!iso) return "-";
        return format(new Date(iso), "HH:mm:ss", { locale: fr });
    };

    const renderSegment = (seg: CallChainSegment, isCompact: boolean = false, categoryOverride?: SegmentCategory) => {
        const effectiveCategory = categoryOverride || seg.category;
        const config = categoryConfig[effectiveCategory];
        const Icon = config.icon;

        if (isCompact) {
            return (
                <div key={seg.id} className="flex items-center gap-2 text-xs py-1 px-2 bg-slate-50 rounded">
                    <Icon className="h-3 w-3 text-slate-400" />
                    <span className="text-slate-500">{formatTime(seg.startedAt)}</span>
                    <span className="text-slate-600">{seg.destinationName || seg.destinationNumber}</span>
                    <span className="text-slate-400">({seg.durationSeconds}s)</span>
                    <span className="text-slate-400">{seg.terminationReasonDetails || seg.terminationReason}</span>
                </div>
            );
        }

        // Calculate talk duration for conversation segments (from answer to end)
        let displayDuration = seg.durationFormatted;
        let durationLabel = "Durée";
        if (effectiveCategory === "conversation" && seg.answeredAt) {
            const answerTime = new Date(seg.answeredAt).getTime();
            const startTime = new Date(seg.startedAt).getTime();
            const talkSeconds = seg.durationSeconds - Math.round((answerTime - startTime) / 1000);
            const minutes = Math.floor(talkSeconds / 60);
            const seconds = talkSeconds % 60;
            displayDuration = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            durationLabel = "Conversation";
        }

        // Check for special indicators
        const isFallback = isFallbackSegment(seg);
        const retryCount = retryCountMap.get(seg.id) || 0;

        return (
            <div className="flex-1 bg-white rounded-lg p-4 border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-900">
                        {formatTime(seg.startedAt)}
                    </span>
                    <div className="flex items-center gap-1">
                        {isFallback && (
                            <Badge variant="outline" className="bg-orange-100 text-orange-700 border-orange-300" title="Fallback - Retour vers une destination déjà appelée">
                                <RotateCcw className="h-3 w-3 mr-1" />
                                Fallback
                            </Badge>
                        )}
                        {retryCount > 0 && (
                            <Badge variant="outline" className="bg-violet-100 text-violet-700 border-violet-300" title={`Tentative #${retryCount + 1} - Agent était occupé précédemment`}>
                                <RefreshCw className="h-3 w-3 mr-1" />
                                Retry #{retryCount + 1}
                            </Badge>
                        )}
                        <Badge variant="outline" className={config.className}>
                            {config.label}
                        </Badge>
                    </div>
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
                <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100 text-xs text-slate-500">
                    <span>{durationLabel}: {displayDuration}</span>
                    <span className="text-slate-400">
                        {seg.terminationReasonDetails || seg.terminationReason}
                    </span>
                </div>
            </div>
        );
    };

    const renderRingingGroup = (group: SegmentGroup, groupIndex: number) => {
        const config = categoryConfig.ringing;
        const Icon = config.icon;
        const answered = group.answeredSegment;
        const ringDuration = Math.max(...group.segments.filter(s => !s.answeredAt).map(s => s.durationSeconds));

        // Find who answered right after this ringing group
        const nextAnsweringAgent = getNextAnsweringAgent(groupIndex);

        return (
            <div className={`flex-1 bg-white rounded-lg p-4 border shadow-sm ${answered ? 'border-green-300' : 'border-amber-200'}`}>
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-900">
                        {formatTime(group.segments[0].startedAt)}
                    </span>
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className={config.className}>
                            <Bell className="h-3 w-3 mr-1" />
                            {group.segments.length} agent{group.segments.length > 1 ? "s" : ""}
                        </Badge>
                        {answered && (
                            <Badge variant="outline" className="bg-green-100 text-green-700 border-green-300">
                                <Phone className="h-3 w-3 mr-1" />
                                Répondu
                            </Badge>
                        )}
                    </div>
                </div>

                <div className="text-sm text-slate-600 mb-2">
                    <span className="font-medium">Distribution simultanée:</span>
                </div>

                <div className="flex flex-wrap gap-1 mb-2">
                    {group.segments.map(seg => {
                        const isAnsweredHere = seg.answeredAt !== null;
                        // Check if this agent answered right after this ringing group
                        const answeredNext = !isAnsweredHere && nextAnsweringAgent === seg.destinationNumber;
                        const showAsSuccess = isAnsweredHere || answeredNext;
                        // Check if this is a retry (agent was busy before)
                        const retryCount = retryCountMap.get(seg.id) || 0;
                        const isBusy = seg.terminationReasonDetails === 'busy';

                        // Determine styling: green for success, violet for busy/retry, orange for elsewhere, amber for others
                        let badgeClass = 'bg-amber-50 text-amber-700 border-amber-200';
                        if (showAsSuccess) {
                            badgeClass = 'bg-green-50 text-green-700 border-green-300 font-medium';
                        } else if (isBusy || retryCount > 0) {
                            badgeClass = 'bg-violet-50 text-violet-700 border-violet-300';
                        }

                        return (
                            <span
                                key={seg.id}
                                className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${badgeClass}`}
                                title={
                                    answeredNext ? 'A répondu juste après' :
                                        isBusy ? 'Agent occupé - sera retenté' :
                                            retryCount > 0 ? `Tentative #${retryCount + 1}` :
                                                undefined
                                }
                            >
                                {isBusy && <RefreshCw className="h-3 w-3 mr-1" />}
                                {seg.destinationName || seg.destinationNumber}
                                {isAnsweredHere && <span className="ml-1">✓</span>}
                                {answeredNext && <span className="ml-1">↩</span>}
                                {isBusy && <span className="ml-1 text-violet-500">(occupé)</span>}
                                {!showAsSuccess && !isBusy && seg.terminationReasonDetails === "completed_elsewhere" && (
                                    <span className="ml-1 text-slate-400">(ailleurs)</span>
                                )}
                            </span>
                        );
                    })}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500">
                    <span>Sonnerie: ~{ringDuration || 11}s</span>
                    <span className="text-slate-400">
                        {answered ? answered.terminationReason : (group.segments[0].terminationReasonDetails || "annulé")}
                    </span>
                </div>
            </div>
        );
    };

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
                    <div className="space-y-4 py-4">
                        {/* Summary bar */}
                        <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 p-2 rounded">
                            <Clock className="h-4 w-4" />
                            <span>{segments.length} segment{segments.length > 1 ? "s" : ""}</span>
                        </div>

                        {/* Main Timeline */}
                        <div className="relative">
                            {groupedSegments.map((group, idx) => {
                                const config = categoryConfig[group.category];
                                const Icon = config.icon;
                                const isLast = idx === groupedSegments.length - 1;

                                return (
                                    <div key={idx} className="relative flex gap-4 pb-4">
                                        {/* Timeline line */}
                                        {!isLast && (
                                            <div className="absolute left-[19px] top-10 w-0.5 h-full bg-slate-200" />
                                        )}

                                        {/* Icon */}
                                        <div className={`relative z-10 flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center border ${config.className}`}>
                                            <Icon className="h-5 w-5" />
                                        </div>

                                        {/* Content */}
                                        {group.type === "ringing_group" ? (
                                            renderRingingGroup(group, idx)
                                        ) : (
                                            renderSegment(group.segments[0], false, group.category)
                                        )}
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
