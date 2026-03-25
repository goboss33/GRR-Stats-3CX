"use client";

import { HeatmapDataPoint } from "@/types/stats.types";

interface HeatmapChartProps {
    data: HeatmapDataPoint[];
}

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function HeatmapChart({ data }: HeatmapChartProps) {
    if (!data || data.length === 0) {
        return (
            <div className="h-[350px] flex items-center justify-center bg-slate-50/50 rounded-xl border-2 border-dashed border-slate-200">
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
        <div className="w-full h-[400px] flex flex-col pb-2">
            {/* Header row for days */}
            <div className="flex gap-[2px] mb-1">
                <div className="w-8 shrink-0"></div>
                {DAYS.map((dayName) => (
                    <div key={dayName} className="flex-1 text-center text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">
                        {dayName}
                    </div>
                ))}
            </div>
            
            {/* Data rows for hours */}
            <div className="flex-1 flex flex-col gap-[2px]">
                {HOURS.map(h => (
                    <div key={h} className="flex flex-1 gap-[2px] items-center group">
                        <div className="w-8 shrink-0 text-[10px] text-slate-500 font-medium text-right pr-2 group-hover:text-slate-900 transition-colors">
                            {h}h
                        </div>
                        {DAYS.map((dayName, dIdx) => {
                            const val = getValue(dIdx, h);
                            return (
                                <div
                                    key={`${dIdx}-${h}`}
                                    className={`group/cell flex-1 h-full rounded-[2px] border border-transparent transition-all duration-300 flex items-center justify-center cursor-pointer hover:shadow-md relative ${getIntensityClass(val)}`}
                                >
                                    {/* Tooltip CSS élégant */}
                                    <div className="absolute right-full mr-2 top-1/2 -translate-y-1/2 hidden group-hover/cell:flex flex-row items-center z-[100] pointer-events-none opacity-0 group-hover/cell:opacity-100 transition-opacity duration-200">
                                        <div className="bg-slate-800 text-white text-[11px] leading-tight whitespace-nowrap px-2.5 py-1.5 rounded shadow-xl border border-slate-700">
                                            <span className="font-bold text-emerald-400">{val} appels</span><br/>
                                            <span className="text-slate-300">{dayName} à {h}h00</span>
                                        </div>
                                        {/* Petite flèche du tooltip vers la droite */}
                                        <div className="w-0 h-0 border-y-[5px] border-y-transparent border-l-[5px] border-l-slate-800 -ml-[1px]"></div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}
