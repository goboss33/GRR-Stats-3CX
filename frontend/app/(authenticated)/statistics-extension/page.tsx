"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Hash } from "lucide-react";

export default function StatisticsExtensionPage() {
    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center gap-3">
                <Hash className="h-8 w-8 text-blue-600" />
                <h1 className="text-2xl font-bold">Statistiques par Extension</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Fonctionnalité en cours de développement</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-slate-600">
                        Cette page permettra de rechercher les statistiques pour une ou plusieurs extensions/numéros sur une période donnée.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
