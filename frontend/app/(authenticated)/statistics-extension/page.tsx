"use client";

import { useState } from "react";
import { startOfMonth, endOfMonth } from "date-fns";
import { Hash, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/date-range-picker";
import { ExtensionSearchTable } from "@/components/stats-extension/extension-search-table";

export default function StatisticsExtensionPage() {
    const [extensions, setExtensions] = useState<string[]>([]);
    const [dateRange, setDateRange] = useState(() => {
        const now = new Date();
        return {
            startDate: startOfMonth(now),
            endDate: endOfMonth(now),
        };
    });

    const handleSearch = () => {
        console.log("Recherche:", { extensions, dateRange });
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center gap-3">
                <Hash className="h-8 w-8 text-blue-600" />
                <h1 className="text-2xl font-bold">Statistiques par Extension</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Recherche</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <ExtensionSearchTable
                        extensions={extensions}
                        onExtensionsChange={setExtensions}
                    />

                    <div className="flex flex-wrap items-end gap-4">
                        <div className="flex-1 min-w-[300px]">
                            <label className="text-sm font-medium text-slate-700 mb-2 block">Période</label>
                            <DateRangePicker
                                dateRange={dateRange}
                                onDateRangeChange={setDateRange}
                            />
                        </div>

                        <Button
                            onClick={handleSearch}
                            disabled={extensions.length === 0}
                            size="lg"
                            className="h-12 px-8"
                        >
                            <Search className="h-5 w-5 mr-2" />
                            Rechercher
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Résultats</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="border border-dashed rounded-lg p-12 text-center text-slate-400">
                        <Search className="h-10 w-10 mx-auto mb-3 opacity-50" />
                        <p className="text-sm">Ajoutez des extensions et lancez une recherche pour voir les statistiques</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
