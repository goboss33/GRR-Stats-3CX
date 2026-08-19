"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Star } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";
import { getSelectedServer } from "@/lib/selected-server";
import { getScopedQueueOptions } from "@/services/queues.service";
import { getQueueFavorites, toggleQueueFavorite } from "@/services/queue-favorites.service";
import type { QueueInfo } from "@/types/queues.types";

/**
 * Sous-menu « Mes équipes » : favorites épinglées en tête, puis les files du
 * périmètre groupées par DÉPARTEMENT 3CX — départements et équipes en ordre
 * alphabétique, « Sans département » en dernier. Les groupes sont REPLIÉS par
 * défaut (état mémorisé par navigateur) : c'est ce qui remplace l'ancien
 * « Afficher tout (N) » — un périmètre d'administrateur (~85 files) tient en
 * une vingtaine de lignes d'en-têtes. Le département de l'équipe CONSULTÉE
 * s'affiche toujours ouvert : l'écran ouvert doit être surligné quelque part.
 *
 * L'étoile (au survol) épingle sans naviguer ; cliquer la ligne ouvre la
 * statistique de l'équipe, période et provenance conservées.
 */

/** Clé et libellé du groupe des files sans département 3CX. */
const NO_DEPT_KEY = "__none__";
const NO_DEPT_LABEL = "Sans département";
/** Départements dépliés manuellement (mémorisés par navigateur). */
const OPEN_DEPTS_STORAGE_KEY = "sidebar-open-departments";

const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });

export function SidebarTeams() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [queues, setQueues] = useState<QueueInfo[]>([]);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    // Repliés par défaut ; la préférence est relue au montage seulement (pas
    // au rendu serveur, qui ne connaît pas localStorage).
    const [openDepts, setOpenDepts] = useState<Set<string>>(new Set());

    useEffect(() => {
        try {
            const raw = localStorage.getItem(OPEN_DEPTS_STORAGE_KEY);
            if (raw) setOpenDepts(new Set(JSON.parse(raw) as string[]));
        } catch {
            // Préférence illisible : on repart tout replié.
        }
    }, []);

    useEffect(() => {
        const serverId = getSelectedServer();
        getScopedQueueOptions(serverId)
            .then((options) => setQueues(options.queues))
            .catch(() => undefined);
        getQueueFavorites(serverId)
            .then((list) => setFavorites(new Set(list)))
            .catch(() => undefined);
    }, []);

    const activeQueue = pathname.startsWith("/statistics-v2") ? searchParams.get("queue") : null;

    const { pinned, groups } = useMemo(() => {
        const byName = [...queues].sort((a, b) => collator.compare(a.queueName, b.queueName));
        const pinned = byName.filter((q) => favorites.has(q.queueNumber));
        const rest = byName.filter((q) => !favorites.has(q.queueNumber));

        const byDept = new Map<string, { key: string; label: string; items: QueueInfo[] }>();
        for (const q of rest) {
            const dept = q.queueDepartment?.trim();
            const key = dept ? dept : NO_DEPT_KEY;
            const group = byDept.get(key) ?? { key, label: dept || NO_DEPT_LABEL, items: [] };
            group.items.push(q);
            byDept.set(key, group);
        }
        const groups = [...byDept.values()].sort((a, b) => {
            if (a.key === NO_DEPT_KEY) return 1;
            if (b.key === NO_DEPT_KEY) return -1;
            return collator.compare(a.label, b.label);
        });
        return { pinned, groups };
    }, [queues, favorites]);

    // Bascule d'un département, mémorisée. Le « visuallyOpen » compte : un
    // groupe peut être ouvert par l'équipe active sans figurer dans l'état.
    const toggleDept = (key: string, visuallyOpen: boolean) => {
        setOpenDepts((prev) => {
            const next = new Set(prev);
            if (visuallyOpen) next.delete(key);
            else next.add(key);
            try {
                localStorage.setItem(OPEN_DEPTS_STORAGE_KEY, JSON.stringify([...next]));
            } catch {
                // Stockage indisponible (mode privé) : la bascule reste pour la session.
            }
            return next;
        });
    };

    // Le lien porte le contexte de consultation courant (période, provenance).
    const teamHref = (queueNumber: string) => {
        const params = new URLSearchParams();
        for (const key of ["start", "end", "origin"]) {
            const value = searchParams.get(key);
            if (value) params.set(key, value);
        }
        params.set("queue", queueNumber);
        return `/statistics-v2?${params.toString()}`;
    };

    // Bascule optimiste : l'étoile répond immédiatement, l'erreur rétablit.
    const onToggleFavorite = (queueNumber: string) => {
        const next = new Set(favorites);
        const adding = !next.has(queueNumber);
        if (adding) next.add(queueNumber);
        else next.delete(queueNumber);
        setFavorites(next);
        toggleQueueFavorite(getSelectedServer(), queueNumber).catch(() => {
            setFavorites(favorites);
            toast.error("Impossible d'enregistrer le favori");
        });
    };

    if (queues.length === 0) return null;

    const renderTeam = (q: QueueInfo) => {
        const isFavorite = favorites.has(q.queueNumber);
        const isActive = activeQueue === q.queueNumber;
        return (
            <div
                key={q.queueNumber}
                className={cn(
                    "group flex items-center gap-1 pl-2 pr-1",
                    isActive ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white",
                )}
            >
                {/* Nom complet, sur plusieurs lignes si besoin : le
                    discriminant est souvent en fin de nom, on ne coupe rien. */}
                <Link
                    href={teamHref(q.queueNumber)}
                    className="min-w-0 flex-1 py-2 text-[13px] leading-snug"
                    title={`${q.queueNumber} · ${q.queueName}`}
                >
                    {q.queueName}
                </Link>
                <Tip content={isFavorite ? "Retirer des favoris" : "Épingler en favori"} side="right">
                <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); onToggleFavorite(q.queueNumber); }}
                    className={cn(
                        "shrink-0 rounded p-1 transition-opacity",
                        isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                >
                    <Star
                        className={cn(
                            "h-3.5 w-3.5",
                            isFavorite ? "fill-amber-400 text-amber-400" : "text-slate-500 hover:text-amber-400",
                        )}
                    />
                </button>
                </Tip>
            </div>
        );
    };

    return (
        <div className="ml-4 mt-1 min-h-0 overflow-y-auto border-l border-slate-800 pl-2 [scrollbar-width:thin] [scrollbar-color:#334155_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700 hover:[&::-webkit-scrollbar-thumb]:bg-slate-600">
            <div className="divide-y divide-slate-800/60">
                {pinned.map(renderTeam)}
            </div>
            {pinned.length > 0 && groups.length > 0 && <div className="mx-1 my-1.5 border-t-2 border-slate-700/80" />}
            {groups.map((group) => {
                // Ouvert si déplié par l'utilisateur OU si l'équipe consultée y
                // vit — l'écran ouvert doit être surligné quelque part.
                const isOpen = openDepts.has(group.key)
                    || group.items.some((q) => q.queueNumber === activeQueue);
                return (
                    <div key={group.key}>
                        {/* Chevron à GAUCHE (le signe universel du nœud
                            dépliable) ; les équipes s'indentent sous un rail
                            vertical aligné sur lui — la filiation se lit sans
                            avoir à comparer les typographies. */}
                        <button
                            type="button"
                            onClick={() => toggleDept(group.key, isOpen)}
                            title={group.label}
                            className="flex w-full items-center gap-1 py-1.5 pl-1 pr-1 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500 transition-colors hover:text-slate-300"
                        >
                            {isOpen
                                ? <ChevronDown className="h-3 w-3 shrink-0" />
                                : <ChevronRight className="h-3 w-3 shrink-0" />}
                            <span className="min-w-0 flex-1 truncate">{group.label}</span>
                            <span className="shrink-0 font-normal normal-case tracking-normal text-slate-600">
                                {group.items.length}
                            </span>
                        </button>
                        {isOpen && (
                            <div className="ml-2.5 border-l border-slate-800 pl-1.5">
                                <div className="divide-y divide-slate-800/60">
                                    {group.items.map(renderTeam)}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
