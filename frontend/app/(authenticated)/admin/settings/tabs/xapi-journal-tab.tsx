"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BookOpenCheck, Loader2, Moon, RefreshCw, XCircle, CheckCircle2 } from "lucide-react";

import { getSelectedServer } from "@/lib/selected-server";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QueueAgentPicker } from "@/components/queue-agent-picker";
import type { QueueInfo } from "@/types/queues.types";
import { Tip } from "@/components/ui/tooltip";

/**
 * Onglet « Journal des équipes (XAPI) » — la mémoire de qui compose chaque
 * équipe, relevée chaque nuit auprès du 3CX.
 *
 * Le journal ACCUMULE, il n'est encore consommé par aucun écran de
 * statistiques : cet onglet sert à vérifier qu'il s'écrit (relevés, comptes,
 * erreurs) et à consulter l'historique par équipe. Tout ici est estampillé
 * XAPI : sans la surcouche, l'onglet explique quoi activer et où.
 */

interface RunRow {
    ranAt: string; ok: boolean; queues: number; members: number; changes: number; error: string | null;
}
interface MembreRow { extension: string; name: string; lastSeenAt: string }
interface QueueRow {
    queueNumber: string;
    queueName: string;
    queueDepartment: string | null;
    members: number;
    membres: MembreRow[];
}
interface IntervalRow {
    extension: string; agentName: string;
    firstSeenAt: string; lastSeenAt: string; closedAt: string | null;
}

const dateTime = (iso: string) => new Date(iso).toLocaleString("fr-CH", { dateStyle: "short", timeStyle: "short" });
const dateOnly = (iso: string) => new Date(iso).toLocaleDateString("fr-CH");

export function XapiJournalTab() {
    const serverId = getSelectedServer();
    const [loading, setLoading] = useState(true);
    const [xapiUsable, setXapiUsable] = useState(false);
    const [xapiEnabled, setXapiEnabled] = useState(false);
    const [runs, setRuns] = useState<RunRow[]>([]);
    const [openCount, setOpenCount] = useState(0);
    const [queues, setQueues] = useState<QueueRow[]>([]);
    const [running, setRunning] = useState(false);
    const [selectedQueue, setSelectedQueue] = useState<string>("");
    const [intervals, setIntervals] = useState<IntervalRow[] | null>(null);
    const [intervalsLoading, setIntervalsLoading] = useState(false);

    // Le sélecteur partagé parle en QueueInfo : on lui traduit le journal.
    // `attemptsCount` n'a pas de sens ici (le journal ne compte pas les
    // sollicitations) — il ne sert qu'au tri des autres écrans.
    const queuesPourSelecteur: QueueInfo[] = useMemo(() => queues.map((q) => ({
        queueNumber: q.queueNumber,
        queueName: q.queueName,
        queueDepartment: q.queueDepartment,
        memberCount: q.members,
        members: q.membres.map((m) => ({
            agentExtension: m.extension,
            agentName: m.name,
            attemptsCount: 0,
            lastSeenAt: m.lastSeenAt,
        })),
    })), [queues]);

    const equipeChoisie = useMemo(
        () => queues.find((q) => q.queueNumber === selectedQueue) ?? null,
        [queues, selectedQueue],
    );

    const reload = useCallback(async () => {
        try {
            const res = await fetch(`/api/admin/xapi-journal?server=${encodeURIComponent(serverId)}`);
            const data = await res.json();
            if (res.ok) {
                setXapiUsable(data.xapiUsable);
                setXapiEnabled(data.xapiEnabled);
                setRuns(data.runs ?? []);
                setOpenCount(data.openCount ?? 0);
                setQueues(data.queues ?? []);
            } else {
                toast.error(data.error || "Lecture du journal impossible");
            }
        } catch {
            toast.error("Lecture du journal impossible");
        } finally {
            setLoading(false);
        }
    }, [serverId]);

    useEffect(() => { void reload(); }, [reload]);

    useEffect(() => {
        if (!selectedQueue) { setIntervals(null); return; }
        let cancelled = false;
        setIntervalsLoading(true);
        fetch(`/api/admin/xapi-journal?server=${encodeURIComponent(serverId)}&queue=${encodeURIComponent(selectedQueue)}`)
            .then((res) => res.json())
            .then((data) => { if (!cancelled) setIntervals(data.intervals ?? []); })
            .catch(() => { if (!cancelled) setIntervals([]); })
            .finally(() => { if (!cancelled) setIntervalsLoading(false); });
        return () => { cancelled = true; };
    }, [selectedQueue, serverId]);

    const handleRunNow = async () => {
        setRunning(true);
        try {
            const res = await fetch("/api/admin/xapi-journal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serverId }),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(data.error || "Relevé impossible");
            } else if (!data.ran || !data.ok) {
                toast.error(data.reason || "Relevé en échec");
            } else {
                toast.success(`Relevé effectué : ${data.members} membres sur ${data.queues} équipes, ${data.changes} mouvement(s)`);
            }
            await reload();
            if (selectedQueue) setSelectedQueue((q) => q); // recharge le détail affiché
        } catch {
            toast.error("Relevé impossible");
        } finally {
            setRunning(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                <span className="ml-2 text-slate-500">Chargement du journal…</span>
            </div>
        );
    }

    return (
        <div className="max-w-3xl space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <BookOpenCheck className="h-5 w-5 text-violet-600" />
                                Journal des équipes
                                <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                                    Surcouche XAPI
                                </span>
                            </CardTitle>
                            <CardDescription className="mt-1 max-w-xl">
                                Chaque nuit, la composition réelle de chaque équipe est relevée auprès
                                du 3CX et datée. Le journal accumule l&apos;historique — qui était membre,
                                de quand à quand — sans rien changer aux statistiques actuelles.
                            </CardDescription>
                        </div>
                        <Button onClick={handleRunNow} disabled={running || !xapiUsable}>
                            {running
                                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Relevé en cours…</>
                                : <><RefreshCw className="mr-2 h-4 w-4" />Relever maintenant</>}
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    {!xapiUsable ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                            {xapiEnabled
                                ? "La surcouche XAPI est activée mais incomplète : renseignez l'adresse du PBX, l'ID client et la clé API dans l'onglet Tenant, puis testez la connexion."
                                : "La surcouche XAPI est désactivée pour ce tenant. Le journal ne peut pas se remplir — activez-la dans l'onglet Tenant. Le reste de l'application fonctionne normalement sans elle."}
                        </div>
                    ) : (
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-600">
                            <span className="flex items-center gap-1.5">
                                <Moon className="h-4 w-4 text-slate-400" />
                                Relevé automatique chaque nuit dès 3 h
                            </span>
                            <span><span className="font-semibold text-slate-900">{openCount}</span> appartenances en cours</span>
                            <Tip content="Équipes ayant au moins un membre aujourd'hui. Une équipe vidée de tous ses membres reste dans l'historique mais sort de ce compte — d'où l'écart possible avec le nombre d'équipes vues au 3CX lors du relevé.">
                                <span><span className="font-semibold text-slate-900">{queues.length}</span> équipes avec un membre</span>
                            </Tip>
                        </div>
                    )}

                    <div>
                        <p className="mb-2 text-sm font-medium text-slate-700">Derniers relevés</p>
                        {runs.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                                Aucun relevé pour l&apos;instant — le premier partira automatiquement, ou
                                tout de suite avec le bouton ci-dessus.
                            </p>
                        ) : (
                            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                                {runs.map((run) => (
                                    <li key={run.ranAt} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                                        {run.ok
                                            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                                            : <XCircle className="h-4 w-4 shrink-0 text-red-600" />}
                                        <span className="w-32 tabular-nums text-slate-700">{dateTime(run.ranAt)}</span>
                                        {run.ok ? (
                                            <span className="text-slate-600">
                                                {run.members} membres · {run.queues} équipes vues au 3CX ·{" "}
                                                <span className={run.changes > 0 ? "font-medium text-violet-700" : ""}>
                                                    {run.changes} mouvement{run.changes > 1 ? "s" : ""}
                                                </span>
                                            </span>
                                        ) : (
                                            <span className="min-w-0 flex-1 truncate text-red-700" title={run.error ?? undefined}>
                                                {run.error || "Échec"}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Historique par équipe</CardTitle>
                    <CardDescription>
                        Les appartenances datées, telles que relevées — un changement de titulaire
                        sur un même poste ferme la ligne et en ouvre une nouvelle.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Le MÊME sélecteur que la recherche du header : on trouve
                        une équipe par son nom, son numéro, son étiquette — ou par
                        le nom d'un collaborateur, qui mène à son équipe. Les
                        membres viennent du journal lui-même, pas des CDR : la
                        recherche décrit donc exactement ce que l'onglet montre. */}
                    <QueueAgentPicker
                        queues={queuesPourSelecteur}
                        show="both"
                        selectedQueueNumber={selectedQueue || null}
                        onSelect={(item) => setSelectedQueue(item.queueNumber)}
                        placeholder={queues.length ? "Chercher une équipe ou un collaborateur…" : "Journal encore vide"}
                        displayValue={equipeChoisie
                            ? `${equipeChoisie.queueName} · ${equipeChoisie.queueNumber} · ${equipeChoisie.members} membre${equipeChoisie.members > 1 ? "s" : ""}`
                            : undefined}
                        className="w-full max-w-xl"
                    />

                    {intervalsLoading ? (
                        <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
                        </div>
                    ) : intervals && (
                        intervals.length === 0 ? (
                            <p className="text-sm text-slate-500">Aucune ligne pour cette équipe.</p>
                        ) : (
                            <div className="overflow-x-auto rounded-lg border border-slate-200">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                                            <th className="px-3 py-2 font-medium">Poste</th>
                                            <th className="px-3 py-2 font-medium">Nom</th>
                                            <th className="px-3 py-2 font-medium">Membre depuis</th>
                                            <th className="px-3 py-2 font-medium">Jusqu&apos;au</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {intervals.map((row, i) => (
                                            <tr key={i} className={row.closedAt ? "text-slate-500" : ""}>
                                                <td className="px-3 py-2 font-mono text-xs">{row.extension}</td>
                                                <td className="px-3 py-2">{row.agentName}</td>
                                                <td className="px-3 py-2 tabular-nums">
                                                    <Tip content={`Premier relevé : ${dateTime(row.firstSeenAt)}`}>
                                                        <span>{dateOnly(row.firstSeenAt)}</span>
                                                    </Tip>
                                                </td>
                                                <td className="px-3 py-2 tabular-nums">
                                                    {row.closedAt ? dateOnly(row.closedAt) : (
                                                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                                            aujourd&apos;hui
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
