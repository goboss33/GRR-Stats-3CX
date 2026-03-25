"use client";

import { HeatmapDataPoint } from "@/types/stats.types";

interface HeatmapChartProps {
    data: HeatmapDataPoint[];
}

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function HeatmapChart({ data }: HeatmapChartProps) {
    if (!data || data.length === 0) {
        return (
            <div className="h-[300px] flex items-center justify-center bg-slate-50/50 rounded-xl border-2 border-dashed border-slate-200">
                <p className="text-slate-500 font-medium">Aucune donnée pour cette période</p>
            </div>
        );
    }

    const maxValue = Math.max(...data.map(d => d.value), 1);

    const getValue = (dayZeroIdx: number, hour: number) => {
        const dayIso = dayZeroIdx + 1; // 1 = Monday
        const pt = data.find(d => d.dayOfWeek === dayIso && d.hourOfDay === hour);
        return pt ? pt.value : 0;
    };

    const getIntensityClass = (value: number) => {
        if (value === 0) return "bg-slate-50 hover:bg-slate-100";
        const ratio = value / maxValue;
        if (ratio < 0.2) return "bg-blue-100 hover:bg-blue-200 border-blue-200";
        if (ratio < 0.4) return "bg-blue-300 hover:bg-blue-400 border-blue-400";
        if (ratio < 0.6) return "bg-blue-500 hover:bg-blue-600 border-blue-600 text-white";
        if (ratio < 0.8) return "bg-blue-700 hover:bg-blue-800 border-blue-800 text-white";
        return "bg-blue-900 hover:bg-blue-950 border-blue-950 text-white";
    };

    return (
        <div className="w-full overflow-x-auto pb-4 custom-scrollbar">
            <div className="min-w-[800px] flex flex-col gap-1.5 p-2">
                {/* Header row for hours */}
                <div className="flex">
                    <div className="w-24 shrink-0"></div>
                    {HOURS.map(h => (
                        <div key={h} className="flex-1 text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            {h}h
                        </div>
                    ))}
                </div>
                {/* Data rows */}
                {DAYS.map((dayName, dIdx) => (
                    <div key={dayName} className="flex gap-1.5 items-center group">
                        <div className="w-24 shrink-0 text-xs text-slate-500 font-semibold text-right pr-4 group-hover:text-slate-900 transition-colors">
                            {dayName}
                        </div>
                        {HOURS.map(h => {
                            const val = getValue(dIdx, h);
                            return (
                                <div
                                    key={`${dIdx}-${h}`}
                                    className={`flex-1 aspect-square rounded-md border border-transparent transition-all duration-300 flex items-center justify-center text-[10px] sm:text-xs cursor-pointer hover:scale-110 hover:shadow-md ${getIntensityClass(val)}`}
                                    title={`${val} appels le ${dayName} à ${h}h`}
                                >
                                    {val > 0 ? val : ""}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}
