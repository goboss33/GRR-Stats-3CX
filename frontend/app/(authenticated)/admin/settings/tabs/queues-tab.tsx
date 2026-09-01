"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Tag, Search, Users, CheckCircle2, Archive, Workflow } from "lucide-react";
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
import { QueueDetailDialog } from "@/components/queue-detail-dialog";
import { Attente } from "@/components/ui/etat-chargement";
import type { Changement } from "@/services/queue-changelog.service";
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
    /** Premier appel reçu par la file : c'est l'âge qui fait la nouveauté. */
    firstSeenAt: string;
    /** Combien d'utilisateurs ont cette file dans leur périmètre. */
    perimeterCount: number;
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

/**
 * Au-delà de ce délai, une file n'est plus une nouveauté.
 *
 * Le signal reposait auparavant sur un accusé de réception (« J'ai vu »), qui
 * s'éteignait d'un seul clic pour tout le registre — mesuré le 1er septembre
 * 2026 : 0 file signalée sur 107, le bandeau ne pouvait plus jamais servir.
 * L'âge, lui, ne se laisse pas éteindre : il dit la vérité tout seul.
 */
const JOURS_NOUVEAUTE = 30;

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
    // Trois onglets au lieu d'un filtre de statut : les archivées sont du bruit
    // dans 95 % des consultations, et le journal n'a rien à faire dans le même
    // tableau. Le filtre « Tous les statuts » disparaît — il ferait doublon.
    const [onglet, setOnglet] = useState<"actives" | "archivees" | "changements">("actives");
    const [changements, setChangements] = useState<Changement[] | "chargement" | "échec" | null>(null);
    const [healthFilter, setHealthFilter] = useState<HealthLevel | "ALL">("ALL");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [detailQueueId, setDetailQueueId] = useState<string | null>(null);
    const [bulkBusy, setBulkBusy] = useState(false);
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

    const estNouvelle = (q: RegistryQueue) =>
        Date.now() - new Date(q.firstSeenAt).getTime() < JOURS_NOUVEAUTE * 86400000;
    // Plus de bandeau des renommages ici : il listait les 65 files renommées
    // à chaque visite, sans date ni ordre — l'onglet « Changements » les
    // raconte désormais chronologiquement, avec leur source.

    // Santé calculée côté client à partir de l'activité réelle des agents.
    const health = useMemo(() => {
        const map = new Map<string, ReturnType<typeof assessQueueHealth>>();
        queues.forEach((q) => map.set(q.id, assessQueueHealth(q)));
        return map;
    }, [queues]);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        return queues.filter((q) => {
            if (q.status !== (onglet === "archivees" ? "ARCHIVED" : "ACTIVE")) return false;
            if (healthFilter !== "ALL" && health.get(q.id)?.level !== healthFilter) return false;
            if (!term) return true;
            return (
                q.queueNumber.includes(term) ||
                q.currentName.toLowerCase().includes(term) ||
                (q.department ?? "").toLowerCase().includes(term) ||
                // Recherche par agent : retrouve les files où il est sollicité.
                q.agents.some((a) => a.name.toLowerCase().includes(term) || a.extension.includes(term))
            );
        });
    }, [queues, search, onglet, healthFilter, health]);

    const nbActives = useMemo(() => queues.filter((q) => q.status === "ACTIVE").length, [queues]);
    const nbArchivees = useMemo(() => queues.filter((q) => q.status === "ARCHIVED").length, [queues]);

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

    // Le journal balaie tous les appels : on ne le charge qu'à l'ouverture de
    // son onglet, et une seule fois.
    useEffect(() => {
        if (onglet !== "changements" || changements !== null) return;
        setChangements("chargement");
        fetch(`/api/admin/queues?server=${getSelectedServer()}&view=changelog`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((data) => setChangements(data.changements as Changement[]))
            .catch(() => setChangements("échec"));
    }, [onglet, changements]);

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
                    {/* « Masquer les files archivées » a quitté cet écran : ce
                        n'était pas un filtre de consultation mais un réglage qui
                        gouverne TOUTE l'application (cf. queues.service). Il vit
                        désormais dans Files d'attente > Réglage. */}
                    <Button onClick={runDiscovery} disabled={isDiscovering}>
                        {isDiscovering ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Découverte…</>
                        ) : (
                            <><RefreshCw className="mr-2 h-4 w-4" /> Découvrir les files</>
                        )}
                    </Button>
                </div>
            </div>

            {/* Trois onglets, avec leurs compteurs : sans eux, on ne sait pas ce
                qu'on ne voit pas. « Changements » plutôt que « Journal » — ce
                dernier mot désigne déjà le sous-menu voisin (XAPI). */}
            {queues.length > 0 && (
                <div className="flex gap-1 border-b border-slate-200">
                    {([
                        ["actives", `Actives (${nbActives})`],
                        ["archivees", `Archivées (${nbArchivees})`],
                        ["changements", "Changements"],
                    ] as const).map(([cle, libelle]) => (
                        <button
                            key={cle}
                            type="button"
                            onClick={() => setOnglet(cle)}
                            aria-current={onglet === cle ? "page" : undefined}
                            className={cn(
                                "-mb-px border-b-2 px-4 py-2 text-sm transition-colors",
                                onglet === cle
                                    ? "border-blue-600 font-medium text-blue-700"
                                    : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700",
                            )}
                        >
                            {libelle}
                        </button>
                    ))}
                </div>
            )}

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

            {onglet !== "changements" && queues.length > 0 && (
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Rechercher par numéro, nom, département ou collaborateur…"
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
                </div>
            )}

            {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <span className="text-sm font-medium text-blue-900">{selected.size} sélectionnée(s)</span>
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
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
                        Annuler
                    </Button>
                </div>
            )}

            {onglet !== "changements" && queues.length > 0 && (
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
                                        <th className="px-4 py-3 text-left font-medium text-slate-600">Département</th>
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
                                                {estNouvelle(q) && (
                                                    <Tip content={`Premier appel ${formatDistanceToNow(new Date(q.firstSeenAt), { addSuffix: true, locale: fr })} — le badge s'efface au bout de ${JOURS_NOUVEAUTE} jours.`}>
                                                        <Badge variant="outline" className="ml-2 border-blue-200 bg-blue-50 text-[10px] text-blue-700">
                                                            Nouvelle
                                                        </Badge>
                                                    </Tip>
                                                )}
                                                {/* Une file hors de tout périmètre n'apparaît nulle
                                                    part, pour personne — le périmètre gouverne aussi
                                                    les rôles globaux. Le badge le dit sur les DEUX
                                                    onglets, pour que les deux vues se lisent pareil.
                                                    La COULEUR, elle, dit la gravité : sur une file
                                                    active c'est un défaut à corriger (ambre) ; sur
                                                    une archivée c'est l'état attendu et rassurant
                                                    (neutre). Mesuré le 1er septembre 2026 :
                                                    30 files sans périmètre, toutes archivées. */}
                                                {q.perimeterCount === 0 && (
                                                    <Tip content={q.status === "ACTIVE"
                                                        ? "Cette file active n'est dans le périmètre d'aucun utilisateur : elle reçoit des appels que personne ne voit. Ajoutez-la depuis la fiche d'un utilisateur."
                                                        : "Cette file archivée n'est dans aucun périmètre — c'est l'état attendu."}>
                                                        <Badge variant="outline" className={cn(
                                                            "ml-2 text-[10px]",
                                                            q.status === "ACTIVE"
                                                                ? "border-amber-200 bg-amber-50 text-amber-700"
                                                                : "border-slate-200 bg-slate-50 text-slate-500",
                                                        )}>
                                                            Aucun périmètre
                                                        </Badge>
                                                    </Tip>
                                                )}
                                                {q.previousNames.length > 0 && (
                                                    <Tip content={`Ancien(s) nom(s) : ${q.previousNames.join(", ")}`}>
                                                        <span className="ml-2 text-xs text-blue-600">
                                                            (renommée)
                                                        </span>
                                                    </Tip>
                                                )}
                                                {/* Explique pourquoi la file remonte lors d'une recherche par agent */}
                                                {matchedAgents(q).length > 0 && (
                                                    <p className="mt-0.5 text-xs text-blue-600">
                                                        ↳ {matchedAgents(q).map((a) => `${a.name} (${a.extension})`).join(", ")}
                                                    </p>
                                                )}
                                            </td>
                                            {/* Le département REMPLACE les trois étiquettes
                                                Entité / Région / Service, qui étaient devinées en
                                                analysant le nom de la file puis figées. Il est
                                                déclaré par le 3CX, couvre 100 % des files actives
                                                (contre 98 % pour les étiquettes, et la lacune était
                                                justement une file au nouveau format de nommage).
                                                Volontairement NON modifiable : cette valeur n'est
                                                pas la nôtre. Si elle est fausse, elle se corrige au
                                                3CX, et l'application suit. */}
                                            <td className="px-4 py-2">
                                                <span className="text-xs text-slate-600">{q.department ?? "—"}</span>
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

            {onglet !== "changements" && queues.length > 0 && (
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

            {onglet === "changements" && <PanneauChangements etat={changements} />}
        </div>
    );
}

/** Une ligne du journal, mise en mots selon sa nature. */
function LigneChangement({ c }: { c: Changement }) {
    const date = new Date(c.date).toLocaleDateString("fr-CH", { day: "2-digit", month: "short", year: "numeric" });
    const teinte = c.type === "statut" ? "bg-amber-50 text-amber-700 border-amber-200"
        : c.type === "apparition" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : c.type === "departement" ? "bg-blue-50 text-blue-700 border-blue-200"
        : "bg-violet-50 text-violet-700 border-violet-200";
    const intitule = c.type === "statut" ? (c.apres === "ARCHIVED" ? "Archivée" : "Réactivée")
        : c.type === "apparition" ? "Apparition"
        : c.type === "departement" ? "Département"
        : "Renommage";
    return (
        <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-100 px-3 py-2.5 text-sm last:border-b-0">
            <span className="w-24 shrink-0 tabular-nums text-slate-500">{date}</span>
            <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", teinte)}>{intitule}</span>
            <span className="shrink-0 text-slate-500">{c.queueName}</span>
            <span className="min-w-0 flex-1 text-slate-700">
                {c.type === "renommage" && <>« {c.avant} » → <span className="font-medium">« {c.apres} »</span></>}
                {c.type === "departement" && <>{c.avant ?? "aucun"} → <span className="font-medium">{c.apres ?? "aucun"}</span></>}
                {c.type === "apparition" && <>premier appel reçu sous « {c.apres} »</>}
                {c.type === "statut" && <>{c.par ? `par ${c.par}` : "auteur inconnu"}</>}
            </span>
            {/* La source est dite : un journal qui tait ses angles morts ment
                par omission. */}
            <span className="shrink-0 text-xs text-slate-400">
                {c.source === "appels" ? "d'après les appels" : c.source === "xapi" ? "relevé XAPI" : "action dans l'app"}
            </span>
        </li>
    );
}

function PanneauChangements({ etat }: { etat: Changement[] | "chargement" | "échec" | null }) {
    if (etat === "chargement" || etat === null) {
        return (
            <Card><CardContent className="py-10"><Attente libelle="Reconstitution des changements…" /></CardContent></Card>
        );
    }
    if (etat === "échec") {
        return (
            <Card><CardContent className="py-8 text-sm text-red-700">
                Le journal n&apos;a pas pu être reconstitué.
            </CardContent></Card>
        );
    }
    return (
        <div className="space-y-3">
            {/* Ce que ce journal SAIT et ne sait pas — écrit une fois, à
                l'endroit où la question se pose. */}
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                Les <strong>renommages</strong> et les <strong>apparitions</strong> sont reconstitués depuis les appels :
                ils remontent à l&apos;origine des données, au jour près. Les <strong>changements de département</strong>
                viennent du relevé XAPI, qui date ses mouvements depuis le 25 août 2026. Les <strong>archivages</strong>
                ne laissent aucune trace ailleurs que dans l&apos;application : ils sont enregistrés depuis le
                1er septembre 2026, et rien ne peut être reconstitué avant cette date.
            </p>
            {etat.length === 0 ? (
                <Card><CardContent className="py-8 text-center text-sm text-slate-500">
                    Aucun changement enregistré.
                </CardContent></Card>
            ) : (
                <ul className="rounded-lg border border-slate-200 bg-white">
                    {etat.map((c, i) => <LigneChangement key={`${c.date}-${c.queueNumber}-${i}`} c={c} />)}
                </ul>
            )}
        </div>
    );
}
