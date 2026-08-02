"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Star } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { getSelectedServer } from "@/lib/selected-server";
import { getScopedQueueOptions } from "@/services/queues.service";
import { getQueueFavorites, toggleQueueFavorite } from "@/services/queue-favorites.service";
import type { QueueInfo } from "@/types/queues.types";

/**
 * Sous-menu « Mes équipes » : les files du périmètre, favorites épinglées en
 * tête. L'étoile (au survol) épingle sans naviguer ; cliquer la ligne ouvre la
 * statistique de l'équipe, période et provenance conservées. La liste défile
 * dans sa propre zone — un périmètre d'administrateur (~85 files) ne doit pas
 * engloutir la barre latérale, et la vraie recherche vit dans le header.
 */
export function SidebarTeams() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [queues, setQueues] = useState<QueueInfo[]>([]);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());

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

    const { pinned, rest } = useMemo(() => {
        const byNumber = [...queues].sort((a, b) =>
            a.queueNumber.localeCompare(b.queueNumber, undefined, { numeric: true }));
        return {
            pinned: byNumber.filter((q) => favorites.has(q.queueNumber)),
            rest: byNumber.filter((q) => !favorites.has(q.queueNumber)),
        };
    }, [queues, favorites]);

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
                <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); onToggleFavorite(q.queueNumber); }}
                    title={isFavorite ? "Retirer des favoris" : "Épingler en favori"}
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
            </div>
        );
    };

    return (
        <div className="ml-4 mt-1 min-h-0 overflow-y-auto border-l border-slate-800 pl-2 [scrollbar-width:thin] [scrollbar-color:#334155_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700 hover:[&::-webkit-scrollbar-thumb]:bg-slate-600">
            <div className="divide-y divide-slate-800/60">
                {pinned.map(renderTeam)}
            </div>
            {pinned.length > 0 && rest.length > 0 && <div className="mx-1 my-1.5 border-t-2 border-slate-700/80" />}
            <div className="divide-y divide-slate-800/60">
                {rest.map(renderTeam)}
            </div>
        </div>
    );
}
