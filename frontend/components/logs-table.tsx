"use client";

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CallLog, CallDirection } from "@/types/logs.types";

interface LogsTableProps {
    logs: CallLog[];
    isLoading?: boolean;
}

const directionBadge: Record<CallDirection, { label: string; className: string }> = {
    inbound: {
        label: "Entrant",
        className: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
    },
    outbound: {
        label: "Sortant",
        className: "bg-blue-100 text-blue-800 hover:bg-blue-100",
    },
    internal: {
        label: "Interne",
        className: "bg-slate-100 text-slate-800 hover:bg-slate-100",
    },
};

function formatDateTime(isoString: string): string {
    if (!isoString) return "-";
    return format(new Date(isoString), "dd/MM/yyyy HH:mm:ss", { locale: fr });
}

export function LogsTable({ logs, isLoading }: LogsTableProps) {
    if (isLoading) {
        return (
            <div className="h-96 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
            </div>
        );
    }

    if (logs.length === 0) {
        return (
            <div className="h-96 flex items-center justify-center bg-slate-50 rounded-lg border-2 border-dashed border-slate-200">
                <p className="text-slate-500">Aucun appel trouvé pour ces critères</p>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow className="bg-slate-50">
                        <TableHead className="w-[80px]">Ch. ID</TableHead>
                        <TableHead className="w-[160px]">Date/Heure</TableHead>
                        <TableHead>De</TableHead>
                        <TableHead>Vers</TableHead>
                        <TableHead className="w-[100px] text-center">Direction</TableHead>
                        <TableHead className="w-[90px] text-center">Statut</TableHead>
                        <TableHead className="w-[80px] text-right">Durée</TableHead>
                        <TableHead className="w-[140px]">Raison</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {logs.map((log) => {
                        const dirBadge = directionBadge[log.direction];
                        return (
                            <TableRow key={log.id} className="hover:bg-slate-50">
                                <TableCell className="font-mono text-xs text-slate-500">
                                    {log.callHistoryId}
                                </TableCell>
                                <TableCell className="text-sm">
                                    {formatDateTime(log.startedAt)}
                                </TableCell>
                                <TableCell>
                                    <div>
                                        <span className="font-mono font-medium">
                                            {log.sourceNumber}
                                        </span>
                                        <span className="ml-2 text-xs text-slate-500">
                                            {log.sourceType}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div>
                                        <span className="font-mono font-medium">
                                            {log.destinationNumber}
                                        </span>
                                        <span className="ml-2 text-xs text-slate-500">
                                            {log.destinationType}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell className="text-center">
                                    <Badge variant="outline" className={dirBadge.className}>
                                        {dirBadge.label}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-center">
                                    <Badge
                                        variant="outline"
                                        className={
                                            log.status === "answered"
                                                ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
                                                : "bg-rose-100 text-rose-800 hover:bg-rose-100"
                                        }
                                    >
                                        {log.status === "answered" ? "Répondu" : "Manqué"}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                    {log.durationFormatted}
                                </TableCell>
                                <TableCell className="text-xs text-slate-600 truncate max-w-[140px]">
                                    {log.terminationReason}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
