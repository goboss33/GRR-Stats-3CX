"use client";

import { toast } from "sonner";

import { useState, useEffect } from "react";
import { Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

export function BusinessRulesTab() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [minSignificantDurationSec, setMinSignificantDurationSec] = useState(1);
    const [perimeterEnforcementEnabled, setPerimeterEnforcementEnabled] = useState(false);
    const [togglingPerimeter, setTogglingPerimeter] = useState(false);
    // Adaptateur : route les appels setMessage(...) existants vers les toasts.
    const setMessage = (m: { type: "success" | "error"; text: string } | null) => {
        if (!m) return;
        if (m.type === "success") toast.success(m.text);
        else toast.error(m.text);
    };

    useEffect(() => {
        fetch("/api/admin/settings")
            .then((res) => res.json())
            .then((data) => {
                if (data.minSignificantDurationSec !== undefined) {
                    setMinSignificantDurationSec(data.minSignificantDurationSec);
                }
                if (data.perimeterEnforcementEnabled !== undefined) {
                    setPerimeterEnforcementEnabled(data.perimeterEnforcementEnabled);
                }
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch("/api/admin/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ minSignificantDurationSec }),
            });
            const data = await res.json();
            if (!res.ok) {
                setMessage({ type: "error", text: data.error || "Erreur lors de la sauvegarde" });
            } else {
                setMessage({ type: "success", text: "Règles métier mises à jour avec succès" });
            }
        } catch {
            setMessage({ type: "error", text: "Erreur lors de la sauvegarde" });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                <span className="ml-2 text-slate-500">Chargement des règles métier...</span>
            </div>
        );
    }

    const togglePerimeter = async (enabled: boolean) => {
        setTogglingPerimeter(true);
        const previous = perimeterEnforcementEnabled;
        setPerimeterEnforcementEnabled(enabled);
        try {
            const res = await fetch("/api/admin/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ perimeterEnforcementEnabled: enabled }),
            });
            if (!res.ok) throw new Error((await res.json()).error || "Erreur lors de la sauvegarde");
            setMessage({
                type: "success",
                text: enabled ? "Filtrage par périmètre activé" : "Filtrage par périmètre désactivé",
            });
        } catch (e) {
            setPerimeterEnforcementEnabled(previous);
            setMessage({ type: "error", text: e instanceof Error ? e.message : "Erreur lors de la sauvegarde" });
        } finally {
            setTogglingPerimeter(false);
        }
    };

    return (
        <div className="space-y-6 max-w-2xl">
            <Card className={perimeterEnforcementEnabled ? "border-emerald-200" : "border-amber-200"}>
                <CardHeader>
                    <CardTitle>Filtrage par périmètre</CardTitle>
                    <CardDescription>
                        Interrupteur global : lorsqu&apos;il est actif, chaque utilisateur ne voit que les données de son
                        périmètre. Les ADMIN et MODERATOR conservent un accès global.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                            <p className="text-sm font-medium">
                                {perimeterEnforcementEnabled ? "Filtrage actif" : "Filtrage inactif (mode observation)"}
                            </p>
                            <p className="text-xs text-slate-500">
                                {perimeterEnforcementEnabled
                                    ? "Les managers ne voient que leurs files et leurs agents."
                                    : "Tout le monde voit l'ensemble des données, comme avant."}
                            </p>
                        </div>
                        <Switch
                            checked={perimeterEnforcementEnabled}
                            onCheckedChange={togglePerimeter}
                            disabled={togglingPerimeter}
                        />
                    </div>
                    {!perimeterEnforcementEnabled && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                            <p className="font-medium">Avant d&apos;activer :</p>
                            <ol className="mt-1 list-inside list-decimal space-y-1 text-xs">
                                <li>Classer les files dans « Files d&apos;attente » (les files « à classer » restent invisibles).</li>
                                <li>Attribuer à chaque manager ses tenants et son périmètre depuis « Utilisateurs ».</li>
                                <li>Vérifier l&apos;aperçu « Ce que voit cet utilisateur » dans chaque fiche.</li>
                            </ol>
                            <p className="mt-2 text-xs">
                                Activer sans avoir fait cela rendrait les écrans vides pour les managers.
                            </p>
                        </div>
                    )}
                </CardContent>
            </Card>


            <Card>
                <CardHeader>
                    <CardTitle>Seuils de calcul</CardTitle>
                    <CardDescription>
                        Configuration des paramètres utilisés pour déterminer ce qu'est un appel valide dans les statistiques
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <Label htmlFor="minDuration" className="text-base font-medium">
                                    Durée minimale d'un appel significatif
                                </Label>
                                <p className="text-sm text-slate-500 mt-1">
                                    Les appels directs non répondus de durée inférieure à ce seuil sont considérés comme du &quot;bruit système&quot; et exclus des statistiques.
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Input
                                    id="minDuration"
                                    type="number"
                                    min={0}
                                    max={60}
                                    value={minSignificantDurationSec}
                                    onChange={(e) => setMinSignificantDurationSec(Math.max(0, Math.min(60, parseInt(e.target.value) || 0)))}
                                    className="w-20 text-center"
                                />
                                <span className="text-sm text-slate-500">seconde(s)</span>
                            </div>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-slate-600">
                            <p className="font-medium text-slate-700 mb-1">Exemple concret :</p>
                            <p>
                                Un appel de 9ms non répondu vers l'extension 164 (Aude) n'est <strong>pas</strong> compté comme un appel direct reçu, car Aude avait un renvoi d'appel actif. L'appel a été immédiatement redirigé vers la file 993 où Nicole l'a pris.
                            </p>
                        </div>
                    </div>

                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sauvegarde...</> : <><Save className="mr-2 h-4 w-4" /> Enregistrer</>}
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Types de destinations système</CardTitle>
                    <CardDescription>
                        Ces types de destinations sont considérés comme &quot;automatiques&quot; et non comme des réponses humaines
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-2">
                        {['queue', 'ring_group', 'ring_group_ring_all', 'ivr', 'process', 'parking', 'script'].map((type) => (
                            <Badge key={type} variant="outline" className="bg-slate-50 font-mono text-xs">
                                {type}
                            </Badge>
                        ))}
                    </div>
                    <p className="text-xs text-slate-500 mt-3">
                        Pour modifier cette liste, contactez l'administrateur technique. Ces valeurs sont définies dans le code source.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
