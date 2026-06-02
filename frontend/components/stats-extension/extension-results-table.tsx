"use client";

import { useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { ExtensionStats } from "@/types/extension-stats.types";

interface ExtensionResultsTableProps {
    extensions: ExtensionStats[];
}

type SortField = "extension" | "totalCalls" | "inbound" | "outbound" | "answered" | "missed" | "answerRate" | "duration";
type SortDirection = "asc" | "desc";

export function ExtensionResultsTable({ extensions }: ExtensionResultsTableProps) {
    const [sortField, setSortField] = useState<SortField>("totalCalls");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
        } else {
            setSortField(field);
            setSortDirection("desc");
        }
    };

    const sortedExtensions = [...extensions].sort((a, b) => {
        let aValue: number | string;
        let bValue: number | string;

        switch (sortField) {
            case "extension":
                aValue = a.extension;
                bValue = b.extension;
                break;
            case "totalCalls":
                aValue = a.totalCalls;
                bValue = b.totalCalls;
                break;
            case "inbound":
                aValue = a.inbound.total;
                bValue = b.inbound.total;
                break;
            case "outbound":
                aValue = a.outbound.total;
                bValue = b.outbound.total;
                break;
            case "answered":
                aValue = a.inbound.answered;
                bValue = b.inbound.answered;
                break;
            case "missed":
                aValue = a.inbound.missed;
                bValue = b.inbound.missed;
                break;
            case "answerRate":
                aValue = a.inbound.answerRate;
                bValue = b.inbound.answerRate;
                break;
            case "duration":
                aValue = a.duration.totalSeconds;
                bValue = b.duration.totalSeconds;
                break;
            default:
                return 0;
        }

        if (typeof aValue === "string" && typeof bValue === "string") {
            return sortDirection === "asc"
                ? aValue.localeCompare(bValue)
                : bValue.localeCompare(aValue);
        }

        return sortDirection === "asc"
            ? (aValue as number) - (bValue as number)
            : (bValue as number) - (aValue as number);
    });

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) {
            return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
        }
        return sortDirection === "asc"
            ? <ArrowUp className="h-3 w-3 ml-1" />
            : <ArrowDown className="h-3 w-3 ml-1" />;
    };

    return (
        <div className="border rounded-lg">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50"
                            onClick={() => handleSort("extension")}
                        >
                            <div className="flex items-center">
                                Extension
                                <SortIcon field="extension" />
                            </div>
                        </TableHead>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50 text-right"
                            onClick={() => handleSort("totalCalls")}
                        >
                            <div className="flex items-center justify-end">
                                Total
                                <SortIcon field="totalCalls" />
                            </div>
                        </TableHead>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50 text-right"
                            onClick={() => handleSort("inbound")}
                        >
                            <div className="flex items-center justify-end">
                                Entrants
                                <SortIcon field="inbound" />
                            </div>
                        </TableHead>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50 text-right"
                            onClick={() => handleSort("outbound")}
                        >
                            <div className="flex items-center justify-end">
                                Sortants
                                <SortIcon field="outbound" />
                            </div>
                        </TableHead>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50 text-right"
                            onClick={() => handleSort("answered")}
                        >
                            <div className="flex items-center justify-end">
                                Répondus
                                <SortIcon field="answered" />
                            </div>
                        </TableHead>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50 text-right"
                            onClick={() => handleSort("missed")}
                        >
                            <div className="flex items-center justify-end">
                                Manqués
                                <SortIcon field="missed" />
                            </div>
                        </TableHead>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50 text-right"
                            onClick={() => handleSort("answerRate")}
                        >
                            <div className="flex items-center justify-end">
                                Taux rép.
                                <SortIcon field="answerRate" />
                            </div>
                        </TableHead>
                        <TableHead
                            className="cursor-pointer hover:bg-slate-50 text-right"
                            onClick={() => handleSort("duration")}
                        >
                            <div className="flex items-center justify-end">
                                Durée totale
                                <SortIcon field="duration" />
                            </div>
                        </TableHead>
                        <TableHead className="text-right">Durée moy.</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {sortedExtensions.map((ext) => (
                        <TableRow key={ext.extension}>
                            <TableCell className="font-medium">
                                <Badge variant="secondary" className="font-mono">
                                    {ext.extension}
                                </Badge>
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                                {ext.totalCalls}
                            </TableCell>
                            <TableCell className="text-right">
                                {ext.inbound.total}
                            </TableCell>
                            <TableCell className="text-right">
                                {ext.outbound.total}
                            </TableCell>
                            <TableCell className="text-right text-emerald-600">
                                {ext.inbound.answered}
                            </TableCell>
                            <TableCell className="text-right text-red-600">
                                {ext.inbound.missed}
                            </TableCell>
                            <TableCell className="text-right">
                                <Badge
                                    variant={ext.inbound.answerRate >= 70 ? "default" : "secondary"}
                                    className={ext.inbound.answerRate >= 70 ? "bg-emerald-100 text-emerald-800 border-emerald-200" : ""}
                                >
                                    {ext.inbound.answerRate}%
                                </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                                {ext.duration.totalFormatted}
                            </TableCell>
                            <TableCell className="text-right text-slate-600">
                                {ext.duration.averageFormatted}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
