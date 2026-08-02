"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { QueueAgentPicker } from "@/components/queue-agent-picker";
import { getScopedQueueOptions } from "@/services/queues.service";
import { getSelectedServer } from "@/lib/selected-server";
import type { QueueInfo } from "@/types/queues.types";

/**
 * Recherche globale de groupe — un outil de NAVIGATION, pas un filtre.
 *
 * Le champ reflète l'écran courant : vide sur le tableau de bord (c'est le
 * point de départ des recherches), le groupe consulté sur sa statistique, la
 * file consultée sur les journaux. Sélectionner un groupe ouvre TOUJOURS sa
 * statistique, d'où qu'on soit — période et provenance conservées. On
 * n'« efface » jamais : on navigue (les journaux gardent leur bouton « Vue
 * entreprise » pour sortir de la vue file).
 */

/** Écrans où l'URL porte une file consultée, que le champ doit refléter. */
const QUEUE_AWARE_PATHS = ["/statistics-v2", "/admin/logs"];

export function HeaderQueueSearch() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [queues, setQueues] = useState<QueueInfo[]>([]);

    useEffect(() => {
        // L'annuaire est déjà en cache côté serveur (stale-while-revalidate) :
        // la liste arrive vite et n'a pas besoin d'être rechargée par écran.
        getScopedQueueOptions(getSelectedServer())
            .then((options) => setQueues(options.queues))
            .catch(() => undefined);
    }, []);

    const displayedQueue = QUEUE_AWARE_PATHS.some((p) => pathname.startsWith(p))
        ? searchParams.get("queue")
        : null;

    const openQueueStats = (queueNumber: string) => {
        const params = new URLSearchParams();
        // Seul le contexte de consultation voyage ; les filtres propres à un
        // écran (colonnes des journaux…) restent où ils sont.
        for (const key of ["start", "end", "origin"]) {
            const value = searchParams.get(key);
            if (value) params.set(key, value);
        }
        params.set("queue", queueNumber);
        router.push(`/statistics-v2?${params.toString()}`);
    };

    return (
        <div className="w-64">
            <QueueAgentPicker
                queues={queues}
                show="queues"
                selectedQueueNumber={displayedQueue}
                onSelect={(item) => openQueueStats(item.queueNumber)}
                placeholder="Rechercher un groupe…"
                size="compact"
            />
        </div>
    );
}
