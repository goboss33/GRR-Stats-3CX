import { ExtensionStats } from "@/types/stats.types";

interface TopExtensionsTableProps {
    data: ExtensionStats[];
}

export function TopExtensionsTable({ data }: TopExtensionsTableProps) {
    if (!data || data.length === 0) {
        return (
            <div className="h-full flex items-center justify-center bg-slate-50 rounded-lg border-2 border-dashed border-slate-200 p-6">
                <p className="text-slate-500">Aucune donnée disponible</p>
            </div>
        );
    }

    return (
        <div className="overflow-hidden">
            <table className="w-full">
                <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-4">
                            Extension
                        </th>
                        <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-4">
                            Appels
                        </th>
                        <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-4">
                            Taux
                        </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {data.map((ext, index) => (
                        <tr
                            key={ext.extensionNumber}
                            className="hover:bg-slate-50 transition-colors"
                        >
                            <td className="py-3 px-4">
                                <div className="flex items-center gap-3">
                                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-xs font-medium text-slate-600">
                                        {index + 1}
                                    </span>
                                    <span className="font-mono font-medium text-slate-900">
                                        {ext.extensionNumber}
                                    </span>
                                </div>
                            </td>
                            <td className="py-3 px-4 text-right">
                                <span className="font-medium text-slate-900">
                                    {ext.totalCalls}
                                </span>
                                <span className="text-sm text-slate-500 ml-1">
                                    ({ext.answeredCalls} répondus)
                                </span>
                            </td>
                            <td className="py-3 px-4 text-right">
                                <span
                                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium ${ext.answerRate >= 80
                                            ? "bg-emerald-100 text-emerald-800"
                                            : ext.answerRate >= 50
                                                ? "bg-amber-100 text-amber-800"
                                                : "bg-rose-100 text-rose-800"
                                        }`}
                                >
                                    {ext.answerRate}%
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
