"use client";

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { RecentCall } from "@/types/stats.types";

interface RecentCallsTableProps {
    data: RecentCall[];
}

export function RecentCallsTable({ data }: RecentCallsTableProps) {
    if (!data || data.length === 0) {
        return (
            <div className="h-full flex items-center justify-center bg-slate-50 rounded-lg border-2 border-dashed border-slate-200 p-6">
                <p className="text-slate-500">Aucun appel récent</p>
            </div>
        );
    }

    const formatDateTime = (isoString: string) => {
        if (!isoString) return "-";
        const date = new Date(isoString);
        return format(date, "dd/MM HH:mm", { locale: fr });
    };

    return (
        <div className="overflow-auto max-h-[400px]">
            <table className="w-full">
                <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-3">
                            Date
                        </th>
                        <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-3">
                            De
                        </th>
                        <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-3">
                            Vers
                        </th>
                        <th className="text-center text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-3">
                            Statut
                        </th>
                        <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-3">
                            Durée
                        </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {data.map((call) => (
                        <tr
                            key={call.id}
                            className="hover:bg-slate-50 transition-colors"
                        >
                            <td className="py-2.5 px-3 text-sm text-slate-600">
                                {formatDateTime(call.startedAt)}
                            </td>
                            <td className="py-2.5 px-3">
                                <span className="font-mono text-sm font-medium text-slate-900">
                                    {call.sourceExtension}
                                </span>
                            </td>
                            <td className="py-2.5 px-3">
                                <span className="font-mono text-sm font-medium text-slate-900">
                                    {call.destinationExtension}
                                </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                                <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${call.status === "answered"
                                            ? "bg-emerald-100 text-emerald-800"
                                            : "bg-rose-100 text-rose-800"
                                        }`}
                                >
                                    {call.status === "answered" ? "Répondu" : "Manqué"}
                                </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                                <span className="font-mono text-sm text-slate-600">
                                    {call.durationFormatted}
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
