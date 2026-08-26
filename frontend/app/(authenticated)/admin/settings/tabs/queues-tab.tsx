"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, AlertTriangle, Tag, Search, Users, CheckCircle2, Archive, Eye, Workflow } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getSelectedServer } from "@/lib/selected-server";
import { KNOWN_REGIONS } from "@/services/domain/queue-naming";
import { QueueDetailDialog } from "@/components/queue-detail-dialog";
import { QueueFlowModal } from "@/components/settings/queue-flow-modal";
import { assessQueueHealth, type HealthLevel } from "@/services/domain/queue-health";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

type QueueStatus = "ACTIVE" | "ARCHIVED";

interface RegistryQueue {
    department: string | null;
    id: string;
    queueNumber: string;
    currentName: string;
    entity: string | null;
    region: string | null;
    service: string | null;
    status: QueueStatus;
    agentCount: number;
    isNew: boolean;
    lastCallAt: string | null;
    agents: { extension: string; name: string; attempts: number; lastSeenAt: string }[];
    lastSeenAt: string;
    previousNames: string[];
}

const healthStyles: Record<HealthLevel, { dot: string; label: string }> = {
    ok: { dot: "bg-emerald-500", label: "OK" },
    warning: { dot: "bg-amber-500", label: "À surveiller" },
    critical: { dot: "bg-red-500", label: "Problème" },
};

const statusLabels: Record<QueueStatus, string> = {
    ACTIVE: "Active",
    ARCHIVED: "Archivée",
};

const statusStyles: Record<QueueStatus, string> = {
    ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
    ARCHIVED: "bg-slate-100 text-slate-500 border-slate-200",
};

export function QueuesTab() {
    const [queues, setQueues] = useState<RegistryQueue[]>([]);
    // Carte de parcours (configuration déduite) ouverte sur cette file.
    const [flowQueue, setFlowQueue] = useState<{ number: string; name: string } | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isDiscovering, setIsDiscovering] = useState(false);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<QueueStatus | "ALL">("ALL");
    const [healthFilter, setHealthFilter] = useState<HealthLevel | "ALL">("ALL");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [detailQueueId, setDetailQueueId] = useState<string | null>(null);
    const [bulkBusy, setBulkBusy] = useState(false);
    // null = valeur pas encore connue : l'interrupteur attend le serveur.
    const [hideArchived, setHideArchived] = useState<boolean | null>(null);

    useEffect(() => {
        fetch("/api/admin/settings")
            .then((res) => res.json())
            .then((data) => setHideArchived(Boolean(data.hideArchivedQueues)))
            .catch(() => undefined);
    }, []);

    // Bascule optimiste : l'interrupteur répond immédiatement, l'erreur rétablit.
    const saveHideArchived = async (value: boolean) => {
        const previous = hideArchived;
        setHideArchived(value);
        try {
            const res = await fetch("/api/admin/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ hideArchivedQueues: value }),
            });
            if (!res.ok) throw new Error();
            toast.success(value
                ? "Les files archivées sont masquées des listes"
                : "Les files archivées réapparaissent dans les listes");
        } catch {
            setHideArchived(previous);
            toast.error("Enregistrement impossible");
        }
    };

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/admin/queues?server=${getSelectedServer()}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Chargement impossible");
            setQueues(data.queues || []);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Chargement impossible");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);


    const runDiscovery = async () => {
        setIsDiscovering(true);
        try {
            const res = await fetch(`/api/admin/queues?server=${getSelectedServer()}`, { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Découverte impossible");

            toast.success(
                `${data.discovered} file(s) analysée(s) — ${data.created} nouvelle(s), ${data.agentLinks} rattachement(s) de collaborateurs`,
            );
            if (data.renamed?.length > 0) {
                for (const r of data.renamed) {
                    toast.warning(`File ${r.queueNumber} renommée : « ${r.from} » → « ${r.to} ». Vérifiez les périmètres.`, {
                        duration: 10000,
                    });
                }
            }
            await load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Découverte impossible");
        } finally {
            setIsDiscovering(false);
        }
    };

    /** Applique une modification à une file (et rafraîchit la ligne localement). */
    const patchQueue = async (id: string, patch: Partial<Pick<RegistryQueue, "entity" | "region" | "service" | "status">>) => {
        const previous = queues;
        setQueues((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));
        try {
            const res = await fetch("/api/admin/queues", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, ...patch }),
            });
            if (!res.ok) throw new Error((await res.json()).error || "Enregistrement impossible");
        } catch (e) {
            setQueues(previous); // rollback visuel
            toast.error(e instanceof Error ? e.message : "Enregistrement impossible");
        }
    };

    /**
     * Retire le signalement « nouvelle ».
     * Sans identifiants, s'applique à toutes les files du tenant.
     */
    const markReviewed = async (ids?: string[]) => {
        setBulkBusy(true);
        try {
            const res = await fetch(`/api/admin/queues?server=${getSelectedServer()}&action=review`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: ids ?? [] }),
            });
            if (!res.ok) throw new Error((await res.json()).error || "Action impossible");
            const target = ids ? new Set(ids) : null;
            setQueues((qs) => qs.map((q) => (!target || target.has(q.id) ? { ...q, isNew: false } : q)));
            if (ids) setSelected(new Set());
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Action impossible");
        } finally {
            setBulkBusy(false);
        }
    };

    /** Applique la même modification à toutes les files sélectionnées. */
    const patchSelection = async (patch: Partial<Pick<RegistryQueue, "region" | "entity" | "status">>) => {
        const ids = [...selected];
        setBulkBusy(true);
        try {
            await Promise.all(ids.map((id) => patchQueue(id, patch)));
            toast.success(`${ids.length} file(s) mise(s) à jour`);
            setSelected(new Set());
        } finally {
            setBulkBusy(false);
        }
    };

    const newQueues = queues.filter((q) => q.isNew).length;
    const renamedQueues = queues.filter((q) => q.previousNames.length > 0);

    // Santé calculée côté client à partir de l'activité réelle des agents.
    const health = useMemo(() => {
        const map = new Map<string, ReturnType<typeof assessQueueHealth>>();
        queues.forEach((q) => map.set(q.id, assessQueueHealth(q)));
        return map;
    }, [queues]);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        return queues.filter((q) => {
            if (statusFilter !== "ALL" && q.status !== statusFilter) return false;
            if (healthFilter !== "ALL" && health.get(q.id)?.level !== healthFilter) return false;
            if (!term) return true;
            return (
                q.queueNumber.includes(term) ||
                q.currentName.toLowerCase().includes(term) ||
                (q.region ?? "").toLowerCase().includes(term) ||
                (q.entity ?? "").toLowerCase().includes(term) ||
                // Recherche par agent : retrouve les files où il est sollicité.
                q.agents.some((a) => a.name.toLowerCase().includes(term) || a.extension.includes(term))
            );
        });
    }, [queues, search, statusFilter, healthFilter, health]);

    /** Agents correspondant à la recherche, pour expliquer pourquoi une file remonte. */
    const matchedAgents = (q: RegistryQueue) => {
        const term = search.trim().toLowerCase();
        if (!term) return [];
        return q.agents.filter((a) => a.name.toLowerCase().includes(term) || a.extension.includes(term));
    };

    const toggle = (id: string) => {
        setSelected((s) => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const allVisibleSelected = filtered.length > 0 && filtered.every((q) => selected.has(q.id));

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                <span className="ml-2 text-slate-500">Chargement du registre…</span>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-slate-900">Registre des files d&apos;attente</h2>
                    <p className="text-sm text-slate-500">
                        {queues.length} file(s) — les étiquettes servent à composer les périmètres des managers
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                    {/* Filtre d'AFFICHAGE global : sidebar, sélecteur et aperçu
                        des groupes. Les périmètres et les données restent intacts. */}
                    <Tip content="Retire les files archivées de la barre latérale, de la recherche et de l'aperçu des groupes — pour tous les utilisateurs. Périmètres, statistiques passées et journaux restent intacts.">
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                            <Switch
                                checked={hideArchived === true}
                                disabled={hideArchived === null}
                                onCheckedChange={saveHideArchived}
                            />
                            Masquer les files archivées des listes
                        </label>
                    </Tip>
                    <Button onClick={runDiscovery} disabled={isDiscovering}>
                        {isDiscovering ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Découverte…</>
                        ) : (
                            <><RefreshCw className="mr-2 h-4 w-4" /> Découvrir les files</>
                        )}
                    </Button>
                </div>
            </div>

            {queues.length === 0 && (
                <Card className="border-dashed">
                    <CardContent className="py-12 text-center">
                        <Tag className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                        <h3 className="font-medium text-slate-900">Registre vide</h3>
                        <p className="text-sm text-slate-500 mt-1">
                            Lancez la découverte pour importer les files depuis l&apos;historique des appels.
                        </p>
                    </CardContent>
                </Card>
            )}

            {newQueues > 0 && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <AlertTriangle className="h-5 w-5 flex-shrink-0 text-blue-600" />
                    <p className="flex-1 text-sm text-blue-800">
                        <strong>{newQueues} nouvelle(s) file(s) détectée(s).</strong> Vérifiez leurs étiquettes, puis
                        ajoutez-les aux périmètres concernés depuis la fiche des utilisateurs.
                    </p>
                    <Button size="sm" variant="outline" className="bg-white" onClick={() => markReviewed()}>
                        J&apos;ai vu
                    </Button>
                </div>
            )}

            {renamedQueues.length > 0 && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <p className="mb-2 text-sm font-medium text-blue-900">
                        {renamedQueues.length} file(s) renommée(s) dans 3CX — vérifiez que les périmètres restent corrects
                    </p>
                    <ul className="space-y-1 text-xs text-blue-800">
                        {renamedQueues.map((q) => (
                            <li key={q.id}>
                                <span className="font-mono">{q.queueNumber}</span> : « {q.previousNames.join(" », « ")} » →{" "}
                                <strong>« {q.currentName} »</strong>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {queues.length > 0 && (
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Rechercher par numéro, nom, région, entité ou collaborateur…"
                            className="pl-9"
                        />
                    </div>
                    <Select value={healthFilter} onValueChange={(v) => setHealthFilter(v as HealthLevel | "ALL")}>
                        <SelectTrigger className="w-full md:w-44">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ALL">Tous les états</SelectItem>
                            <SelectItem value="critical">⚠ Problème</SelectItem>
                            <SelectItem value="warning">À surveiller</SelectItem>
                            <SelectItem value="ok">OK</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as QueueStatus | "ALL")}>
                        <SelectTrigger className="w-full md:w-40">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ALL">Tous les statuts</SelectItem>
                            <SelectItem value="ACTIVE">Actives</SelectItem>
                            <SelectItem value="ARCHIVED">Archivées</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            )}

            {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <span className="text-sm font-medium text-blue-900">{selected.size} sélectionnée(s)</span>
                    <Select onValueChange={(region) => patchSelection({ region })}>
                        <SelectTrigger className="h-9 w-48 bg-white">
                            <SelectValue placeholder="Attribuer une région…" />
                        </SelectTrigger>
                        <SelectContent>
                            {KNOWN_REGIONS.map((r) => (
                                <SelectItem key={r} value={r}>{r}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div className="h-6 w-px bg-blue-200" />

                    <Button
                        size="sm"
                        variant="outline"
                        className="bg-white"
                        disabled={bulkBusy}
                        onClick={() => patchSelection({ status: "ACTIVE" })}
                    >
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                        Activer
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        className="bg-white"
                        disabled={bulkBusy}
                        onClick={() => patchSelection({ status: "ARCHIVED" })}
                    >
                        <Archive className="mr-1.5 h-3.5 w-3.5 text-slate-500" />
                        Archiver
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        className="bg-white"
                        disabled={bulkBusy}
                        onClick={() => markReviewed([...selected])}
                    >
                        <Eye className="mr-1.5 h-3.5 w-3.5 text-slate-500" />
                        Marquer comme vues
                    </Button>

                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
                        Annuler
                    </Button>
                </div>
            )}

            {queues.length > 0 && (
                <Card>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="border-b bg-slate-50">
                                    <tr>
                                        <th className="w-10 px-4 py-3">
                                            <Checkbox
                                                checked={allVisibleSelected}
                                                onCheckedChange={(checked) =>
                                                    setSelected(checked ? new Set(filtered.map((q) => q.id)) : new Set())
                                                }
                                            />
                                        </th>
                                        <th className="w-12 px-2 py-3 text-center font-medium text-slate-600">
                                            <Tip content="État de la file">
                                                <span>État</span>
                                            </Tip>
                                        </th>
                                        <th className="px-4 py-3 text-left font-medium text-slate-600">N°</th>
                                        <th className="px-4 py-3 text-left font-medium text-slate-600">Nom actuel</th>
                                        <th className="px-4 py-3 text-left font-medium text-slate-600">Entité</th>
                                        <th className="px-4 py-3 text-left font-medium text-slate-600">Région</th>
                                        <th className="px-4 py-3 text-left font-medium text-slate-600">Service</th>
                                        <th className="px-4 py-3 text-left font-medium text-slate-600">Collaborateurs</th>
                                        <th className="px-4 py-3 text-left font-medium text-slate-600">Dernier appel</th>
                                        <th className="px-4 py-3 text-left font-medium text-slate-600">Statut</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {filtered.map((q) => (
                                        <tr
                                            key={q.id}
                                            onClick={() => setDetailQueueId(q.id)}
                                            className={cn(
                                                "cursor-pointer hover:bg-slate-50",
                                                q.status === "ARCHIVED" && "opacity-60",
                                            )}
                                            title="Voir le détail (collaborateurs, historique)"
                                        >
                                            {/* Les cellules interactives stoppent la propagation pour ne pas
                                                ouvrir la fiche à chaque édition d'étiquette. */}
                                            <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                                                <Checkbox checked={selected.has(q.id)} onCheckedChange={() => toggle(q.id)} />
                                            </td>
                                            <td className="px-2 py-2 text-center">
                                                <Tip content={`${healthStyles[health.get(q.id)?.level ?? "ok"].label} — ${(health.get(q.id)?.reasons ?? []).join(" · ")}`}>
                                                    <span
                                                        className={cn(
                                                            "inline-block h-2.5 w-2.5 rounded-full",
                                                            healthStyles[health.get(q.id)?.level ?? "ok"].dot,
                                                        )}
                                                    />
                                                </Tip>
                                            </td>
                                            <td className="px-4 py-2 font-mono text-xs text-slate-600">{q.queueNumber}</td>
                                            <td className="px-4 py-2">
                                                <span className="font-medium">{q.currentName}</span>
                                                {q.isNew && (
                                                    <Badge variant="outline" className="ml-2 border-blue-200 bg-blue-50 text-[10px] text-blue-700">
                                                        Nouvelle
                                                    </Badge>
                                                )}
                                                {q.previousNames.length > 0 && (
                                                    <Tip content={`Ancien(s) nom(s) : ${q.previousNames.join(", ")}`}>
                                                        <span className="ml-2 text-xs text-blue-600">
                                                            (renommée)
                                                        </span>
                                                    </Tip>
                                                )}
                                                {q.department && (
                                                    <p className="mt-0.5 text-xs text-slate-400">Département {q.department}</p>
                                                )}
                                                {/* Explique pourquoi la file remonte lors d'une recherche par agent */}
                                                {matchedAgents(q).length > 0 && (
                                                    <p className="mt-0.5 text-xs text-blue-600">
                                                        ↳ {matchedAgents(q).map((a) => `${a.name} (${a.extension})`).join(", ")}
                                                    </p>
                                                )}
                                            </td>
                                            <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                                                <Input
                                                    defaultValue={q.entity ?? ""}
                                                    onBlur={(e) => {
                                                        const v = e.target.value.trim() || null;
                                                        if (v !== q.entity) patchQueue(q.id, { entity: v });
                                                    }}
                                                    className="h-8 w-24 text-xs"
                                                    placeholder="—"
                                                />
                                            </td>
                                            <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                                                <Input
                                                    defaultValue={q.region ?? ""}
                                                    onBlur={(e) => {
                                                        const v = e.target.value.trim().toUpperCase() || null;
                                                        if (v !== q.region) patchQueue(q.id, { region: v });
                                                    }}
                                                    className="h-8 w-32 text-xs"
                                                    placeholder="—"
                                                />
                                            </td>
                                            <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                                                <Input
                                                    defaultValue={q.service ?? ""}
                                                    onBlur={(e) => {
                                                        const v = e.target.value.trim() || null;
                                                        if (v !== q.service) patchQueue(q.id, { service: v });
                                                    }}
                                                    className="h-8 w-40 text-xs"
                                                    placeholder="—"
                                                />
                                            </td>
                                            <td className="px-4 py-2">
                                                <Tip content={`${health.get(q.id)?.activeAgents ?? 0} actif(s) · ${health.get(q.id)?.staleAgents ?? 0} inactif(s) > 30j`}>
                                                    <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                                                        <Users className="h-3 w-3 text-slate-400" />
                                                        {q.agentCount}
                                                        {(health.get(q.id)?.activeAgents ?? 0) > 0 && (
                                                            <span className="text-emerald-600">({health.get(q.id)?.activeAgents})</span>
                                                        )}
                                                    </span>
                                                </Tip>
                                            </td>
                                            <td className="px-4 py-2 text-xs text-slate-500">
                                                {q.lastCallAt
                                                    ? formatDistanceToNow(new Date(q.lastCallAt), { addSuffix: true, locale: fr })
                                                    : "—"}
                                            </td>
                                            <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex items-center gap-1">
                                                <Tip content="Parcours d'appel — configuration déduite des 90 derniers jours">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setFlowQueue({ number: q.queueNumber, name: q.currentName })}
                                                        className="h-8 w-8 text-slate-400 hover:text-sky-600"
                                                    >
                                                        <Workflow className="h-4 w-4" />
                                                    </Button>
                                                </Tip>
                                                <Select value={q.status} onValueChange={(v) => patchQueue(q.id, { status: v as QueueStatus })}>
                                                    <SelectTrigger className={cn("h-8 w-32 text-xs", statusStyles[q.status])}>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {(Object.keys(statusLabels) as QueueStatus[]).map((s) => (
                                                            <SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {filtered.length === 0 && (
                                        <tr>
                                            <td colSpan={10} className="py-8 text-center text-slate-500">
                                                Aucune file ne correspond à ces critères
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {queues.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    <p className="mb-2 font-medium text-slate-700">À savoir :</p>
                    <ul className="list-inside list-disc space-y-1">
                        <li>Cliquez sur le nom d&apos;une file pour voir ses collaborateurs et l&apos;historique de ses noms.</li>
                        <li>Les files sont découvertes via l&apos;historique des appels : une nouvelle file n&apos;apparaît qu&apos;après son premier appel traité.</li>
                        <li>Une file supprimée dans 3CX ne disparaît pas d&apos;elle-même : elle passe en « Archivée » après 90 jours sans appel.</li>
                        <li>Les étiquettes servent à composer les périmètres ; elles ne donnent aucun droit par elles-mêmes.</li>
                        <li>Le périmètre d&apos;un manager s&apos;appuie sur le numéro de file : un renommage dans 3CX ne modifie jamais ses accès.</li>
                    </ul>
                </div>
            )}

            <QueueFlowModal
                queueNumber={flowQueue?.number ?? null}
                queueName={flowQueue?.name ?? ""}
                onClose={() => setFlowQueue(null)}
            />
            <QueueDetailDialog
                queueId={detailQueueId}
                serverId={getSelectedServer()}
                open={!!detailQueueId}
                onOpenChange={(open) => !open && setDetailQueueId(null)}
            />
        </div>
    );
}
