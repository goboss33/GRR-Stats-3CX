"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { QueueAgentPicker } from "@/components/queue-agent-picker";
import { getScopedQueueOptions } from "@/services/queues.service";
import { getSelectedServer } from "@/lib/selected-server";
import type { QueueInfo } from "@/types/queues.types";

/**
 * Recherche globale de groupe — elle choisit l'équipe CONSULTÉE sur l'écran
 * courant.
 *
 * Sur les statistiques comme sur les journaux, sélectionner change la vue en
 * place (un agent amène sur la vue de son groupe) ; seul le tableau de bord
 * navigue — vers la statistique du groupe — puisqu'il n'a pas de vue par
 * équipe. Période et provenance sont conservées dans tous les cas. On
 * n'« efface » jamais depuis ce champ : revenir à la vue entreprise des
 * journaux passe par la croix de la pastille « Vue : groupe X », qui n'existe
 * que pour ceux qui y ont droit.
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

    const selectQueue = (queueNumber: string) => {
        // Sur les journaux : la sélection règle la VUE en place (?queue=),
        // sans navigation — l'écran réagit au changement d'URL.
        if (pathname.startsWith("/admin/logs")) {
            const params = new URLSearchParams(searchParams.toString());
            params.set("queue", queueNumber);
            // Superficiel : changer de vue est un changement d'état de la
            // page, les données suivent par action serveur (cf. lib/url-state).
            window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
            return;
        }
        // Ailleurs : navigation vers la statistique du groupe. Seul le
        // contexte de consultation voyage ; les filtres propres à un écran
        // restent où ils sont.
        const params = new URLSearchParams();
        for (const key of ["start", "end", "origin"]) {
            const value = searchParams.get(key);
            if (value) params.set(key, value);
        }
        params.set("queue", queueNumber);
        router.push(`/statistics-v2?${params.toString()}`);
    };

    return (
        <div className="w-[26rem]">
            {/* show="both" : chercher un AGENT mène à son groupe — chaque
                entrée du picker porte le queueNumber de rattachement, agent
                compris. */}
            <QueueAgentPicker
                queues={queues}
                show="both"
                selectedQueueNumber={displayedQueue}
                onSelect={(item) => selectQueue(item.queueNumber)}
                placeholder="Rechercher un groupe ou un agent…"
                size="compact"
                inputClassName="h-10"
            />
        </div>
    );
}
