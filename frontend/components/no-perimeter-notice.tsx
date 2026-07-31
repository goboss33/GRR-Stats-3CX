"use client";

import { ShieldQuestion } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Écran affiché à un utilisateur dont le périmètre est vide.
 *
 * Sans lui, un manager fraîchement créé — le cas se produit entre sa connexion
 * et l'attribution de son périmètre par un administrateur — voit des écrans
 * vides sans savoir s'il s'agit d'une panne, d'une absence de données ou d'un
 * droit manquant. Le message nomme la cause et indique quoi faire.
 */
export function NoPerimeterNotice({
    title = "Aucun périmètre ne vous est attribué",
    context,
}: {
    title?: string;
    /** Précision facultative sur l'écran concerné. */
    context?: string;
}) {
    return (
        <Card className="border-slate-200">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="rounded-full bg-amber-50 p-3">
                    <ShieldQuestion className="h-6 w-6 text-amber-600" />
                </div>
                <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
                <p className="max-w-md text-sm text-slate-500">
                    {context ?? "Vos accès sont limités aux groupes qui vous sont attribués, et aucun ne l'est pour le moment."}
                </p>
                <p className="max-w-md text-sm text-slate-500">
                    Demandez à un administrateur de vous attribuer un ou plusieurs groupes
                    depuis <span className="font-medium text-slate-700">Réglages → Utilisateurs</span>.
                </p>
            </CardContent>
        </Card>
    );
}
