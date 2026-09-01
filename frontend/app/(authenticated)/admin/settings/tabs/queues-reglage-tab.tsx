"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, Radio, Users2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Attente } from "@/components/ui/etat-chargement";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { getSelectedServer } from "@/lib/selected-server";

/**
 * Réglage des files d'attente — D'OÙ vient chaque information d'équipe.
 *
 * Cette page existe parce que la question s'est posée plusieurs fois : le nom
 * d'une équipe, son département et sa composition ne viennent pas du même
 * endroit, et les sources ne disent pas toujours la même chose. On l'écrit
 * une fois pour toutes, à l'endroit où on viendra la régler.
 */

interface Etat {
    rosterSource: string | null;
    xapiEnabled: boolean;
    xapiUsable: boolean;
}

function Source({
    icone: Icone,
    titre,
    source,
    detail,
}: {
    icone: React.ComponentType<{ className?: string }>;
    titre: string;
    source: string;
    detail: string;
}) {
    return (
        <div className="flex gap-3 rounded-lg border border-slate-200 p-4">
            <Icone className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-400" />
            <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{titre}</p>
                <p className="mt-0.5 text-sm font-medium text-blue-700">{source}</p>
                <p className="mt-1 text-sm text-slate-600">{detail}</p>
            </div>
        </div>
    );
}

export function QueuesReglageTab() {
    const serverId = getSelectedServer();
    const [etat, setEtat] = useState<Etat | null>(null);
    const [chargement, setChargement] = useState(true);
    // null = valeur pas encore connue : l'interrupteur attend le serveur.
    const [masquerArchivees, setMasquerArchivees] = useState<boolean | null>(null);

    // Bascule optimiste : l'interrupteur répond tout de suite, l'échec rétablit.
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

    const charger = useCallback(async () => {
        setChargement(true);
        try {
            // Deux lectures indépendantes : une panne de l'une ne prive pas de
            // l'autre. Le typage reste large, ces routes évoluent séparément.
            const lire = async (url: string): Promise<Record<string, unknown>> => {
                try {
                    const r = await fetch(url);
                    return r.ok ? await r.json() : {};
                } catch { return {}; }
            };
            const [reglages, journal] = await Promise.all([
                lire("/api/admin/settings"),
                lire(`/api/admin/xapi-journal?server=${encodeURIComponent(serverId)}`),
            ]);
            setMasquerArchivees(reglages.hideArchivedQueues === true);
            setEtat({
                rosterSource: typeof reglages.ruleRosterSource === "string" ? reglages.ruleRosterSource : null,
                xapiEnabled: journal.xapiEnabled === true,
                xapiUsable: journal.xapiUsable === true,
            });
        } finally {
            setChargement(false);
        }
    }, [serverId]);

    useEffect(() => { void charger(); }, [charger]);

    if (chargement) {
        return (
            <Card>
                <CardContent className="py-10">
                    <Attente libelle="Lecture des réglages…" />
                </CardContent>
            </Card>
        );
    }

    const compositionParJournal = etat?.rosterSource === "journalAuto";

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Files archivées</CardTitle>
                    <CardDescription>
                        Ce réglage gouverne TOUTE l&apos;application, pas seulement le registre.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <label className="flex cursor-pointer items-start gap-3">
                        <Switch
                            checked={masquerArchivees === true}
                            disabled={masquerArchivees === null}
                            onCheckedChange={enregistrerMasquage}
                            className="mt-0.5"
                        />
                        <span>
                            <span className="text-sm font-medium text-slate-900">
                                Masquer les files archivées des listes
                            </span>
                            <span className="mt-0.5 block text-sm text-slate-600">
                                Les retire de la barre latérale, de la recherche et de l&apos;aperçu des groupes,
                                pour tous les utilisateurs. Périmètres, statistiques passées et journaux
                                restent intacts.
                            </span>
                        </span>
                    </label>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">D&apos;où viennent les informations d&apos;équipe</CardTitle>
                    <CardDescription>
                        Trois informations, trois provenances. Les connaître évite de chercher
                        au mauvais endroit quand un nom ou un chiffre surprend.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Source
                        icone={Database}
                        titre="Noms et départements des équipes"
                        source="Registre — déduit des appels"
                        detail={"Le nom retenu est celui du dernier appel reçu par l'équipe, relevé lors de la découverte des files. "
                            + "Conséquence : une équipe renommée au 3CX garde son ancien nom tant qu'aucun appel récent n'est arrivé — "
                            + "et une base d'appels en retard fige les noms d'autant."}
                    />
                    <Source
                        icone={Users2}
                        titre="Composition — qui fait partie d'une équipe"
                        source={compositionParJournal
                            ? "Journal XAPI dès qu'un mois complet est couvert, sinon activité observée"
                            : "Activité observée sur la période affichée"}
                        detail={compositionParJournal
                            ? "Règle « Source de l'équipe » réglée sur le journal. Les périodes antérieures au premier mois complet du journal restent jugées sur l'activité : on ne réécrit jamais l'histoire."
                            : "Règle « Source de l'équipe » réglée sur l'activité : l'équipe est déduite des sollicitations vues dans la période affichée. Se règle dans Règles métier."}
                    />
                    <Source
                        icone={Radio}
                        titre="Relevé nocturne de la composition réelle"
                        source={etat?.xapiUsable ? "Surcouche XAPI active" : etat?.xapiEnabled ? "Surcouche XAPI activée mais incomplète" : "Surcouche XAPI inactive"}
                        detail={etat?.xapiUsable
                            ? "Chaque nuit, la composition de chaque équipe est relevée auprès du 3CX et datée. Le PBX connaît aussi le nom et le département de chaque file, indépendamment des appels."
                            : "Sans surcouche, tout repose sur les appels. Les identifiants se saisissent dans l'onglet Tenant."}
                    />
                </CardContent>
            </Card>
        </div>
    );
}
