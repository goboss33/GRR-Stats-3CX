"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { AlertCircle, Building2, Eye, EyeOff, Flag, Loader2, RefreshCw, Search, Tag, Users, Workflow } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { EnTeteTri, MenuFiltre, PucesDeFiltres, basculerDansSet as basculer } from "@/components/tableau-filtrable";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getSelectedServer } from "@/lib/selected-server";
import { QueueDetailDialog } from "@/components/queue-detail-dialog";
import { Attente } from "@/components/ui/etat-chargement";
import type { Changement } from "@/services/queue-changelog.service";
import { QueueFlowModal } from "@/components/settings/queue-flow-modal";
import { assessQueueHealth, type HealthLevel } from "@/services/domain/queue-health";
import {
    SENS_INITIAL,
    TRI_PAR_DEFAUT,
    trierFiles,
    type ColonneTri,
} from "@/services/domain/queue-sort";
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
    /** Dernier renommage daté par les appels, et le nom porté avant. */
    lastRename: { date: string; avant: string } | null;
    /** Le 3CX ne déclare plus cette file — faux si la surcouche est éteinte. */
    absenteDuPbx: boolean;
    lastCallAt: string | null;
    agents: { extension: string; name: string; attempts: number; lastSeenAt: string }[];
    lastSeenAt: string;
    previousNames: string[];
}

/**
 * Style commun aux boutons d'action d'une ligne.
 *
 * Les deux se ressemblaient de loin sans être identiques : l'un bordé et
 * opaque, l'autre fantôme, pâle et bleuté au survol. Deux boutons voisins qui
 * font la même sorte de chose doivent se ressembler exactement — sinon la
 * différence se lit comme une intention.
 */
const BOUTON_ACTION = "h-8 w-8 p-0 border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-sky-600";

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

/** L'âge fait la nouveauté ; le même délai efface le badge « Renommée ». */
const estNouvelle = (q: RegistryQueue) =>
    Date.now() - new Date(q.firstSeenAt).getTime() < JOURS_NOUVEAUTE * 86400000;
const estRenommeeRecemment = (q: RegistryQueue) =>
    !!q.lastRename && Date.now() - new Date(q.lastRename.date).getTime() < JOURS_NOUVEAUTE * 86400000;

/** Sentinelle des files sans département, pour qu'elles restent cochables. */
const SANS_DEPARTEMENT = "\u0000sans";

/**
 * Les signalements filtrables.
 *
 * Ce sont exactement les badges affichés dans le tableau, plus l'absence de
 * collaborateur que montre déjà la colonne du même nom : on filtre avec les
 * mots qu'on lit sur les lignes.
 */
const SIGNAUX = {
    nouvelle: { libelle: "Nouvelle", test: estNouvelle },
    renommee: { libelle: "Renommée", test: estRenommeeRecemment },
    sansPerimetre: { libelle: "Aucun périmètre", test: (q: RegistryQueue) => q.perimeterCount === 0 },
    sansCollaborateur: { libelle: "Sans collaborateur", test: (q: RegistryQueue) => q.agentCount === 0 },
    absenteDuPbx: { libelle: "Absente du 3CX", test: (q: RegistryQueue) => q.absenteDuPbx },
} as const;
type Signal = keyof typeof SIGNAUX;

const LIBELLES_SANTE: Record<HealthLevel, string> = {
    critical: "Problème",
    warning: "À surveiller",
    ok: "OK",
};

/** Coche ou décoche une valeur dans un filtre. */
// Les en-têtes triables, les menus à cocher et les puces viennent de la
// charpente partagée (components/tableau-filtrable) : le tableau des
// collaborateurs est bâti sur le même code, les deux ne peuvent plus diverger.

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
    const [filtreDept, setFiltreDept] = useState<Set<string>>(new Set());
    const [filtreSante, setFiltreSante] = useState<Set<string>>(new Set());
    const [filtreSignal, setFiltreSignal] = useState<Set<string>>(new Set());
    const [tri, setTri] = useState(TRI_PAR_DEFAUT);
    // null tant que le serveur n'a pas répondu : l'interrupteur ne prétend pas
    // connaître une valeur qu'il n'a pas encore lue.
    const [masquerArchivees, setMasquerArchivees] = useState<boolean | null>(null);
    // Numéro et nom voyagent avec l'identifiant : la fiche peut ainsi
    // s'annoncer dès l'ouverture, sans attendre sa requête (cf. flowQueue).
    const [detailQueue, setDetailQueue] = useState<{ id: string; number: string; name: string } | null>(null);
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

    useEffect(() => {
        fetch("/api/admin/settings")
            .then((r) => (r.ok ? r.json() : {}) as Promise<Record<string, unknown>>)
            .then((d) => setMasquerArchivees(d.hideArchivedQueues === true))
            .catch(() => setMasquerArchivees(null));
    }, []);

    /**
     * Masquage global des files archivées — bascule optimiste.
     *
     * Ce réglage gouverne TOUTE l'application, pas seulement cet écran : il
     * retire les files archivées de la barre latérale, de la recherche et de
     * l'aperçu des groupes, pour tout le monde. Il vit ici parce que c'est ici
     * qu'on archive : séparer le geste de sa conséquence obligeait à changer
     * d'écran pour comprendre ce qu'on venait de faire.
     */
    const enregistrerMasquage = async (valeur: boolean) => {
        const precedent = masquerArchivees;
        setMasquerArchivees(valeur);
        try {
            const res = await fetch("/api/admin/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ hideArchivedQueues: valeur }),
            });
            if (!res.ok) throw new Error();
            toast.success(valeur
                ? "Les files archivées sont masquées des listes"
                : "Les files archivées réapparaissent dans les listes");
        } catch {
            setMasquerArchivees(precedent);
            toast.error("Enregistrement impossible");
        }
    };


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

    // Plus de bandeau des renommages ici : il listait les 65 files renommées
    // à chaque visite, sans date ni ordre — l'onglet « Changements » les
    // raconte désormais chronologiquement, avec leur source.

    // Santé calculée côté client à partir de l'activité réelle des agents.
    const health = useMemo(() => {
        const map = new Map<string, ReturnType<typeof assessQueueHealth>>();
        queues.forEach((q) => map.set(q.id, assessQueueHealth(q)));
        return map;
    }, [queues]);

    const niveau = useCallback((q: RegistryQueue) => health.get(q.id)?.level ?? "ok", [health]);

    /**
     * Les cinq cribles, tenus séparés à dessein : chaque menu doit pouvoir
     * appliquer tous les autres SAUF le sien pour établir ses comptes.
     */
    const cribles = useMemo(() => {
        const term = search.trim().toLowerCase();
        return {
            onglet: (q: RegistryQueue) => q.status === (onglet === "archivees" ? "ARCHIVED" : "ACTIVE"),
            recherche: (q: RegistryQueue) =>
                !term ||
                q.queueNumber.includes(term) ||
                q.currentName.toLowerCase().includes(term) ||
                (q.department ?? "").toLowerCase().includes(term) ||
                // Recherche par agent : retrouve les files où il est sollicité.
                q.agents.some((a) => a.name.toLowerCase().includes(term) || a.extension.includes(term)),
            departement: (q: RegistryQueue) =>
                filtreDept.size === 0 || filtreDept.has(q.department ?? SANS_DEPARTEMENT),
            sante: (q: RegistryQueue) => filtreSante.size === 0 || filtreSante.has(niveau(q)),
            // Plusieurs signalements cochés se lisent « ou » : on cherche tout
            // ce qui est signalé, pas ce qui cumule les défauts.
            signal: (q: RegistryQueue) =>
                filtreSignal.size === 0 || [...filtreSignal].some((k) => SIGNAUX[k as Signal].test(q)),
        };
    }, [search, onglet, filtreDept, filtreSante, filtreSignal, niveau]);

    // Assiette des comptes de chaque menu : tous les cribles, sauf le sien.
    const baseDept = useMemo(
        () => queues.filter((q) => cribles.onglet(q) && cribles.recherche(q) && cribles.sante(q) && cribles.signal(q)),
        [queues, cribles],
    );
    const baseSante = useMemo(
        () => queues.filter((q) => cribles.onglet(q) && cribles.recherche(q) && cribles.departement(q) && cribles.signal(q)),
        [queues, cribles],
    );
    const baseSignal = useMemo(
        () => queues.filter((q) => cribles.onglet(q) && cribles.recherche(q) && cribles.departement(q) && cribles.sante(q)),
        [queues, cribles],
    );

    const optionsDept = useMemo(() => {
        const comptes = new Map<string, number>();
        for (const q of baseDept) {
            const cle = q.department ?? SANS_DEPARTEMENT;
            comptes.set(cle, (comptes.get(cle) ?? 0) + 1);
        }
        // Les départements les plus fournis en tête : c'est là qu'on va.
        // Mesuré le 1er septembre 2026 : 38 des 61 files actives sont en
        // GRR GENEVE, et six départements n'en portent qu'une seule.
        return [...comptes.entries()]
            .map(([valeur, compte]) => ({
                valeur,
                libelle: valeur === SANS_DEPARTEMENT ? "Sans département" : valeur,
                compte,
            }))
            .sort((a, b) => b.compte - a.compte || a.libelle.localeCompare(b.libelle, "fr"));
    }, [baseDept]);

    const optionsSante = useMemo(
        () =>
            (["critical", "warning", "ok"] as HealthLevel[]).map((n) => ({
                valeur: n,
                libelle: LIBELLES_SANTE[n],
                compte: baseSante.filter((q) => niveau(q) === n).length,
            })),
        [baseSante, niveau],
    );

    const optionsSignal = useMemo(
        () =>
            (Object.keys(SIGNAUX) as Signal[]).map((k) => ({
                valeur: k,
                libelle: SIGNAUX[k].libelle,
                compte: baseSignal.filter(SIGNAUX[k].test).length,
            })),
        [baseSignal],
    );

    const filtered = useMemo(() => {
        const retenues = queues.filter(
            (q) =>
                cribles.onglet(q) &&
                cribles.recherche(q) &&
                cribles.departement(q) &&
                cribles.sante(q) &&
                cribles.signal(q),
        );
        return trierFiles(retenues, tri, niveau);
    }, [queues, cribles, tri, niveau]);

    /** Un clic trie, un second inverse ; changer de colonne repart du sens utile. */
    const trierPar = (colonne: ColonneTri) =>
        setTri((t) =>
            t.colonne === colonne
                ? { colonne, sens: t.sens === "asc" ? "desc" : "asc" }
                : { colonne, sens: SENS_INITIAL[colonne] },
        );

    const puces = useMemo(
        () => [
            ...[...filtreDept].map((v) => ({
                cle: `d:${v}`,
                libelle: v === SANS_DEPARTEMENT ? "Sans département" : v,
                retirer: () => basculer(setFiltreDept, v),
            })),
            ...[...filtreSante].map((v) => ({
                cle: `s:${v}`,
                libelle: LIBELLES_SANTE[v as HealthLevel],
                retirer: () => basculer(setFiltreSante, v),
            })),
            ...[...filtreSignal].map((v) => ({
                cle: `g:${v}`,
                libelle: SIGNAUX[v as Signal].libelle,
                retirer: () => basculer(setFiltreSignal, v),
            })),
        ],
        [filtreDept, filtreSante, filtreSignal],
    );

    const aDesFiltres = puces.length > 0 || search.trim() !== "";
    const toutEffacer = () => {
        setSearch("");
        setFiltreDept(new Set());
        setFiltreSante(new Set());
        setFiltreSignal(new Set());
    };

    const nbActives = useMemo(() => queues.filter((q) => q.status === "ACTIVE").length, [queues]);
    const nbArchivees = useMemo(() => queues.filter((q) => q.status === "ARCHIVED").length, [queues]);

    /** Agents correspondant à la recherche, pour expliquer pourquoi une file remonte. */
    const matchedAgents = (q: RegistryQueue) => {
        const term = search.trim().toLowerCase();
        if (!term) return [];
        return q.agents.filter((a) => a.name.toLowerCase().includes(term) || a.extension.includes(term));
    };

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
                    {/* Les étiquettes Entité / Région / Service ont quitté cet
                        écran au profit du département déclaré par le 3CX : le
                        sous-titre ne pouvait plus les annoncer. */}
                    <p className="text-sm text-slate-500">
                        {queues.length} file(s) découverte(s) dans l&apos;historique des appels
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                    <Tip content="Retire les files archivées de la barre latérale, de la recherche et de l'aperçu des groupes, pour tous les utilisateurs. Périmètres, statistiques passées et journaux restent intacts.">
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                            <Switch
                                checked={masquerArchivees === true}
                                disabled={masquerArchivees === null}
                                onCheckedChange={enregistrerMasquage}
                            />
                            Masquer les archivées partout
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
                <div className="space-y-3">
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
                        <MenuFiltre
                            libelle="Département"
                            icone={Building2}
                            options={optionsDept}
                            selection={filtreDept}
                            onBasculer={(v) => basculer(setFiltreDept, v)}
                        />
                        <MenuFiltre
                            libelle="État"
                            icone={AlertCircle}
                            options={optionsSante}
                            selection={filtreSante}
                            onBasculer={(v) => basculer(setFiltreSante, v)}
                        />
                        <MenuFiltre
                            libelle="Signalements"
                            icone={Flag}
                            options={optionsSignal}
                            selection={filtreSignal}
                            onBasculer={(v) => basculer(setFiltreSignal, v)}
                        />
                    </div>

                    {/* Ce qui est filtré doit se lire sans ouvrir les menus, et
                        se défaire d'un clic. Le compte dit ce qu'on ne voit
                        pas : un tableau tronqué en silence se lit comme un
                        tableau complet. */}
                    {aDesFiltres && (
                        <PucesDeFiltres
                            puces={puces}
                            affichees={filtered.length}
                            total={onglet === "archivees" ? nbArchivees : nbActives}
                            unite="file(s)"
                            onToutEffacer={toutEffacer}
                        />
                    )}
                </div>
            )}

            {onglet !== "changements" && queues.length > 0 && (
                <Card>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="border-b bg-slate-50">
                                    <tr>
                                        <EnTeteTri colonne="sante" libelle="État" tri={tri} onTrier={trierPar} className="w-20 px-2 text-center" />
                                        <EnTeteTri colonne="numero" libelle="N°" tri={tri} onTrier={trierPar} />
                                        <EnTeteTri colonne="nom" libelle="Nom actuel" tri={tri} onTrier={trierPar} />
                                        <EnTeteTri colonne="departement" libelle="Département" tri={tri} onTrier={trierPar} />
                                        <EnTeteTri colonne="agents" libelle="Collaborateurs" tri={tri} onTrier={trierPar} />
                                        <EnTeteTri colonne="dernierAppel" libelle="Dernier appel" tri={tri} onTrier={trierPar} />
                                        {/* Statut et actions ne se trient pas : chaque onglet ne
                                            montre qu'un statut, et une colonne de boutons n'a pas
                                            d'ordre. */}
                                        <th className="px-4 py-3 text-left font-medium text-slate-600">Statut</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {filtered.map((q) => (
                                        <tr
                                            key={q.id}
                                            onClick={() => setDetailQueue({ id: q.id, number: q.queueNumber, name: q.currentName })}
                                            className={cn(
                                                "cursor-pointer hover:bg-slate-50",
                                                q.status === "ARCHIVED" && "opacity-60",
                                            )}
                                            title="Voir le détail (collaborateurs, historique)"
                                        >
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
                                                {/* Le PBX ne déclare plus cette file : elle a été
                                                    supprimée du 3CX, ses appels restent dans
                                                    l'historique. Rouge parce qu'il y a quelque chose
                                                    à faire — mais c'est VOUS qui archivez : un relevé
                                                    incomplet archiverait sinon des dizaines de files
                                                    d'un coup. Le badge est muet tant que la surcouche
                                                    XAPI est éteinte : on ne signale pas une absence
                                                    qu'on n'a pas les moyens de constater. */}
                                                {q.absenteDuPbx && (
                                                    <Tip content={q.status === "ACTIVE"
                                                        ? "Le 3CX ne déclare plus cette file : elle y a probablement été supprimée. Ses appels passés restent consultables. Archivez-la si c'est bien le cas."
                                                        : "Le 3CX ne déclare plus cette file — cohérent avec son archivage."}>
                                                        <Badge variant="outline" className="ml-2 border-red-200 bg-red-50 text-[10px] text-red-700">
                                                            Absente du 3CX
                                                        </Badge>
                                                    </Tip>
                                                )}
                                                {/* « Renommée » suit la même règle que « Nouvelle » :
                                                    un badge qui s'efface passé le délai. L'étiquette
                                                    d'avant restait allumée pour toujours — 65 files
                                                    sur 94 la portaient en permanence, elle ne
                                                    signalait donc plus rien. La date vient des
                                                    appels, la seule source qui la connaisse. */}
                                                {estRenommeeRecemment(q) && (
                                                    <Tip content={`Renommée ${formatDistanceToNow(new Date(q.lastRename!.date), { addSuffix: true, locale: fr })} — s'appelait « ${q.lastRename!.avant} ». Le badge s'efface au bout de ${JOURS_NOUVEAUTE} jours ; vérifiez que les périmètres restent corrects.`}>
                                                        <Badge variant="outline" className="ml-2 border-violet-200 bg-violet-50 text-[10px] text-violet-700">
                                                            Renommée
                                                        </Badge>
                                                    </Tip>
                                                )}
                                                {/* Les anciens noms restent consultables au-delà du
                                                    délai, sans crier : c'est ce qu'on cherche quand
                                                    on regarde une file précise. */}
                                                {!estRenommeeRecemment(q) && q.previousNames.length > 0 && (
                                                    <Tip content={`Ancien(s) nom(s) : ${q.previousNames.join(", ")}`}>
                                                        <span className="ml-2 cursor-help text-xs text-slate-400">(renommée)</span>
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
                                                <Tip content="Parcours d'appel">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        aria-label="Parcours d'appel"
                                                        onClick={() => setFlowQueue({ number: q.queueNumber, name: q.currentName })}
                                                        className={BOUTON_ACTION}
                                                    >
                                                        <Workflow className="h-4 w-4" />
                                                    </Button>
                                                </Tip>
                                                {/* Deux états seulement : un bouton qui bascule vaut
                                                    mieux qu'une liste déroulante à deux entrées —
                                                    un clic au lieu de deux, et l'action est écrite
                                                    en toutes lettres au lieu d'être devinée.
                                                    L'œil barré / ouvert reprend la convention des
                                                    alertes : sur un bouton d'ACTION, l'icône montre
                                                    ce qui va se passer, pas l'état actuel. D'où
                                                    l'absence de fond coloré, qui se lirait comme un
                                                    statut. */}
                                                <Tip content={q.status === "ACTIVE" ? "Archiver" : "Réactiver"}>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className={BOUTON_ACTION}
                                                        aria-label={q.status === "ACTIVE" ? "Archiver" : "Réactiver"}
                                                        onClick={() => patchQueue(q.id, {
                                                            status: q.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE",
                                                        })}
                                                    >
                                                        {q.status === "ACTIVE"
                                                            ? <EyeOff className="h-4 w-4" />
                                                            : <Eye className="h-4 w-4" />}
                                                    </Button>
                                                </Tip>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {filtered.length === 0 && (
                                        <tr>
                                            <td colSpan={7} className="py-8 text-center text-slate-500">
                                                Aucune file ne correspond à ces critères
                                                {aDesFiltres && (
                                                    <button
                                                        type="button"
                                                        onClick={toutEffacer}
                                                        className="ml-2 text-blue-600 underline underline-offset-2 hover:text-blue-800"
                                                    >
                                                        Tout effacer
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            )}

            <QueueFlowModal
                queueNumber={flowQueue?.number ?? null}
                queueName={flowQueue?.name ?? ""}
                onClose={() => setFlowQueue(null)}
            />
            <QueueDetailDialog
                queueId={detailQueue?.id ?? null}
                queueNumber={detailQueue?.number ?? ""}
                queueName={detailQueue?.name ?? ""}
                serverId={getSelectedServer()}
                open={!!detailQueue}
                onOpenChange={(open) => !open && setDetailQueue(null)}
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
