"use client";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ColumnVisibility } from "@/types/logs.types";

export function LogsTableSkeleton({ columnVisibility }: { columnVisibility: ColumnVisibility }) {
    return (
        <TooltipProvider delayDuration={0}>
            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-slate-50 hover:bg-slate-50">
                            {columnVisibility.callHistoryId && <TableHead className="w-20">ID</TableHead>}
                            {columnVisibility.segmentCount && <TableHead className="w-16 text-center">Seg.</TableHead>}
                            {columnVisibility.dateTime && <TableHead className="w-40">Date</TableHead>}
                            {columnVisibility.timeSlot && <TableHead>Heure</TableHead>}
                            {columnVisibility.caller && <TableHead>Appelant</TableHead>}
                            {columnVisibility.callee && <TableHead>Destinataire</TableHead>}
                            {columnVisibility.handledBy && <TableHead>Traité par</TableHead>}
                            {columnVisibility.queues && <TableHead>Queue(s)</TableHead>}
                            {columnVisibility.journey && <TableHead>Parcours</TableHead>}
                            {columnVisibility.provenance && <TableHead>Provenance</TableHead>}
                            {columnVisibility.sens && <TableHead>Sens</TableHead>}
                            {columnVisibility.status && <TableHead>Statut</TableHead>}
                            {columnVisibility.duration && <TableHead>Durée</TableHead>}
                            {columnVisibility.waitTime && <TableHead>Attente</TableHead>}
                            <TableHead className="w-10" />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {Array.from({ length: 8 }).map((_, i) => (
                            <TableRow key={i} className="opacity-60">
                                {columnVisibility.callHistoryId && (
                                    <TableCell><Skeleton className="h-4 w-10" /></TableCell>
                                )}
                                {columnVisibility.segmentCount && (
                                    <TableCell><Skeleton className="h-5 w-6 mx-auto" /></TableCell>
                                )}
                                {columnVisibility.dateTime && (
                                    <TableCell>
                                        <Skeleton className="h-4 w-20 mb-1" />
                                        <Skeleton className="h-3 w-14" />
                                    </TableCell>
                                )}
                                {columnVisibility.timeSlot && (
                                    <TableCell><Skeleton className="h-4 w-14" /></TableCell>
                                )}
                                {columnVisibility.caller && (
                                    <TableCell>
                                        <Skeleton className="h-4 w-24 mb-1" />
                                        <Skeleton className="h-3 w-16" />
                                    </TableCell>
                                )}
                                {columnVisibility.callee && (
                                    <TableCell>
                                        <Skeleton className="h-4 w-24 mb-1" />
                                        <Skeleton className="h-3 w-16" />
                                    </TableCell>
                                )}
                                {columnVisibility.handledBy && (
                                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                                )}
                                {columnVisibility.queues && (
                                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                                )}
                                {columnVisibility.journey && (
                                    <TableCell>
                                        <div className="flex gap-1">
                                            <Skeleton className="h-6 w-16 rounded-full" />
                                            <Skeleton className="h-6 w-16 rounded-full" />
                                        </div>
                                    </TableCell>
                                )}
                                {columnVisibility.provenance && (
                                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                                )}
                                {columnVisibility.sens && (
                                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                                )}
                                {columnVisibility.status && (
                                    <TableCell><Skeleton className="h-5 w-18 rounded-full" /></TableCell>
                                )}
                                {columnVisibility.duration && (
                                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                                )}
                                {columnVisibility.waitTime && (
                                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                                )}
                                <TableCell />
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </TooltipProvider>
    );
}
