"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import type { QueueKPIs } from "@/types/statistics.types";
import type { InboundSource } from "@/services/domain/call.types";
import type { CallOrigin } from "@/services/domain/call-classification";
import { computeTeamTotals } from "@/services/domain/team-totals";
import { lienJournauxProvenance, replierProvenances } from "@/services/domain/provenance-appels";
import { GRILLE_ECHANGE, IconeEquipe, LigneEchange } from "@/components/stats-v2/ligne-echange";
import { TEXTE_PROVENANCE } from "@/services/domain/visite-guidee";

interface ProvenanceAppelsProps {
    kpis: QueueKPIs;
    /** Droit « Voir les logs » : sans lui, les barres ne sont pas des liens. */
    logsEnabled: boolean;
    queueNumber: string;
    startDate: string;
    endDate: string;
    /** Provenance affichée (contexte global du header) — voyage avec les liens. */
    origin: CallOrigin;
}

/**
 * « D'où viennent nos appels » — les appels reçus PARCE QU'une autre équipe
 * ne les a pas pris (ou nous les a transmis), par équipe d'origine : la file
 * sollicitée juste avant la nôtre dans le même appel (fait `from_queue` du
 * socle de classement).
 *
 * Barres horizontales triées, une seule teinte (une seule série : le titre
 * tient lieu de légende), traîne repliée au-delà de MAX_BARRES. Le chiffre
 * en tête est le message ; les barres ne font que le décomposer. Population =
 * queue_calls, donc le total est un sous-ensemble exact de « Appels reçus » —
 * une ligne par appel : un appel repassé plusieurs fois dans la file garde la
 * provenance du passage retenu par la règle multiPassage (un appel arrivé
 * directement, parti puis revenu n'est pas « venu d'ailleurs »).
 */
export function ProvenanceAppels({ kpis, logsEnabled, queueNumber, startDate, endDate, origin }: ProvenanceAppelsProps) {
    const [traineOuverte, setTraineOuverte] = useState(false);
    const sources = kpis.inboundSources;
    const total = sources.reduce((acc, s) => acc + s.calls, 0);
    // Le total « Appels reçus » de la vignette (file + directs), pour l'état
    // vide seulement : la phrase du haut reste courte (retour du 8 sept. 2026).
    const { totalReceived } = computeTeamTotals(kpis);
    const { visibles, traine } = replierProvenances(sources);
    const max = Math.max(visibles[0]?.calls ?? 0, traine?.calls ?? 0, 1);

    const lien = (s: InboundSource) =>
        logsEnabled && s.queueNumber !== null
            ? lienJournauxProvenance({ queueNumber, fromQueue: s.queueNumber, startDate, endDate, origin })
            : null;
    const ligne = (s: InboundSource, discret = false) => {
        const pct = total > 0 ? Math.round((s.calls / total) * 100) : 0;
        const anonyme = s.queueNumber === null;
        return (
            <LigneEchange
                key={s.queueNumber ?? "hors-perimetre"}
                icone={<IconeEquipe discret={discret || anonyme} />}
                libelle={s.queueName}
                calls={s.calls}
                max={max}
                href={lien(s)}
                // Le nom complet (le libellé peut être tronqué) et la part de
                // cette équipe dans les appels venus d'ailleurs.
                infobulle={`${s.queueName} · ${s.calls} appel${s.calls > 1 ? "s" : ""} · ${pct} % des appels venus d'autres équipes`}
                discret={discret}
                teinte={anonyme ? "bg-blue-300" : undefined}
            />
        );
    };

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-6" data-visite="provenance">
            <div className="mb-4 flex items-center gap-2">
                <h3 className="text-lg font-semibold text-slate-900">D&apos;où viennent nos appels</h3>
                <Tip content={TEXTE_PROVENANCE}>
                    <Info className="h-4 w-4 text-slate-400 hover:text-slate-600" />
                </Tip>
            </div>

            {sources.length === 0 ? (
                <div className="flex h-24 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50">
                    <p className="text-sm font-medium text-slate-500">
                        Aucun appel reçu d&apos;une autre équipe sur cette période
                        {totalReceived > 0 ? ` — les ${totalReceived} appels reçus sont tous arrivés directement` : ""}
                    </p>
                </div>
            ) : (
                <>
                    <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-3xl font-bold text-slate-900">{total}</span>
                        <span className="text-sm text-slate-500">appels reçus d&apos;une autre équipe</span>
                    </div>

                    <ul className="space-y-1">
                        {visibles.map((s) => ligne(s))}
                        {traine && (
                            <li>
                                {/* La traîne se déplie sur place : les petites
                                    équipes existent, elles ne méritent juste pas
                                    une barre chacune d'emblée. */}
                                <button
                                    type="button"
                                    onClick={() => setTraineOuverte((o) => !o)}
                                    aria-expanded={traineOuverte}
                                    className={`-mx-2 ${GRILLE_ECHANGE} w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left transition-colors hover:bg-slate-50`}
                                >
                                    <span className="flex items-center justify-center text-slate-400">
                                        {traineOuverte ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </span>
                                    <span className="truncate text-sm text-slate-500">{traine.equipes} autres équipes</span>
                                    <span className="block">
                                        <span className="block h-3.5 rounded-r bg-blue-300" style={{ width: `${Math.max(1, (traine.calls / max) * 100)}%` }} />
                                    </span>
                                    <span className="text-right text-sm tabular-nums text-slate-500">{traine.calls}</span>
                                </button>
                                {traineOuverte && (
                                    <ul className="mt-1 space-y-1 border-l-2 border-slate-100 pl-3">
                                        {traine.detail.map((s) => ligne(s, true))}
                                    </ul>
                                )}
                            </li>
                        )}
                    </ul>
                </>
            )}
        </div>
    );
}
