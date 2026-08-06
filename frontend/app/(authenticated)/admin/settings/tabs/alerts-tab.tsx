"use client";

/**
 * Onglet Alertes des réglages : paramètres du détecteur d'anomalies de la
 * cloche (cf. services/notifications.service). Volontairement séparé des
 * règles métier : ces réglages ne changent AUCUN chiffre — seulement la
 * sensibilité de la détection.
 */

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AlertsTab() {
    const [windowDays, setWindowDays] = useState<number | "">("");
    const [initial, setInitial] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetch("/api/admin/settings")
            .then((r) => r.json())
            .then((settings) => {
                const value = typeof settings.notificationWindowDays === "number" ? settings.notificationWindowDays : 7;
                setWindowDays(value);
                setInitial(value);
            })
            .catch(() => toast.error("Impossible de charger les réglages"));
    }, []);

    const save = async () => {
        if (windowDays === "" || windowDays < 1 || windowDays > 90) {
            toast.error("La fenêtre doit être comprise entre 1 et 90 jours.");
            return;
        }
        setSaving(true);
        try {
            const res = await fetch("/api/admin/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ notificationWindowDays: windowDays }),
            });
            if (!res.ok) throw new Error(await res.text());
            setInitial(windowDays);
            toast.success("Réglage enregistré. Les alertes se recalculent d'ici quelques minutes.");
        } catch {
            toast.error("Échec de l'enregistrement");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <Bell className="h-5 w-5 text-slate-500" />
                        Détection d'anomalies
                    </CardTitle>
                    <CardDescription>
                        La cloche du header signale les équipes et agents probablement déconnectés de leur
                        file (bouton « Q » de la 3CX). Ces réglages ne modifient aucun chiffre des
                        statistiques — uniquement la sensibilité de la détection.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="max-w-md space-y-2">
                        <Label htmlFor="notif-window">Fenêtre d'observation (jours)</Label>
                        <Input
                            id="notif-window"
                            type="number"
                            min={1}
                            max={90}
                            value={windowDays}
                            onChange={(e) => setWindowDays(e.target.value === "" ? "" : Number(e.target.value))}
                            className="w-32"
                        />
                        <p className="text-xs text-slate-500">
                            Une anomalie est détectée sur cette période glissante : plus la fenêtre est courte,
                            plus l'alerte est réactive — mais plus elle est sensible aux absences normales
                            (congés, temps partiels). 7 jours par défaut.
                        </p>
                    </div>
                    <Button onClick={save} disabled={saving || initial === null || windowDays === initial}>
                        {saving ? "Enregistrement…" : "Enregistrer"}
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
