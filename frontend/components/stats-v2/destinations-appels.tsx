"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, HelpCircle, Info, PhoneOutgoing, UserX } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AvatarCollaborateur } from "@/components/avatar-collaborateur";
import type { OutboundPerson, OutboundTeam } from "@/services/domain/call.types";
import type { CallOrigin } from "@/services/domain/call-classification";
import { replierTraine } from "@/services/domain/provenance-appels";
import { lienJournauxPersonne } from "@/services/domain/destinations-appels";
import { GRILLE_ECHANGE, IconeEquipe, LigneEchange } from "@/components/stats-v2/ligne-echange";

interface DestinationsAppelsProps {
    teams: OutboundTeam[];
    /** Droit « Voir les logs » : sans lui, les visages ne sont pas des liens. */
    logsEnabled: boolean;
    queueNumber: string;
    startDate: string;
    endDate: string;
    /** Provenance affichée (contexte global du header) — voyage avec les liens. */
    origin: CallOrigin;
}

/** Visages montrés en pile avant le « +N ». */
const VISAGES_MAX = 4;

/**
 * « Où partent nos appels » — les appels transférés (décrochés ici, servis
 * ailleurs) et débordés (partis sans décroché), par équipe de destination,
 * avec les visages des personnes qui les ont pris.
 *
 * Même grammaire de ligne que « D'où viennent nos appels ». La barre, c'est
 * l'équipe (la concentration, et la somme fait le chiffre en tête) ; les
 * visages, ce sont les personnes — toutes, pas un top 10 : les 4 premières en
 * pile, les autres derrière le « +N ». Une personne jointe sur sa ligne
 * directe est rattachée à son équipe principale, et son infobulle le dit.
 *
 * Les lignes d'équipe ne sont pas des liens : les journaux ne savent pas
 * encore lister « les appels partis vers cette équipe » (ligne directe
 * comprise) au chiffre près — les visages, eux, y mènent.
 */
export function DestinationsAppels({ teams, logsEnabled, queueNumber, startDate, endDate, origin }: DestinationsAppelsProps) {
    const [traineOuverte, setTraineOuverte] = useState(false);
    // Le total des lignes EST Transférés + Débordés des vignettes (conservation
    // garantie par composerDestinations) : pas besoin de le recalculer.
    const total = teams.reduce((acc, t) => acc + t.calls, 0);
    const { visibles, traine } = replierTraine(teams);
    const max = Math.max(visibles[0]?.calls ?? 0, traine?.calls ?? 0, 1);

    const lienPersonne = (p: OutboundPerson) =>
        logsEnabled ? lienJournauxPersonne({ queueNumber, personName: p.name, startDate, endDate, origin }) : null;

    const ligne = (t: OutboundTeam, discret = false) => (
        <LigneEchange
            key={t.queueNumber ?? `#${t.kind}`}
            icone={iconeDe(t, discret)}
            libelle={t.queueName}
            calls={t.calls}
            max={max}
            href={null}
            discret={discret}
            teinte={t.kind === "team" ? undefined : "bg-blue-300"}
            visages={t.persons.length > 0 ? <PileVisages persons={t.persons} lien={lienPersonne} /> : undefined}
        />
    );

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2">
                <h3 className="text-lg font-semibold text-slate-900">Où partent nos appels</h3>
                <Tip content="Appels décrochés ici puis servis ailleurs (transférés) ou repartis sans décroché (débordés). Chaque appel est rattaché à sa première destination après nous : l'équipe dont la file l'a distribué, ou l'équipe principale de la personne jointe sur sa ligne directe.">
                    <Info className="h-4 w-4 text-slate-400 hover:text-slate-600" />
                </Tip>
            </div>

            {teams.length === 0 ? (
                <div className="flex h-24 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50">
                    <p className="text-sm font-medium text-slate-500">Aucun appel parti vers un collaborateur ou une autre équipe sur cette période</p>
                </div>
            ) : (
                <>
                    {/* Une phrase courte, une seule ligne : la définition vit
                        dans le « i » du titre, pas ici (retour du 8 sept. 2026). */}
                    <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-3xl font-bold text-slate-900">{total}</span>
                        <span className="text-sm text-slate-500">appels transférés ou débordés ailleurs</span>
                    </div>

                    <ul className="space-y-1">
                        {visibles.map((t) => ligne(t))}
                        {traine && (
                            <li>
                                <button
                                    type="button"
                                    onClick={() => setTraineOuverte((o) => !o)}
                                    aria-expanded={traineOuverte}
                                    className={`-mx-2 ${GRILLE_ECHANGE} w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left transition-colors hover:bg-slate-50`}
                                >
                                    <span className="flex items-center justify-center text-slate-400">
                                        {traineOuverte ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </span>
                                    <span className="truncate text-sm text-slate-500">{traine.equipes} autres destinations</span>
                                    <span className="block">
                                        <span className="block h-3.5 rounded-r bg-blue-300" style={{ width: `${Math.max(1, (traine.calls / max) * 100)}%` }} />
                                    </span>
                                    <span className="text-right text-sm tabular-nums text-slate-500">{traine.calls}</span>
                                    <span />
                                </button>
                                {traineOuverte && (
                                    <ul className="mt-1 max-h-96 space-y-1 overflow-y-auto border-l-2 border-slate-100 pl-3">
                                        {traine.detail.map((t) => ligne(t, true))}
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

function iconeDe(t: OutboundTeam, discret: boolean) {
    const rond = (enfant: React.ReactNode) => (
        <span className={`flex h-7 w-7 items-center justify-center rounded-full ${discret ? "bg-slate-50 text-slate-400" : "bg-slate-100 text-slate-500"}`}>
            {enfant}
        </span>
    );
    switch (t.kind) {
        case "no_team": return rond(<UserX className="h-4 w-4" />);
        case "external": return rond(<PhoneOutgoing className="h-4 w-4" />);
        case "unknown": return rond(<HelpCircle className="h-4 w-4" />);
        default: return <IconeEquipe discret={discret || t.kind === "out_of_scope"} />;
    }
}

function descPersonne(p: OutboundPerson): string {
    const parts = [`${p.name}${p.jobTitle ? ` — ${p.jobTitle}` : ""}`, `${p.calls} appel${p.calls > 1 ? "s" : ""}`];
    if (p.viaDirectLine > 0 && p.viaDirectLine < p.calls) parts.push(`dont ${p.viaDirectLine} par sa ligne directe`);
    else if (p.viaDirectLine > 0) parts.push("par sa ligne directe");
    if (p.alsoIn.length > 0) parts.push(`aussi dans ${p.alsoIn.join(", ")}`);
    return parts.join(" · ");
}

/**
 * Les personnes d'une équipe : les premières en pile, le reste derrière un
 * « +N » qui ouvre la liste complète — tout le monde y est, avec son nombre.
 */
function PileVisages({ persons, lien }: { persons: OutboundPerson[]; lien: (p: OutboundPerson) => string | null }) {
    const visibles = persons.slice(0, VISAGES_MAX);
    const reste = persons.length - visibles.length;
    const visage = (p: OutboundPerson, taille = "h-6 w-6") => {
        const avatar = <AvatarCollaborateur name={p.name} photoUrl={p.photoUrl} className={taille} />;
        const href = lien(p);
        return href ? (
            <Link href={href} target="_blank" rel="noopener noreferrer" className="block rounded-full ring-2 ring-white transition-transform hover:z-10 hover:scale-110">
                {avatar}
            </Link>
        ) : (
            <span className="block rounded-full ring-2 ring-white">{avatar}</span>
        );
    };
    return (
        <span className="flex items-center -space-x-1.5">
            {visibles.map((p) => (
                <Tip key={p.extension} content={descPersonne(p)}>
                    {visage(p)}
                </Tip>
            ))}
            {reste > 0 && (
                <Popover>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-medium text-slate-600 ring-2 ring-white transition-colors hover:bg-slate-200"
                            aria-label={`${reste} autres collaborateurs`}
                        >
                            +{reste}
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 p-2">
                        <ul className="max-h-80 space-y-0.5 overflow-y-auto">
                            {persons.map((p) => {
                                const href = lien(p);
                                const contenu = (
                                    <>
                                        <AvatarCollaborateur name={p.name} photoUrl={p.photoUrl} className="h-7 w-7" />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm text-slate-700">{p.name}</span>
                                            <span className="block truncate text-[11px] text-slate-400">
                                                {p.jobTitle ?? (p.viaDirectLine > 0 ? "ligne directe" : "via la file")}
                                                {p.alsoIn.length > 0 ? ` · aussi dans ${p.alsoIn.join(", ")}` : ""}
                                            </span>
                                        </span>
                                        <span className="text-sm tabular-nums text-slate-600">{p.calls}</span>
                                    </>
                                );
                                const classes = "flex items-center gap-2 rounded-md px-2 py-1";
                                return (
                                    <li key={p.extension}>
                                        {href
                                            ? <Link href={href} target="_blank" rel="noopener noreferrer" className={`${classes} transition-colors hover:bg-slate-50`}>{contenu}</Link>
                                            : <div className={classes}>{contenu}</div>}
                                    </li>
                                );
                            })}
                        </ul>
                    </PopoverContent>
                </Popover>
            )}
        </span>
    );
}
