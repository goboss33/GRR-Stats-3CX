"use client";

import { toast } from "sonner";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, Building2, Activity, Plug, ShieldCheck } from "lucide-react";
import { getSelectedServer } from "@/lib/selected-server";
import { getConcurrentCallsChartData } from "@/services/dashboard.service";
import { ConcurrentCallsChart } from "@/components/concurrent-calls-chart";
import type { ConcurrentCallsDataPoint, ConcurrentCallsSummary } from "@/types/stats.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TenantInfo {
    id: string;
    name: string;
    timezone: string;
    licenceThreshold: number;
    trunkThreshold: number;
    /** Surcouche XAPI : interrupteur par tenant, éteint par défaut. */
    xapiEnabled: boolean;
    /** Adresse du PBX et ID client — pas des secrets, ils s'affichent. */
    xapiBaseUrl: string;
    xapiClientId: string;
    /** Une clé est-elle enregistrée ? Sa valeur ne quitte jamais le serveur. */
    xapiKeyConfigured: boolean;
    xapiKeyUpdatedAt: string | null;
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
    // Saisie de la clé XAPI par tenant — état LOCAL uniquement, jamais
    // rechargé depuis le serveur (la clé enregistrée n'en redescend jamais).
    const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
    const [savingKey, setSavingKey] = useState<string | null>(null);
    // Test de connexion au PBX : en cours, et dernier verdict par tenant.
    const [testing, setTesting] = useState<string | null>(null);
    const [testResults, setTestResults] = useState<Record<string, { ok: boolean; reason?: string; role?: string | null }>>({});
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

    // Surcouche XAPI — l'interrupteur. Éteindre ne supprime PAS la clé : le
    // tenant retombe simplement sur le socle CDR, qui reste complet en toute
    // circonstance, et rallumer ne demande pas de ressaisie.
    const handleXapiEnabledChange = async (serverId: string, xapiEnabled: boolean) => {
        setSaving(true);
        try {
            const res = await fetch("/api/admin/tenants", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serverId, xapiEnabled }),
            });
            const data = await res.json();
            if (!res.ok) {
                setMessage({ type: "error", text: data.error || "Erreur lors de la sauvegarde" });
            } else {
                setAvailableServers(prev => prev.map(s => s.id === serverId ? { ...s, xapiEnabled } : s));
                setMessage({ type: "success", text: xapiEnabled ? "XAPI activée pour ce tenant" : "XAPI désactivée — retour au socle CDR seul" });
            }
        } catch {
            setMessage({ type: "error", text: "Erreur lors de la sauvegarde" });
        } finally {
            setSaving(false);
        }
    };

    // La clé se saisit et s'envoie explicitement (jamais à la frappe) : c'est
    // un credential, pas un réglage. Le champ est vidé après envoi et la
    // valeur ne revient jamais du serveur.
    const handleXapiKeySave = async (serverId: string, xapiKey: string) => {
        setSavingKey(serverId);
        try {
            const res = await fetch("/api/admin/tenants", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serverId, xapiKey }),
            });
            const data = await res.json();
            if (!res.ok) {
                setMessage({ type: "error", text: data.error || "Erreur lors de la sauvegarde" });
            } else {
                setAvailableServers(prev => prev.map(s => s.id === serverId
                    ? { ...s, xapiKeyConfigured: data.xapiKeyConfigured, xapiKeyUpdatedAt: data.xapiKeyUpdatedAt }
                    : s));
                setKeyDrafts(prev => ({ ...prev, [serverId]: "" }));
                setMessage({ type: "success", text: data.xapiKeyConfigured ? "Clé XAPI enregistrée" : "Clé XAPI supprimée" });
            }
        } catch {
            setMessage({ type: "error", text: "Erreur lors de la sauvegarde" });
        } finally {
            setSavingKey(null);
        }
    };

    // Adresse du PBX et ID client : enregistrés à la sortie du champ, comme
    // les autres réglages textuels. Le serveur normalise l'adresse et peut la
    // renvoyer corrigée (« /5001 » → origine seule), d'où la relecture.
    const handleXapiFieldSave = async (serverId: string, field: "xapiBaseUrl" | "xapiClientId", value: string) => {
        setSaving(true);
        try {
            const res = await fetch("/api/admin/tenants", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serverId, [field]: value }),
            });
            const data = await res.json();
            if (!res.ok) {
                setMessage({ type: "error", text: data.error || "Erreur lors de la sauvegarde" });
            } else {
                setAvailableServers(prev => prev.map(s => s.id === serverId ? { ...s, [field]: data[field] ?? value } : s));
                setTestResults(prev => ({ ...prev, [serverId]: undefined as never }));
                setMessage({ type: "success", text: field === "xapiBaseUrl" ? "Adresse du PBX enregistrée" : "ID client enregistré" });
            }
        } catch {
            setMessage({ type: "error", text: "Erreur lors de la sauvegarde" });
        } finally {
            setSaving(false);
        }
    };

    // Test de connexion : le serveur utilise les identifiants ENREGISTRÉS, la
    // clé ne repasse jamais par le navigateur.
    const handleXapiTest = async (serverId: string) => {
        setTesting(serverId);
        setTestResults(prev => ({ ...prev, [serverId]: undefined as never }));
        try {
            const res = await fetch("/api/admin/tenants/xapi-test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serverId }),
            });
            const data = await res.json();
            if (!res.ok) {
                setTestResults(prev => ({ ...prev, [serverId]: { ok: false, reason: data.error || "Échec du test" } }));
            } else {
                setTestResults(prev => ({ ...prev, [serverId]: { ok: data.ok, reason: data.reason, role: data.role } }));
            }
        } catch {
            setTestResults(prev => ({ ...prev, [serverId]: { ok: false, reason: "Test impossible (application injoignable)" } }));
        } finally {
            setTesting(null);
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

                                    {/* Surcouche XAPI — interrogation directe du
                                        3CX, en PLUS du socle CDR. Éteinte, la
                                        plateforme fonctionne exactement comme
                                        aujourd'hui : rien de l'existant ne
                                        dépend de cet interrupteur. */}
                                    <div className="ml-12 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <Label htmlFor={`xapi-${server.id}`} className="flex items-center gap-2 text-sm text-slate-600">
                                                <Plug className="h-4 w-4 text-slate-500" />
                                                Surcouche XAPI (3CX)
                                            </Label>
                                            <Switch
                                                id={`xapi-${server.id}`}
                                                checked={server.xapiEnabled}
                                                onCheckedChange={(v) => handleXapiEnabledChange(server.id, v)}
                                                disabled={saving}
                                                className="data-[state=checked]:bg-blue-600"
                                            />
                                        </div>

                                        {server.xapiEnabled && (
                                            <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                                                <Label htmlFor={`xapiurl-${server.id}`} className="text-xs text-slate-600">
                                                    Adresse du PBX
                                                </Label>
                                                <Input
                                                    id={`xapiurl-${server.id}`}
                                                    type="url"
                                                    inputMode="url"
                                                    placeholder="https://exemple.3cx.ch:5001"
                                                    value={server.xapiBaseUrl}
                                                    onChange={(e) => setAvailableServers(prev => prev.map(s => s.id === server.id ? { ...s, xapiBaseUrl: e.target.value } : s))}
                                                    onBlur={(e) => handleXapiFieldSave(server.id, "xapiBaseUrl", e.target.value)}
                                                    disabled={saving}
                                                    className="font-mono text-xs"
                                                />

                                                <Label htmlFor={`xapiclient-${server.id}`} className="text-xs text-slate-600">
                                                    ID client
                                                </Label>
                                                <Input
                                                    id={`xapiclient-${server.id}`}
                                                    placeholder="stats"
                                                    autoComplete="off"
                                                    value={server.xapiClientId}
                                                    onChange={(e) => setAvailableServers(prev => prev.map(s => s.id === server.id ? { ...s, xapiClientId: e.target.value } : s))}
                                                    onBlur={(e) => handleXapiFieldSave(server.id, "xapiClientId", e.target.value)}
                                                    disabled={saving}
                                                    className="font-mono text-xs"
                                                />

                                                <Label htmlFor={`xapikey-${server.id}`} className="text-xs text-slate-600">
                                                    Clé API
                                                </Label>
                                                <div className="flex items-center gap-2">
                                                    <Input
                                                        id={`xapikey-${server.id}`}
                                                        type="password"
                                                        autoComplete="off"
                                                        placeholder={server.xapiKeyConfigured ? "•••••••• (remplacer)" : "Coller la clé XAPI"}
                                                        value={keyDrafts[server.id] ?? ""}
                                                        onChange={(e) => setKeyDrafts(prev => ({ ...prev, [server.id]: e.target.value }))}
                                                        disabled={savingKey === server.id}
                                                        className="flex-1 font-mono text-xs"
                                                    />
                                                    <Button
                                                        size="sm"
                                                        onClick={() => handleXapiKeySave(server.id, keyDrafts[server.id] ?? "")}
                                                        disabled={savingKey === server.id || !(keyDrafts[server.id] ?? "").trim()}
                                                    >
                                                        {savingKey === server.id
                                                            ? <Loader2 className="h-4 w-4 animate-spin" />
                                                            : "Enregistrer"}
                                                    </Button>
                                                </div>
                                                <div className="flex items-center justify-between gap-3">
                                                    {server.xapiKeyConfigured ? (
                                                        <span className="flex items-center gap-1.5 text-xs text-emerald-700">
                                                            <ShieldCheck className="h-3.5 w-3.5" />
                                                            Clé enregistrée{server.xapiKeyUpdatedAt
                                                                ? ` le ${new Date(server.xapiKeyUpdatedAt).toLocaleDateString("fr-CH")}`
                                                                : ""} — chiffrée, jamais réaffichée
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-amber-700">
                                                            Aucune clé enregistrée : la surcouche reste inactive.
                                                        </span>
                                                    )}
                                                    {server.xapiKeyConfigured && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleXapiKeySave(server.id, "")}
                                                            disabled={savingKey === server.id}
                                                            className="shrink-0 text-xs text-slate-500 underline underline-offset-2 hover:text-red-600"
                                                        >
                                                            Supprimer
                                                        </button>
                                                    )}
                                                </div>

                                                {/* Le test se fait avec les identifiants ENREGISTRÉS : il
                                                    valide la configuration réelle, pas ce qui est à l'écran. */}
                                                <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => handleXapiTest(server.id)}
                                                        disabled={testing === server.id || !server.xapiKeyConfigured || !server.xapiBaseUrl || !server.xapiClientId}
                                                    >
                                                        {testing === server.id
                                                            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Test en cours…</>
                                                            : "Tester la connexion"}
                                                    </Button>
                                                    {testResults[server.id] && (
                                                        testResults[server.id].ok ? (
                                                            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                                                                <CheckCircle2 className="h-4 w-4" />
                                                                Connexion établie — le PBX a délivré un jeton
                                                                {testResults[server.id].role ? ` (rôle : ${testResults[server.id].role})` : ""}
                                                            </span>
                                                        ) : (
                                                            <span className="text-xs text-red-700">
                                                                {testResults[server.id].reason || "Échec de la connexion"}
                                                            </span>
                                                        )
                                                    )}
                                                </div>
                                            </div>
                                        )}
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
                            <li>La surcouche XAPI interroge directement le 3CX en PLUS des données CDR. Éteinte, la plateforme fonctionne normalement : le socle CDR reste la source de vérité, la clé est conservée et l&apos;interrupteur peut être rebasculé à tout moment</li>
                            <li>La clé XAPI est chiffrée avant stockage et n&apos;est jamais réaffichée : pour la changer, il faut en coller une nouvelle</li>
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
