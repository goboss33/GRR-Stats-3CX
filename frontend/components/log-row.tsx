"use client";

import * as React from "react";
import { Phone } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { AggregatedCallLog, ColumnVisibility } from "@/types/logs.types";
import {
    directionConfig,
    statusConfig,
    getSegmentBadgeColor,
    getWaitTimeColor,
    getJourneyStepStyle,
    queueOutcomeConfig,
    formatDateTime,
    formatTime,
} from "@/components/logs-table-helpers";

interface LogRowProps {
    log: AggregatedCallLog;
    columnVisibility: ColumnVisibility;
    onRowClick?: (callHistoryId: string) => void;
}

export function LogRow({ log, columnVisibility, onRowClick }: LogRowProps) {
    const dirConfig = directionConfig[log.direction];
    const statConfig = statusConfig[log.finalStatus];
    const DirIcon = dirConfig.icon;
    const StatIcon = statConfig.icon;

    return (
        <TableRow
            key={log.callHistoryId}
            className="cursor-pointer hover:bg-slate-50 transition-colors"
            onClick={() => onRowClick?.(log.callHistoryId)}
        >
            {/* ID column */}
            {columnVisibility.callHistoryId && (
                <TableCell className="font-mono text-xs">
                    <span className="text-slate-500">{log.callHistoryIdShort}</span>
                </TableCell>
            )}

            {/* Segment count column */}
            {columnVisibility.segmentCount && (
                <TableCell className="text-center">
                    <Badge
                        variant="secondary"
                        className={`text-[10px] px-1.5 py-0.5 ${getSegmentBadgeColor(log.segmentCount)}`}
                    >
                        {log.segmentCount}
                    </Badge>
                </TableCell>
            )}

            {/* Date/Time */}
            {columnVisibility.dateTime && (
                <TableCell className="text-sm tabular-nums">
                    {formatDateTime(log.startedAt)}
                </TableCell>
            )}

            {/* Time */}
            {columnVisibility.timeSlot && (
                <TableCell className="text-sm tabular-nums text-slate-600">
                    {formatTime(log.startedAt)}
                </TableCell>
            )}

            {/* Caller */}
            {columnVisibility.caller && (
                <TableCell>
                    <div className="flex flex-col">
                        <span className="font-medium text-sm">{log.callerNumber}</span>
                        {log.callerName && (
                            <span className="text-xs text-slate-500 truncate max-w-[180px]">
                                {log.callerName}
                            </span>
                        )}
                    </div>
                </TableCell>
            )}

            {/* Callee (initial destination) */}
            {columnVisibility.callee && (
                <TableCell>
                    <div className="flex flex-col">
                        <span className={`font-medium text-sm ${log.finalStatus !== "answered" ? "text-slate-400 italic" : ""}`}>
                            {log.calleeNumber}
                        </span>
                        {log.calleeName && (
                            <span className={`text-xs truncate max-w-[180px] ${log.finalStatus !== "answered" ? "text-slate-400 italic" : "text-slate-500"}`}>
                                {log.calleeName}
                            </span>
                        )}
                    </div>
                </TableCell>
            )}

            {/* Handled By - same format as Appelant/Destinataire */}
            {columnVisibility.handledBy && (
                <TableCell>
                    {log.handledBy && log.handledBy.length > 0 ? (
                        <div className="flex flex-col">
                            <span className="font-medium text-sm">
                                {log.handledBy[0].number}
                            </span>
                            <span className="text-xs text-slate-500 truncate max-w-[180px]">
                                {log.handledBy[0].name || log.handledBy[0].number}
                                {log.handledBy.length > 1 && (
                                    <span className="text-slate-400"> +{log.handledBy.length - 1}</span>
                                )}
                            </span>
                        </div>
                    ) : (
                        <span className="text-xs text-slate-300">-</span>
                    )}
                </TableCell>
            )}

            {/* Queue(s) */}
            {columnVisibility.queues && (
                <TableCell>
                    {log.queues && log.queues.length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                            {log.queues.slice(0, 2).map((q, idx) => (
                                <span key={idx} className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 truncate max-w-[140px]" title={q.name}>
                                    {q.name || q.number}
                                </span>
                            ))}
                            {log.queues.length > 2 && (
                                <span className="text-[10px] text-slate-400">+{log.queues.length - 2}</span>
                            )}
                        </div>
                    ) : (
                        <span className="text-xs text-slate-300">-</span>
                    )}
                </TableCell>
            )}

            {/* Parcours (Journey) */}
            {columnVisibility.journey && (
                <TableCell>
                    {log.journey && log.journey.length > 0 ? (() => {
                        const maxVisible = 8;
                        const visibleSteps = log.journey.slice(-maxVisible);
                        const hiddenCount = log.journey.length - maxVisible;
                        return (
                            <div className="flex items-center gap-0.5">
                                {hiddenCount > 0 && (
                                    <>
                                        <span className="text-[10px] text-slate-400">[+{hiddenCount}]</span>
                                        <span className="text-slate-300 text-xs mx-0.5">→</span>
                                    </>
                                )}
                                {visibleSteps.map((step, idx) => {
                                    const config = getJourneyStepStyle(step);
                                    return (
                                        <React.Fragment key={idx}>
                                            {idx > 0 && (
                                                visibleSteps[idx - 1].result === 'overflow' ? (
                                                    <span className="text-amber-500 text-xs mx-0.5">↝</span>
                                                ) : (
                                                    <span className="text-slate-300 text-xs mx-0.5">→</span>
                                                )
                                            )}
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <span
                                                        className={`inline-flex items-center justify-center cursor-default ${config.className}`}
                                                    >
                                                        {config.icon}
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent side="top" className="text-xs max-w-[200px]">
                                                    <div className="flex flex-col gap-1">
                                                        <span>{step.detail}</span>
                                                        {step.agent && (
                                                            <div className={`flex items-center gap-1 font-medium ${config.className}`}>
                                                                <Phone className="w-3 h-3" />
                                                                <span>{step.agent}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </TooltipContent>
                                            </Tooltip>
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                        );
                    })() : (
                        <span className="text-xs text-slate-300">-</span>
                    )}
                </TableCell>
            )}

            {/* Direction */}
            {columnVisibility.direction && (
                <TableCell className="text-center">
                    <Badge variant="secondary" className={`gap-1 ${dirConfig.className}`}>
                        <DirIcon className="h-3 w-3" />
                        {dirConfig.label}
                    </Badge>
                </TableCell>
            )}

            {/* Status */}
            {/* Vue file : statut de l'appel DANS la file consultée. */}
            {log.queueViewStatus && (
                <TableCell className="text-center">
                    <Badge variant="secondary" className={queueOutcomeConfig[log.queueViewStatus].className}>
                        {queueOutcomeConfig[log.queueViewStatus].label}
                    </Badge>
                </TableCell>
            )}

            {columnVisibility.status && (
                <TableCell className="text-center">
                    <Badge variant="secondary" className={`gap-1 ${statConfig.className}`}>
                        <StatIcon className="h-3 w-3" />
                        {statConfig.label}
                    </Badge>
                    {/* Ce que la file consultée n'a pas traité a pu l'être
                        ailleurs : le dire évite de laisser croire à une perte
                        sèche. */}
                    {log.answeringQueue && (
                        <div className="mt-0.5 text-[10px] text-slate-500 truncate">
                            → {log.answeringQueue.number
                                ? `${log.answeringQueue.number} – ${log.answeringQueue.name}`
                                : log.answeringQueue.name}
                        </div>
                    )}
                </TableCell>
            )}

            {/* Total Duration */}
            {columnVisibility.duration && (
                <TableCell className="text-right font-mono text-sm tabular-nums">
                    {log.totalDurationFormatted}
                </TableCell>
            )}

            {/* Wait Time with color */}
            {columnVisibility.waitTime && (
                <TableCell className={`text-right font-mono text-sm tabular-nums ${getWaitTimeColor(log.waitTimeSeconds)}`}>
                    {log.waitTimeFormatted}
                </TableCell>
            )}
        </TableRow>
    );
}
