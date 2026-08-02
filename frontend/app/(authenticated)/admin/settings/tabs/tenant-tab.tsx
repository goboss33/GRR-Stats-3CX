"use client";

import { toast } from "sonner";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, Building2, Activity } from "lucide-react";
import { getSelectedServer } from "@/lib/selected-server";
import { getConcurrentCallsChartData } from "@/services/dashboard.service";
import { ConcurrentCallsChart } from "@/components/concurrent-calls-chart";
import type { ConcurrentCallsDataPoint, ConcurrentCallsSummary } from "@/types/stats.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface TenantInfo {
    id: string;
    name: string;
    timezone: string;
    licenceThreshold: number;
    trunkThreshold: number;
}

const COMMON_TIMEZONES = [
    { value: "Europe/Zurich", label: "Europe/Zurich (Suisse)" },
    { value: "Europe/Paris", label: "Europe/Paris (France)" },
    { value: "Europe/London", label: "Europe/London (UK)" },
    { value: "Europe/Berlin", label: "Europe/Berlin (Allemagne)" },
    { value: "Europe/Brussels", label: "Europe/Brussels (Belgique)" },
    { value: "UTC", label: "UTC" },
    { value: "America/New_York", label: "America/New_York (US East)" },
    { value: "America/Los_Angeles", label: "America/Los_Angeles (US West)" },
    { value: "Asia/Tokyo", label: "Asia/Tokyo (Japon)" },
    { value: "Asia/Dubai", label: "Asia/Dubai (Golfe)" },
];

export function TenantTab() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [currentServer, setCurrentServer] = useState<string>("");
    const [availableServers, setAvailableServers] = useState<TenantInfo[]>([]);
    // Monitoring de licence (appels simultanés), avec sa propre période.
    const [licenceDays, setLicenceDays] = useState(7);
    const [licenceLoading, setLicenceLoading] = useState(true);
    const [licenceData, setLicenceData] = useState<ConcurrentCallsDataPoint[]>([]);
    const [licenceSummary, setLicenceSummary] = useState<ConcurrentCallsSummary | null>(null);
    // Adaptateur : route les appels setMessage(...) existants vers les toasts.
    const setMessage = (m: { type: "success" | "error"; text: string } | null) => {
        if (!m) return;
        if (m.type === "success") toast.success(m.text);
        else toast.error(m.text);
    };

    useEffect(() => {
        let cancelled = false;
        setLicenceLoading(true);
        const end = new Date();
        const start = new Date(end.getTime() - licenceDays * 24 * 60 * 60 * 1000);
        getConcurrentCallsChartData(getSelectedServer(), start, end)
            .then((r) => { if (!cancelled) { setLicenceData(r.data); setLicenceSummary(r.summary); } })
            .catch(() => { if (!cancelled) setLicenceSummary(null); })
            .finally(() => { if (!cancelled) setLicenceLoading(false); });
        return () => { cancelled = true; };
    }, [licenceDays]);

    useEffect(() => {
        fetch("/api/admin/tenants")
            .then((res) => res.json())
            .then((data) => {
                setCurrentServer(data.currentServer || "gerofinance");
                setAvailableServers(data.availableServers || []);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const handleServerChange = async (serverId: string) => {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch("/api/admin/tenants", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serverId }),
            });
            const data = await res.json();
            if (!res.ok) {
                setMessage({ type: "error", text: data.error || "Erreur lors de la sauvegarde" });
            } else {
                setCurrentServer(serverId);
                setMessage({ type: "success", text: "Tenant changé avec succès. La page va se recharger..." });
                setTimeout(() => router.refresh(), 1500);
            }
        } catch {
            setMessage({ type: "error", text: "Erreur lors de la sauvegarde" });
        } finally {
            setSaving(false);
        }
    };

    const handleTimezoneChange = async (serverId: string, timezone: string) => {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch("/api/admin/tenants", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serverId, timezone }),
            });
            const data = await res.json();
            if (!res.ok) {
                setMessage({ type: "error", text: data.error || "Erreur lors de la sauvegarde" });
            } else {
                setAvailableServers(prev => prev.map(s => s.id === serverId ? { ...s, timezone } : s));
                setMessage({ type: "success", text: "Fuseau horaire mis à jour avec succès" });
            }
        } catch {
            setMessage({ type: "error", text: "Erreur lors de la sauvegarde" });
        } finally {
            setSaving(false);
        }
    };

    const handleLicenceThresholdChange = async (serverId: string, licenceThreshold: number) => {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch("/api/admin/tenants", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serverId, licenceThreshold }),
            });
            const data = await res.json();
            if (!res.ok) {
                setMessage({ type: "error", text: data.error || "Erreur lors de la sauvegarde" });
            } else {
                setAvailableServers(prev => prev.map(s => s.id === serverId ? { ...s, licenceThreshold } : s));
                setMessage({ type: "success", text: "Seuil de licence mis à jour avec succès" });
            }
        } catch {
            setMessage({ type: "error", text: "Erreur lors de la sauvegarde" });
        } finally {
            setSaving(false);
        }
    };

    const handleTrunkThresholdChange = async (serverId: string, trunkThreshold: number) => {
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch("/api/admin/tenants", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serverId, trunkThreshold }),
            });
            const data = await res.json();
            if (!res.ok) {
                setMessage({ type: "error", text: data.error || "Erreur lors de la sauvegarde" });
            } else {
                setAvailableServers(prev => prev.map(s => s.id === serverId ? { ...s, trunkThreshold } : s));
                setMessage({ type: "success", text: "Seuil trunk mis à jour avec succès" });
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
                <span className="ml-2 text-slate-500">Chargement des tenants...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-2xl">

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Building2 className="h-5 w-5" />
                        Sélection du Tenant
                    </CardTitle>
                    <CardDescription>
                        Choisissez le serveur 3CX dont vous souhaitez afficher les statistiques
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {availableServers.length === 0 ? (
                        <div className="text-center py-8 text-slate-500">
                            <Building2 className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                            <p>Aucun serveur disponible</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {availableServers.map((server) => (
                                <div key={server.id} className="space-y-3">
                                    <button
                                        onClick={() => handleServerChange(server.id)}
                                        disabled={saving}
                                        className={cn(
                                            "w-full flex items-center gap-4 p-4 rounded-lg border-2 transition-all",
                                            currentServer === server.id
                                                ? "border-blue-600 bg-blue-50 shadow-sm"
                                                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                                        )}
                                    >
                                        <Building2 className={cn(
                                            "h-8 w-8 flex-shrink-0",
                                            currentServer === server.id ? "text-blue-600" : "text-slate-400"
                                        )} />
                                        <div className="flex-1 text-left">
                                            <p className={cn(
                                                "font-semibold",
                                                currentServer === server.id ? "text-blue-900" : "text-slate-900"
                                            )}>
                                                {server.name}
                                            </p>
                                            <p className="text-sm text-slate-500 font-mono">{server.id}</p>
                                        </div>
                                        {currentServer === server.id && (
                                            <CheckCircle2 className="h-6 w-6 text-blue-600 flex-shrink-0" />
                                        )}
                                        {saving && currentServer !== server.id && (
                                            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                                        )}
                                    </button>

                                    <div className="ml-12 flex items-center gap-3">
                                        <Label htmlFor={`tz-${server.id}`} className="text-sm text-slate-600 whitespace-nowrap">
                                            Fuseau horaire :
                                        </Label>
                                        <Select
                                            value={server.timezone}
                                            onValueChange={(tz) => handleTimezoneChange(server.id, tz)}
                                            disabled={saving}
                                        >
                                            <SelectTrigger id={`tz-${server.id}`} className="w-64">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {COMMON_TIMEZONES.map((tz) => (
                                                    <SelectItem key={tz.value} value={tz.value}>
                                                        {tz.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="ml-12 flex items-center gap-3">
                                        <Label htmlFor={`lt-${server.id}`} className="text-sm text-slate-600 whitespace-nowrap">
                                            Appels simultanés (licence) :
                                        </Label>
                                        <Input
                                            id={`lt-${server.id}`}
                                            type="number"
                                            min={1}
                                            max={10000}
                                            value={server.licenceThreshold}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (!isNaN(val) && val >= 1 && val <= 10000) {
                                                    handleLicenceThresholdChange(server.id, val);
                                                }
                                            }}
                                            disabled={saving}
                                            className="w-24 text-center"
                                        />
                                    </div>

                                    <div className="ml-12 flex items-center gap-3">
                                        <Label htmlFor={`tt-${server.id}`} className="text-sm text-slate-600 whitespace-nowrap">
                                            Appels simultanés (trunk) :
                                        </Label>
                                        <Input
                                            id={`tt-${server.id}`}
                                            type="number"
                                            min={0}
                                            max={10000}
                                            value={server.trunkThreshold}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (!isNaN(val) && val >= 0 && val <= 10000) {
                                                    handleTrunkThresholdChange(server.id, val);
                                                }
                                            }}
                                            disabled={saving}
                                            className="w-24 text-center"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-600">
                        <p className="font-medium text-slate-700 mb-2">Information :</p>
                        <ul className="list-disc list-inside space-y-1 text-slate-600">
                            <li>Le tenant sélectionné détermine quelles données sont affichées dans le dashboard, les logs et les statistiques</li>
                            <li>Le fuseau horaire est utilisé pour convertir les timestamps UTC des données 3CX en heure locale (heatmap, timeline, appels simultanés, créneaux horaires)</li>
                            <li>Le seuil d&apos;appels simultanés (licence) correspond au nombre maximum de licences 3CX. Il est affiché comme ligne de référence sur le graphique des appels simultanés</li>
                            <li>Le seuil d&apos;appels simultanés (trunk) correspond à la capacité maximale des trunks SIP. Il est affiché comme ligne de référence sur le graphique des appels simultanés</li>
                            <li>La sélection est sauvegardée dans votre navigateur</li>
                            <li>La page se rechargera automatiquement après le changement de tenant</li>
                        </ul>
                    </div>
                </CardContent>
            </Card>

            {/* Monitoring de licence — déménagé depuis le tableau de bord : ce
                graphe dimensionne les licences 3CX, il compte donc TOUTES les
                directions (entrants, sortants, internes) — une ligne occupée
                est occupée dans les deux sens. Le garder sur le dashboard
                laissait croire qu'il suivait les filtres des statistiques. */}
            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <Activity className="h-5 w-5 text-blue-600" />
                                Appels simultanés — Monitoring licence
                            </CardTitle>
                            <CardDescription>
                                Toutes directions confondues (entrants, sortants, internes) : c&apos;est
                                l&apos;occupation réelle des lignes qui dimensionne la licence.
                            </CardDescription>
                        </div>
                        <Select value={String(licenceDays)} onValueChange={(v) => setLicenceDays(Number(v))}>
                            <SelectTrigger className="w-40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="1">Dernières 24 h</SelectItem>
                                <SelectItem value="7">7 derniers jours</SelectItem>
                                <SelectItem value="30">30 derniers jours</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>
                <CardContent>
                    {licenceLoading ? (
                        <div className="flex h-64 items-center justify-center gap-2 text-sm text-slate-500">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Chargement du monitoring…
                        </div>
                    ) : licenceSummary ? (
                        <ConcurrentCallsChart data={licenceData} summary={licenceSummary} />
                    ) : (
                        <p className="py-8 text-center text-sm text-slate-500">Aucune donnée sur la période.</p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
