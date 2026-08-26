"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search, Eye, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface TargetUser {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
}

interface RegistryQueue {
    id: string;
    queueNumber: string;
    currentName: string;
    entity: string | null;
    region: string | null;
    status: string;
    isNew: boolean;
    tenantId?: string;
}

interface Tenant {
    id: string;
    name: string;
}

interface ExtensionOverride {
    tenantId: string;
    extensionNumber: string;
    mode: "INCLUDE" | "EXCLUDE";
}

interface ScopePreview {
    unrestricted: boolean;
    queues: { id: string }[];
    extensions: string[];
    autoExtensionCount: number;
    includedByOverride: string[];
    excludedByOverride: string[];
}

export function UserAccessDialog({
    user,
    open,
    onOpenChange,
}: {
    user: TargetUser | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [queuesByTenant, setQueuesByTenant] = useState<Record<string, RegistryQueue[]>>({});

    const [selectedTenants, setSelectedTenants] = useState<Set<string>>(new Set());
    const [selectedQueues, setSelectedQueues] = useState<Set<string>>(new Set());
    const [overrides, setOverrides] = useState<ExtensionOverride[]>([]);
    const [permissions, setPermissions] = useState({
        canViewLogs: true,
        canViewExtensionStats: true,
        canViewFullPhoneNumbers: false,
        canCreateApiKeys: false,
        canViewNotifications: false,
        agentRatiosLevel: "none" as "none" | "totals" | "all",
    });
    const [scope, setScope] = useState<ScopePreview | null>(null);

    const [queueSearch, setQueueSearch] = useState("");
    const [regionFilter, setRegionFilter] = useState<string>("ALL");
    const [newOverrideExt, setNewOverrideExt] = useState("");

    // Rôle « global » : voit aussi les postes qui n'appartiennent à aucune
    // file. Le PÉRIMÈTRE, lui, s'applique à tout le monde depuis août 2026 —
    // un administrateur ne voit que les files qui lui sont cochées.
    const isGlobalRole = user?.role === "ADMIN" || user?.role === "MODERATOR";

    const load = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const [accessRes, tenantsRes] = await Promise.all([
                fetch(`/api/admin/users/${user.id}/access?describe=1`),
                fetch("/api/admin/tenants"),
            ]);
            const accessData = await accessRes.json();
            const tenantsData = await tenantsRes.json();
            if (!accessRes.ok) throw new Error(accessData.error || "Chargement impossible");

            const available: Tenant[] = (tenantsData.availableServers || []).map((s: { id: string; name: string }) => ({
                id: s.id,
                name: s.name,
            }));
            setTenants(available);
            setSelectedTenants(new Set(accessData.access.tenants));
            setSelectedQueues(new Set(accessData.access.queueIds));
            setOverrides(accessData.access.extensionOverrides || []);
            setPermissions({
                canViewLogs: accessData.access.canViewLogs,
                canViewExtensionStats: accessData.access.canViewExtensionStats,
                canViewFullPhoneNumbers: accessData.access.canViewFullPhoneNumbers,
                canCreateApiKeys: accessData.access.canCreateApiKeys,
                canViewNotifications: accessData.access.canViewNotifications,
                agentRatiosLevel: accessData.access.agentRatiosLevel ?? "none",
            });
            setScope(accessData.scope ?? null);

            // Registre de chaque tenant (pour composer le périmètre).
            const perTenant: Record<string, RegistryQueue[]> = {};
            await Promise.all(
                available.map(async (t) => {
                    const res = await fetch(`/api/admin/queues?server=${t.id}`);
                    const data = await res.json();
                    perTenant[t.id] = (data.queues || [])
                        .filter((q: RegistryQueue) => q.status !== "ARCHIVED")
                        .map((q: RegistryQueue) => ({ ...q, tenantId: t.id }));
                }),
            );
            setQueuesByTenant(perTenant);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Chargement impossible");
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        if (open) load();
    }, [open, load]);

    /** Files des tenants autorisés uniquement : un périmètre hors tenant n'aurait pas de sens. */
    const visibleQueues = useMemo(() => {
        return [...selectedTenants].flatMap((t) => queuesByTenant[t] ?? []);
    }, [selectedTenants, queuesByTenant]);

    const regions = useMemo(() => {
        const set = new Set<string>();
        visibleQueues.forEach((q) => q.region && set.add(q.region));
        return [...set].sort();
    }, [visibleQueues]);

    const filteredQueues = useMemo(() => {
        const term = queueSearch.trim().toLowerCase();
        return visibleQueues.filter((q) => {
            if (regionFilter !== "ALL" && q.region !== regionFilter) return false;
            if (!term) return true;
            return q.queueNumber.includes(term) || q.currentName.toLowerCase().includes(term);
        });
    }, [visibleQueues, queueSearch, regionFilter]);

    const toggleQueue = (id: string) => {
        setSelectedQueues((s) => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const addOverride = (mode: "INCLUDE" | "EXCLUDE") => {
        const ext = newOverrideExt.trim();
        const tenantId = [...selectedTenants][0];
        if (!ext || !tenantId) return;
        if (overrides.some((o) => o.extensionNumber === ext && o.tenantId === tenantId)) {
            toast.error("Cette extension a déjà une surcharge");
            return;
        }
        setOverrides((o) => [...o, { tenantId, extensionNumber: ext, mode }]);
        setNewOverrideExt("");
    };

    const save = async () => {
        if (!user) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/admin/users/${user.id}/access`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tenants: [...selectedTenants],
                    queueIds: [...selectedQueues],
                    extensionOverrides: overrides,
                    ...permissions,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Enregistrement impossible");
            toast.success("Accès enregistrés");
            await load(); // rafraîchit l'aperçu « qui voit quoi »
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Enregistrement impossible");
        } finally {
            setSaving(false);
        }
    };

    const displayName = user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email : "";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Accès de {displayName}</DialogTitle>
                    <DialogDescription>
                        Rôle : <strong>{user?.role}</strong>
                        {" — ne verra que les files cochées ci-dessous"}
                        {isGlobalRole
                            ? ", plus tous les postes du tenant (y compris hors file)."
                            : ", et les collaborateurs qui en dépendent."}
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                    </div>
                ) : (
                    <div className="space-y-6 py-2">
                        {/* Tenants */}
                        <section className="space-y-2">
                            <Label className="text-base font-medium">Tenants autorisés</Label>
                            <p className="text-xs text-slate-500">Sans tenant autorisé, l&apos;utilisateur ne voit aucune donnée.</p>
                            <div className="flex flex-wrap gap-3 pt-1">
                                {tenants.map((t) => (
                                    <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2">
                                        <Checkbox
                                            checked={selectedTenants.has(t.id)}
                                            onCheckedChange={(c) =>
                                                setSelectedTenants((s) => {
                                                    const next = new Set(s);
                                                    if (c) next.add(t.id);
                                                    else next.delete(t.id);
                                                    return next;
                                                })
                                            }
                                        />
                                        <span className="text-sm">{t.name}</span>
                                    </label>
                                ))}
                            </div>
                        </section>

                        {/* Périmètre de files — pour TOUS les rôles */}
                        {(
                            <section className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <Label className="text-base font-medium">Périmètre de files</Label>
                                    <Badge variant="outline">{selectedQueues.size} sélectionnée(s)</Badge>
                                </div>

                                {selectedTenants.size === 0 ? (
                                    <p className="rounded-lg border border-dashed p-4 text-sm text-slate-500">
                                        Sélectionnez d&apos;abord un tenant.
                                    </p>
                                ) : (
                                    <>
                                        <div className="flex flex-col gap-2 sm:flex-row">
                                            <div className="relative flex-1">
                                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                                <Input
                                                    value={queueSearch}
                                                    onChange={(e) => setQueueSearch(e.target.value)}
                                                    placeholder="Rechercher une file…"
                                                    className="h-9 pl-9"
                                                />
                                            </div>
                                            <Select value={regionFilter} onValueChange={setRegionFilter}>
                                                <SelectTrigger className="h-9 w-full sm:w-44">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="ALL">Toutes les régions</SelectItem>
                                                    {regions.map((r) => (
                                                        <SelectItem key={r} value={r}>{r}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        {/* Sélection en masse par étiquette (L2-2) */}
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                    setSelectedQueues((s) => new Set([...s, ...filteredQueues.map((q) => q.id)]))
                                                }
                                            >
                                                Ajouter les {filteredQueues.length} file(s) affichée(s)
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                onClick={() =>
                                                    setSelectedQueues((s) => {
                                                        const next = new Set(s);
                                                        filteredQueues.forEach((q) => next.delete(q.id));
                                                        return next;
                                                    })
                                                }
                                            >
                                                Retirer les affichées
                                            </Button>
                                        </div>

                                        <div className="max-h-64 overflow-y-auto rounded-lg border">
                                            {filteredQueues.map((q) => (
                                                <label
                                                    key={q.id}
                                                    className={cn(
                                                        "flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-slate-50",
                                                        selectedQueues.has(q.id) && "bg-blue-50/50",
                                                    )}
                                                >
                                                    <Checkbox checked={selectedQueues.has(q.id)} onCheckedChange={() => toggleQueue(q.id)} />
                                                    <span className="font-mono text-xs text-slate-500">{q.queueNumber}</span>
                                                    <span className="flex-1 truncate text-sm">{q.currentName}</span>
                                                    {q.region && (
                                                        <Badge variant="outline" className="text-[10px]">{q.region}</Badge>
                                                    )}
                                                    {q.isNew && (
                                                        <Badge variant="outline" className="border-blue-200 bg-blue-50 text-[10px] text-blue-700">
                                                            nouvelle
                                                        </Badge>
                                                    )}
                                                </label>
                                            ))}
                                            {filteredQueues.length === 0 && (
                                                <p className="py-6 text-center text-sm text-slate-500">Aucune file</p>
                                            )}
                                        </div>
                                    </>
                                )}
                            </section>
                        )}

                        {/* Surcharges d'extensions */}
                        {!isGlobalRole && (
                            <section className="space-y-2">
                                <Label className="text-base font-medium">Surcharges d&apos;extensions</Label>
                                <p className="text-xs text-slate-500">
                                    Les agents des files du périmètre sont rattachés automatiquement. Utilisez les surcharges pour
                                    les extensions qui ne servent aucune file (direction, back-office…).
                                </p>
                                <div className="flex gap-2 pt-1">
                                    <Input
                                        value={newOverrideExt}
                                        onChange={(e) => setNewOverrideExt(e.target.value)}
                                        placeholder="N° d'extension"
                                        className="h-9 w-40"
                                    />
                                    <Button type="button" size="sm" variant="outline" onClick={() => addOverride("INCLUDE")}>
                                        <Plus className="mr-1 h-3 w-3" /> Ajouter
                                    </Button>
                                    <Button type="button" size="sm" variant="outline" onClick={() => addOverride("EXCLUDE")}>
                                        <X className="mr-1 h-3 w-3" /> Exclure
                                    </Button>
                                </div>
                                {overrides.length > 0 && (
                                    <div className="flex flex-wrap gap-2 pt-1">
                                        {overrides.map((o) => (
                                            <Badge
                                                key={`${o.tenantId}-${o.extensionNumber}`}
                                                variant="outline"
                                                className={cn(
                                                    "gap-1",
                                                    o.mode === "INCLUDE"
                                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                        : "border-red-200 bg-red-50 text-red-700",
                                                )}
                                            >
                                                {o.mode === "INCLUDE" ? "+" : "−"} {o.extensionNumber}
                                                <button
                                                    type="button"
                                                    onClick={() => setOverrides((os) => os.filter((x) => x !== o))}
                                                    className="ml-1 hover:opacity-70"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                            </section>
                        )}

                        {/* Permissions */}
                        <section className="space-y-3">
                            <Label className="text-base font-medium">Permissions</Label>
                            {[
                                {
                                    key: "canViewLogs" as const,
                                    label: "Voir les logs d'appels",
                                    hint: "Sinon l'écran des logs est fermé et les chiffres cliquables ne mènent plus au détail des appels",
                                },
                            ].map((p) => (
                                <div key={p.key} className="flex items-center justify-between rounded-lg border p-3">
                                    <div>
                                        <p className="text-sm font-medium">{p.label}</p>
                                        <p className="text-xs text-slate-500">{p.hint}</p>
                                    </div>
                                    <Switch
                                        checked={permissions[p.key]}
                                        onCheckedChange={(v) => setPermissions((prev) => ({ ...prev, [p.key]: v }))}
                                    />
                                </div>
                            ))}

                            {/* Ratios du tableau des agents — trois niveaux, pas un interrupteur. */}
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-medium">Ratios du tableau des collaborateurs</p>
                                    <p className="text-xs text-slate-500">
                                        Les dénominateurs (« 85/111 ») du tableau de performance des équipes.
                                        Par défaut : Partout pour ADMIN et MODERATOR, Aucun pour MANAGER
                                    </p>
                                </div>
                                <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-200" role="group">
                                    {([
                                        { value: "none", label: "Aucun" },
                                        { value: "totals", label: "Ligne TOTAL" },
                                        { value: "all", label: "Partout" },
                                    ] as const).map((l) => (
                                        <button
                                            key={l.value}
                                            type="button"
                                            aria-pressed={permissions.agentRatiosLevel === l.value}
                                            onClick={() => setPermissions((prev) => ({ ...prev, agentRatiosLevel: l.value }))}
                                            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                                permissions.agentRatiosLevel === l.value
                                                    ? "bg-blue-600 text-white"
                                                    : "bg-white text-slate-600 hover:bg-slate-50"
                                            }`}
                                        >
                                            {l.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {[
                                {
                                    key: "canViewExtensionStats" as const,
                                    label: "Voir les statistiques Extension / DDI",
                                    hint: "Sinon l'écran Extension / DDI disparaît de la navigation",
                                },
                                {
                                    key: "canViewFullPhoneNumbers" as const,
                                    label: "Voir les numéros complets",
                                    hint: "Sinon les numéros des appelants sont masqués (07• ••• ••34)",
                                },
                                {
                                    key: "canCreateApiKeys" as const,
                                    label: "Créer des clés API",
                                    hint: "La clé hérite automatiquement du périmètre de son propriétaire",
                                },
                                {
                                    key: "canViewNotifications" as const,
                                    label: "Voir la cloche d'alertes",
                                    hint: "Anomalies détectées dans son périmètre (collaborateurs déconnectés de leur file…). Par défaut : activé pour ADMIN et MODERATOR, désactivé pour MANAGER",
                                },
                            ].map((p) => (
                                <div key={p.key} className="flex items-center justify-between rounded-lg border p-3">
                                    <div>
                                        <p className="text-sm font-medium">{p.label}</p>
                                        <p className="text-xs text-slate-500">{p.hint}</p>
                                    </div>
                                    <Switch
                                        checked={permissions[p.key]}
                                        onCheckedChange={(v) => setPermissions((prev) => ({ ...prev, [p.key]: v }))}
                                    />
                                </div>
                            ))}
                        </section>

                        {/* Aperçu « qui voit quoi » (L2-3) */}
                        {scope && (
                            <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                                <div className="mb-2 flex items-center gap-2">
                                    <Eye className="h-4 w-4 text-slate-500" />
                                    <span className="text-sm font-medium text-slate-700">Ce que voit cet utilisateur (enregistré)</span>
                                </div>
                                {scope.unrestricted ? (
                                    <p className="text-sm text-slate-600">
                                        Accès global : <strong>{scope.queues.length}</strong> file(s) sur les tenants autorisés.
                                    </p>
                                ) : (
                                    <ul className="space-y-1 text-sm text-slate-600">
                                        <li><strong>{scope.queues.length}</strong> file(s) dans le périmètre</li>
                                        <li>
                                            <strong>{scope.extensions.length}</strong> extension(s) visible(s)
                                            <span className="text-xs text-slate-500">
                                                {" "}({scope.autoExtensionCount} déduite(s) des files
                                                {scope.includedByOverride.length > 0 && `, +${scope.includedByOverride.length} ajoutée(s)`}
                                                {scope.excludedByOverride.length > 0 && `, −${scope.excludedByOverride.length} exclue(s)`})
                                            </span>
                                        </li>
                                    </ul>
                                )}
                                <p className="mt-2 text-xs text-slate-500">
                                    Reflète le dernier enregistrement — cliquez sur Enregistrer pour actualiser.
                                </p>
                            </section>
                        )}
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Fermer</Button>
                    <Button onClick={save} disabled={saving || loading}>
                        {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enregistrement…</> : "Enregistrer"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
