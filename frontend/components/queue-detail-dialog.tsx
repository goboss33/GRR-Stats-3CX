"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Users, History, BarChart3, Search, Phone } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ShieldCheck, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import { fr } from "date-fns/locale";

interface AccessUser {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    role: string;
}

const userLabel = (u: AccessUser) => [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email;

interface QueueDetail {
    id: string;
    queueNumber: string;
    currentName: string;
    entity: string | null;
    region: string | null;
    service: string | null;
    status: string;
    isNew: boolean;
    firstSeenAt: string;
    lastSeenAt: string;
    previousNames: { name: string; seenAt: string }[];
    agents: { extension: string; name: string; attempts: number; lastSeenAt: string }[];
}

/** Pastille d'activité : un agent « actif » a été sollicité récemment. */
function activityStatus(lastSeenIso: string) {
    const days = (Date.now() - new Date(lastSeenIso).getTime()) / (1000 * 60 * 60 * 24);
    if (days < 7) return { dot: "bg-emerald-500", label: "Actif", chip: "text-emerald-700 bg-emerald-50 border-emerald-200" };
    if (days < 30) return { dot: "bg-amber-500", label: "Inactif < 30j", chip: "text-amber-700 bg-amber-50 border-amber-200" };
    return { dot: "bg-slate-400", label: "Inactif > 30j", chip: "text-slate-500 bg-slate-50 border-slate-200" };
}

export function QueueDetailDialog({
    queueId,
    serverId,
    open,
    onOpenChange,
}: {
    queueId: string | null;
    serverId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [detail, setDetail] = useState<QueueDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [granted, setGranted] = useState<AccessUser[]>([]);
    const [assignable, setAssignable] = useState<AccessUser[]>([]);
    const [userSearch, setUserSearch] = useState("");
    const [addOpen, setAddOpen] = useState(false);

    const load = useCallback(async () => {
        if (!queueId) return;
        setLoading(true);
        try {
            const [detailRes, accessRes] = await Promise.all([
                fetch(`/api/admin/queues/${queueId}?server=${serverId}`),
                fetch(`/api/admin/queues/${queueId}/access`),
            ]);
            const data = await detailRes.json();
            if (!detailRes.ok) throw new Error(data.error || "Chargement impossible");
            setDetail(data.queue);

            const access = await accessRes.json();
            if (accessRes.ok) {
                setGranted(access.granted ?? []);
                setAssignable(access.assignable ?? []);
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Chargement impossible");
        } finally {
            setLoading(false);
        }
    }, [queueId, serverId]);

    useEffect(() => {
        if (open) {
            setSearch("");
            load();
        }
    }, [open, load]);

    /** Ajoute ou retire l'accès d'un utilisateur à cette file (mise à jour optimiste). */
    const changeAccess = async (user: AccessUser, grant: boolean) => {
        const prevGranted = granted;
        const prevAssignable = assignable;
        setGranted(grant ? [...granted, user] : granted.filter((u) => u.id !== user.id));
        setAssignable(grant ? assignable.filter((u) => u.id !== user.id) : [...assignable, user]);

        try {
            const res = grant
                ? await fetch(`/api/admin/queues/${queueId}/access`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ userId: user.id }),
                  })
                : await fetch(`/api/admin/queues/${queueId}/access?userId=${user.id}`, { method: "DELETE" });

            if (!res.ok) throw new Error((await res.json()).error || "Action impossible");
            toast.success(
                grant
                    ? `${userLabel(user)} a désormais accès à cette file`
                    : `Accès retiré à ${userLabel(user)}`,
            );
        } catch (e) {
            setGranted(prevGranted);
            setAssignable(prevAssignable);
            toast.error(e instanceof Error ? e.message : "Action impossible");
        }
    };

    const assignableFiltered = useMemo(() => {
        const term = userSearch.trim().toLowerCase();
        if (!term) return assignable;
        return assignable.filter(
            (u) => userLabel(u).toLowerCase().includes(term) || u.email.toLowerCase().includes(term),
        );
    }, [assignable, userSearch]);

    const agents = useMemo(() => {
        if (!detail) return [];
        const term = search.trim().toLowerCase();
        if (!term) return detail.agents;
        return detail.agents.filter(
            (a) => a.extension.includes(term) || a.name.toLowerCase().includes(term),
        );
    }, [detail, search]);

    const activeCount = detail?.agents.filter((a) => activityStatus(a.lastSeenAt).label === "Actif").length ?? 0;
    const totalAttempts = detail?.agents.reduce((s, a) => s + a.attempts, 0) ?? 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                {loading || !detail ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                    </div>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex flex-wrap items-center gap-2">
                                <span className="rounded border bg-slate-50 px-1.5 py-0.5 font-mono text-sm text-slate-600">
                                    {detail.queueNumber}
                                </span>
                                {detail.currentName}
                                {detail.isNew && (
                                    <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                                        Nouvelle
                                    </Badge>
                                )}
                                {detail.status === "ARCHIVED" && (
                                    <Badge variant="outline" className="bg-slate-100 text-slate-500">Archivée</Badge>
                                )}
                            </DialogTitle>
                            <DialogDescription>
                                {[detail.entity, detail.region, detail.service].filter(Boolean).join(" · ") || "Aucune étiquette"}
                            </DialogDescription>
                        </DialogHeader>

                        {/* Repères d'activité */}
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {[
                                { label: "Agents", value: detail.agents.length, icon: Users },
                                { label: "Actifs (7j)", value: activeCount, icon: Phone },
                                { label: "Sollicitations", value: totalAttempts.toLocaleString("fr-CH"), icon: BarChart3 },
                                {
                                    label: "Dernier appel",
                                    value: formatDistanceToNow(new Date(detail.lastSeenAt), { addSuffix: true, locale: fr }),
                                    icon: History,
                                },
                            ].map((s) => (
                                <div key={s.label} className="rounded-lg border p-3">
                                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                        <s.icon className="h-3.5 w-3.5" />
                                        {s.label}
                                    </div>
                                    <p className="mt-1 text-lg font-semibold text-slate-900">{s.value}</p>
                                </div>
                            ))}
                        </div>

                        {/* Historique des renommages */}
                        {detail.previousNames.length > 0 && (
                            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                                <p className="mb-1 text-sm font-medium text-blue-900">Anciens noms dans 3CX</p>
                                <ul className="space-y-0.5 text-xs text-blue-800">
                                    {detail.previousNames.map((n) => (
                                        <li key={n.name}>« {n.name} »</li>
                                    ))}
                                </ul>
                                <p className="mt-2 text-xs text-blue-700">
                                    Le périmètre suit le numéro de file : un renommage ne modifie jamais les accès.
                                </p>
                            </div>
                        )}

                        {/* Agents */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                                <h3 className="text-sm font-medium text-slate-900">Agents sollicités par cette file</h3>
                                <div className="relative w-48">
                                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                    <Input
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        placeholder="Filtrer…"
                                        className="h-8 pl-8 text-xs"
                                    />
                                </div>
                            </div>

                            <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                                {agents.map((a) => {
                                    const st = activityStatus(a.lastSeenAt);
                                    return (
                                        <div key={a.extension} className="flex items-center justify-between gap-3 p-3 hover:bg-slate-50">
                                            <div className="flex min-w-0 items-center gap-3">
                                                <span className={cn("h-2 w-2 flex-shrink-0 rounded-full", st.dot)} title={st.label} />
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-medium text-slate-900">{a.name}</p>
                                                    <p className="font-mono text-xs text-slate-500">
                                                        Ext. {a.extension} · vu {formatDistanceToNow(new Date(a.lastSeenAt), { addSuffix: true, locale: fr })}
                                                    </p>
                                                </div>
                                            </div>
                                            <Badge variant="outline" className={cn("flex-shrink-0 text-[10px]", st.chip)}>
                                                {a.attempts.toLocaleString("fr-CH")} appels
                                            </Badge>
                                        </div>
                                    );
                                })}
                                {agents.length === 0 && (
                                    <p className="py-8 text-center text-sm text-slate-500">
                                        {detail.agents.length === 0
                                            ? "Aucun agent n'a été sollicité par cette file"
                                            : "Aucun agent ne correspond"}
                                    </p>
                                )}
                            </div>
                            <p className="text-xs text-slate-500">
                                Première activité observée le {format(new Date(detail.firstSeenAt), "dd/MM/yyyy", { locale: fr })}.
                                Ces agents composent automatiquement le périmètre des managers ayant cette file.
                            </p>
                        </div>

                        {/* Accès à cette file */}
                        <div className="space-y-2 rounded-lg border p-3">
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4 text-slate-500" />
                                <h3 className="text-sm font-medium text-slate-900">Accès à cette file</h3>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                {granted.map((u) => (
                                    <Badge
                                        key={u.id}
                                        variant="outline"
                                        className="gap-1 border-slate-200 bg-slate-50 py-1 pl-2 pr-1 font-normal"
                                    >
                                        {userLabel(u)}
                                        <button
                                            type="button"
                                            onClick={() => changeAccess(u, false)}
                                            className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                                            title="Retirer l'accès"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                ))}

                                {granted.length === 0 && (
                                    <span className="text-sm text-slate-500">Aucun manager n&apos;a cette file dans son périmètre</span>
                                )}

                                <Popover open={addOpen} onOpenChange={setAddOpen}>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                                            <Plus className="h-3 w-3" /> Ajouter
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent align="start" className="w-72 p-0">
                                        <div className="border-b p-2">
                                            <Input
                                                value={userSearch}
                                                onChange={(e) => setUserSearch(e.target.value)}
                                                placeholder="Rechercher un manager…"
                                                className="h-8 text-xs"
                                                autoFocus
                                            />
                                        </div>
                                        <div className="max-h-56 overflow-y-auto p-1">
                                            {assignableFiltered.map((u) => (
                                                <button
                                                    key={u.id}
                                                    type="button"
                                                    onClick={() => {
                                                        changeAccess(u, true);
                                                        setUserSearch("");
                                                        setAddOpen(false);
                                                    }}
                                                    className="w-full rounded px-2 py-1.5 text-left hover:bg-slate-100"
                                                >
                                                    <p className="text-sm text-slate-900">{userLabel(u)}</p>
                                                    <p className="text-xs text-slate-500">{u.email}</p>
                                                </button>
                                            ))}
                                            {assignableFiltered.length === 0 && (
                                                <p className="px-2 py-6 text-center text-xs text-slate-500">
                                                    {assignable.length === 0
                                                        ? "Tous les managers ont déjà cette file"
                                                        : "Aucun manager ne correspond"}
                                                </p>
                                            )}
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            </div>

                            <p className="text-xs text-slate-500">
                                Les administrateurs et modérateurs ne figurent pas ici : leur accès est global et ne
                                dépend d&apos;aucun périmètre. Ajouter un manager lui accorde aussi le tenant si besoin.
                            </p>
                        </div>

                        <DialogFooter className="gap-2 sm:justify-between">
                            <Button asChild variant="outline">
                                <Link href={`/statistics-v2?queue=${detail.queueNumber}`}>
                                    <BarChart3 className="mr-2 h-4 w-4" />
                                    Voir les statistiques
                                </Link>
                            </Button>
                            <Button onClick={() => onOpenChange(false)}>Fermer</Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
