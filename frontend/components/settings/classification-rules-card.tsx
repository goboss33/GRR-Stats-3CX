"use client";

import { useEffect, useState } from "react";
import { Loader2, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueueSelector } from "@/components/stats/queue-selector";
import { getScopedQueueOptions } from "@/services/queues.service";
import { measureRulesImpact, type RulesImpact } from "@/services/rules-impact.service";
import { getSelectedServer } from "@/lib/selected-server";
import type { QueueInfo } from "@/types/queues.types";
import type { ClassificationRules } from "@/services/domain/call-classification";

/**
 * Réglage du classement des appels.
 *
 * L'écran précédent décrivait des mécanismes : « appel repassant plusieurs fois
 * dans la même file », suivi d'une liste déroulante. On pouvait le lire sans
 * savoir ce qu'on décidait. Chaque règle expose désormais un exemple d'appel
 * concret et, pour chaque option, la conséquence sur les chiffres — et un
 * bouton mesure l'effet réel sur une file de son choix.
 */

type RuleKey = keyof ClassificationRules;

interface RuleOption {
    value: string;
    label: string;
    effect: string;
}

interface RuleSpec {
    key: RuleKey;
    title: string;
    example: string;
    options: RuleOption[];
}

/** Règles gouvernant le point de vue d'une file d'attente. */
const QUEUE_RULES: RuleSpec[] = [
    {
        key: "multiPassage",
        title: "Un même appel traverse la file plusieurs fois",
        example: "L'appel entre dans la file, personne ne décroche dans le délai ; il bascule vers une autre file, qui le renvoie. De retour, un agent le prend. Un seul appel, deux passages — le « ping-pong » que mesure déjà l'écran de statistiques.",
        options: [
            { value: "best", label: "Le meilleur résultat l'emporte", effect: "L'appel compte une fois, comme Répondu. La file est jugée sur le service finalement rendu." },
            { value: "last", label: "Le dernier passage fait foi", effect: "L'appel compte une fois, selon le sort de son dernier essai. Un appel répondu puis rappelé et abandonné devient Perdu." },
            { value: "each", label: "Chaque passage compte séparément", effect: "L'appel apparaît deux fois : un perdu et un répondu. Le total dépasse alors le nombre d'appels et ne correspond plus aux logs." },
        ],
    },
    {
        key: "overflow",
        title: "L'appel repart vers une autre file",
        example: "Personne ne décroche à Pully ; l'appel bascule vers Neuchâtel, qui le traite.",
        options: [
            { value: "neutral", label: "Redirigé — ni répondu, ni perdu", effect: "Une catégorie à part. Pully n'est ni créditée ni pénalisée pour un appel traité ailleurs." },
            { value: "lost", label: "Perdu pour la file d'origine", effect: "Compté dans les Perdus de Pully : la file n'a pas su répondre dans son délai. Vision exigeante, utile pour piloter les effectifs." },
            { value: "answered", label: "Répondu", effect: "Compté dans les Répondus de Pully. Gonfle son taux de service pour un travail fait par une autre équipe." },
        ],
    },
    {
        key: "directAndQueue",
        title: "L'appel est à la fois direct et passé en file",
        example: "Un client appelle un agent sur sa ligne directe ; l'agent ne répond pas et l'appel bascule dans la file de son équipe.",
        options: [
            { value: "firstContact", label: "Le premier contact prime", effect: "Classé en Direct, car c'est ainsi qu'il est entré dans l'équipe. Total juste, lecture par canal d'entrée." },
            { value: "queueWins", label: "La file prime", effect: "Classé en File. Total juste également, mais le volume des lignes directes est sous-estimé." },
            { value: "both", label: "Compter dans les deux blocs", effect: "Mesure la charge réelle des agents, mais le total dépasse le nombre d'appels et ne pourra jamais correspondre aux logs." },
        ],
    },
    {
        key: "voicemail",
        title: "L'appel se termine sur la messagerie",
        example: "Hors des heures d'ouverture, ou lorsqu'un agent renvoie l'appel d'un bouton.",
        options: [
            { value: "separate", label: "Catégorie interne à part", effect: "Distinguée dans le calcul, mais affichée dans Perdus comme les autres. Permet d'isoler le phénomène plus tard sans changer les chiffres." },
            { value: "lost", label: "Compter comme perdu", effect: "Fondue dans les abandons dès le calcul. Aucun changement visible, une catégorie de moins à maintenir." },
            { value: "answered", label: "Compter comme répondu", effect: "Déplace ces appels dans les Répondus. Déconseillé : chez vous l'appelant ne peut pas laisser de message, l'appel se termine simplement." },
        ],
    },
];

/** Règles gouvernant le point de vue de l'entreprise. */
const COMPANY_RULES: RuleSpec[] = [
    {
        key: "outOfScopeFinalStatus",
        title: "L'appel a été traité par une file hors du périmètre du lecteur",
        example: "Un manager de Pully consulte ses appels perdus ; l'un d'eux a été récupéré par Neuchâtel, dont il n'a pas la charge.",
        options: [
            { value: "name", label: "Nommer la file", effect: "Affiche « Répondu par 910 – Neuchâtel ». Le plus informatif, mais révèle l'existence de files hors de son périmètre." },
            { value: "anonymize", label: "Indiquer sans nommer", effect: "Affiche « Répondu (hors périmètre) ». Le manager sait que le client a été servi, sans voir l'organisation des autres régions." },
            { value: "hide", label: "Ne rien afficher", effect: "Cloisonnement strict. Le manager croira ses appels définitivement perdus." },
        ],
    },
];

interface Props {
    rules: ClassificationRules;
    onChange: (rules: ClassificationRules) => void;
    /** Seuil du bruit de routage — décide de la POPULATION, pas du statut. */
    minSignificantDurationSec: number;
    onMinSignificantDurationChange: (value: number) => void;
}

export function ClassificationRulesCard({
    rules,
    onChange,
    minSignificantDurationSec,
    onMinSignificantDurationChange,
}: Props) {
    const [queues, setQueues] = useState<QueueInfo[]>([]);
    const [simQueue, setSimQueue] = useState<string | null>(null);
    const [simDays, setSimDays] = useState(30);
    const [measuring, setMeasuring] = useState(false);
    const [impact, setImpact] = useState<RulesImpact | null>(null);

    useEffect(() => {
        getScopedQueueOptions(getSelectedServer())
            .then((options) => {
                setQueues(options.queues);
                setSimQueue((current) => current ?? options.queues[0]?.queueNumber ?? null);
            })
            .catch(() => undefined);
    }, []);

    const runSimulation = async () => {
        if (!simQueue) return;
        setMeasuring(true);
        setImpact(null);
        try {
            const end = new Date();
            const start = new Date(end.getTime() - simDays * 86_400_000);
            setImpact(await measureRulesImpact(getSelectedServer(), simQueue, start, end, rules));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Mesure impossible");
        } finally {
            setMeasuring(false);
        }
    };

    const renderRule = (spec: RuleSpec) => (
        <div key={spec.key} className="space-y-2">
            <div>
                <h4 className="text-sm font-semibold text-slate-900">{spec.title}</h4>
                <p className="mt-0.5 text-xs italic text-slate-500">{spec.example}</p>
            </div>
            <div className="space-y-1.5">
                {spec.options.map((opt) => {
                    const selected = rules[spec.key] === opt.value;
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => onChange({ ...rules, [spec.key]: opt.value })}
                            className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                                selected
                                    ? "border-blue-400 bg-blue-50/60"
                                    : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                            }`}
                        >
                            <div className="flex items-start gap-2">
                                <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                                    selected ? "border-blue-500 bg-blue-500" : "border-slate-300"
                                }`} />
                                <div>
                                    <div className={`text-sm ${selected ? "font-medium text-slate-900" : "text-slate-700"}`}>
                                        {opt.label}
                                    </div>
                                    <div className="mt-0.5 text-xs text-slate-500">{opt.effect}</div>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );

    const delta = (before: number, after: number) => {
        const d = after - before;
        if (d === 0) return <span className="text-slate-400">inchangé</span>;
        return <span className={d > 0 ? "text-emerald-700" : "text-red-700"}>{d > 0 ? "+" : ""}{d}</span>;
    };

    return (
        <div className="space-y-6">
            {/* D'abord quels appels entrent dans les chiffres, ensuite comment on
                les juge. Sans cette séparation, ce seuil-ci et la « durée minimale
                d'une conversation » se ressemblaient au point d'être confondus,
                alors qu'ils décident de choses différentes. */}
            <Card>
                <CardHeader>
                    <CardTitle>Quels appels comptent</CardTitle>
                    <CardDescription>
                        Avant de juger un appel, l&apos;application décide s&apos;il doit figurer dans
                        les statistiques. Ce réglage écarte les artefacts de routage, qui ne sont
                        pas de vraies tentatives d&apos;appel.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    <Label className="text-sm font-semibold text-slate-900">
                        Sollicitations directes trop brèves
                    </Label>
                    <p className="text-xs italic text-slate-500">
                        Un appel de 9 millisecondes vers le poste d&apos;un agent qui avait un renvoi
                        actif : l&apos;appel a filé vers la file sans jamais sonner chez lui.
                    </p>
                    <p className="text-xs text-slate-500">
                        En dessous de cette durée, une sollicitation directe <strong>non répondue</strong>
                        {" "}est traitée comme du bruit et n&apos;entre pas dans les statistiques. Ce seuil
                        décide de la présence de l&apos;appel, pas de son statut.
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                        <Input
                            type="number"
                            min={0}
                            max={60}
                            className="w-32"
                            value={minSignificantDurationSec}
                            onChange={(e) => onMinSignificantDurationChange(
                                Math.max(0, Math.min(60, parseInt(e.target.value) || 0)),
                            )}
                        />
                        <span className="text-sm text-slate-500">seconde(s)</span>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Statuts vus depuis une file d&apos;attente</CardTitle>
                    <CardDescription>
                        Comment une file juge les appels qu&apos;elle reçoit. Ces règles pilotent les
                        vignettes de l&apos;écran de statistiques et la colonne « Statut groupe » des
                        journaux — les deux restent donc toujours cohérents entre eux.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                        Ces règles s&apos;appliquent au calcul, pas au stockage : les modifier change
                        rétroactivement les chiffres des périodes déjà écoulées. Un rapport édité le
                        mois dernier ne donnera plus le même résultat.
                    </div>

                    {/* Mesure d'impact — commune à toutes les règles de la section. */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                            <TrendingUp className="h-4 w-4 text-blue-600" />
                            Mesurer l&apos;impact des réglages ci-dessous
                        </div>
                        <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-[260px] flex-1">
                                <Label className="mb-1 block text-xs text-slate-600">Groupe</Label>
                                <QueueSelector
                                    queues={queues}
                                    selectedQueueNumber={simQueue}
                                    onSelect={(queueNumber) => setSimQueue(queueNumber)}
                                    placeholder="Choisir un groupe…"
                                />
                            </div>
                            <div>
                                <Label className="mb-1 block text-xs text-slate-600">Sur les derniers…</Label>
                                <select
                                    className="h-10 rounded-md border border-slate-200 bg-white px-2 text-sm"
                                    value={simDays}
                                    onChange={(e) => setSimDays(Number(e.target.value))}
                                >
                                    <option value={7}>7 jours</option>
                                    <option value={30}>30 jours</option>
                                    <option value={60}>60 jours</option>
                                </select>
                            </div>
                            <Button variant="outline" onClick={runSimulation} disabled={!simQueue || measuring}>
                                {measuring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Mesurer
                            </Button>
                        </div>
                        <p className="text-xs text-slate-500">
                            La mesure interroge les données d&apos;appels réelles : elle prend quelques
                            secondes, et la période est volontairement limitée.
                        </p>

                        {impact && (
                            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-100 text-xs text-slate-500">
                                            <th className="px-3 py-2 text-left font-medium">File {impact.queueNumber}</th>
                                            <th className="px-3 py-2 text-right font-medium">Règles enregistrées</th>
                                            <th className="px-3 py-2 text-right font-medium">Réglages en cours</th>
                                            <th className="px-3 py-2 text-right font-medium">Écart</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {([
                                            ["Total reçus", "received"],
                                            ["Répondus", "answered"],
                                            ["Perdus", "lost"],
                                            ["Redirigés", "overflow"],
                                        ] as const).map(([label, key]) => (
                                            <tr key={key} className="border-b border-slate-50 last:border-0">
                                                <td className="px-3 py-1.5 text-slate-700">{label}</td>
                                                <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{impact.current[key]}</td>
                                                <td className="px-3 py-1.5 text-right font-medium tabular-nums">{impact.candidate[key]}</td>
                                                <td className="px-3 py-1.5 text-right tabular-nums">{delta(impact.current[key], impact.candidate[key])}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                                    {impact.current.multiPassageCalls} appel(s) repassent plusieurs fois dans cette
                                    file sur la période — c&apos;est le volume que la première règle arbitre.
                                </p>
                            </div>
                        )}
                    </div>

                    {QUEUE_RULES.map(renderRule)}

                    <div className="space-y-1.5 border-t border-slate-100 pt-4">
                        <Label className="text-sm font-semibold text-slate-900">Abandons très courts</Label>
                        <p className="text-xs italic text-slate-500">
                            Un appelant compose un mauvais numéro et raccroche après trois secondes.
                        </p>
                        <p className="text-xs text-slate-500">
                            En dessous de ce seuil, l&apos;abandon est distingué dans le calcul. Il reste
                            compté dans « Perdus » : ce réglage ne change donc aucun chiffre affiché,
                            seulement la ventilation interne. Laisser vide pour désactiver.
                        </p>
                        <Input
                            type="number"
                            min={0}
                            max={300}
                            className="w-32"
                            value={rules.shortAbandonThresholdSeconds ?? ""}
                            placeholder="désactivé"
                            onChange={(e) => onChange({
                                ...rules,
                                shortAbandonThresholdSeconds: e.target.value === "" ? null : Number(e.target.value),
                            })}
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Statuts vus depuis l&apos;entreprise</CardTitle>
                    <CardDescription>
                        Le sort final d&apos;un appel, indépendamment des files traversées. Ces règles
                        pilotent la colonne « Statut final » des journaux et les chiffres du tableau
                        de bord.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Ces deux règles sont volontairement figées : leur exposer un
                        réglage rouvrirait la porte aux vocabulaires multiples que
                        l'on vient d'unifier. Les énoncer reste nécessaire — sans
                        cela, « Perdu » est un verdict sans critère visible. */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                        <p className="font-medium text-slate-700">Comment le statut final est déterminé</p>
                        <ol className="mt-1.5 list-inside list-decimal space-y-1">
                            <li>
                                <strong>Répondu</strong> — le <strong>dernier</strong> décroché par un
                                humain a duré plus que la durée minimale ci-dessous. Si la réception
                                parle au client puis transfère à un collègue absent, l&apos;appel est
                                donc <strong>Perdu</strong> : on juge l&apos;aboutissement, pas l&apos;effort.
                            </li>
                            <li>
                                <strong>Perdu</strong> — tout le reste : personne n&apos;a décroché, ligne
                                occupée, ou appel terminé sur la messagerie. Ces trois cas restent
                                distingués dans le parcours de l&apos;appel et par l&apos;icône du badge,
                                mais portent le même nom pour ne pas multiplier le vocabulaire.
                            </li>
                        </ol>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-sm font-semibold text-slate-900">
                            Durée minimale d&apos;une conversation
                        </Label>
                        <p className="text-xs italic text-slate-500">
                            Un agent décroche et raccroche aussitôt, ou un transfert échoue au moment
                            de l&apos;aboutissement.
                        </p>
                        <p className="text-xs text-slate-500">
                            En dessous de cette durée, le décroché n&apos;est pas considéré comme une
                            réponse. Mettre 0 pour compter tout décroché.
                        </p>
                        <div className="flex items-center gap-2">
                            <Input
                                type="number"
                                min={0}
                                max={60}
                                className="w-32"
                                value={rules.minAnswerSeconds}
                                onChange={(e) => onChange({ ...rules, minAnswerSeconds: Number(e.target.value) })}
                            />
                            <span className="text-sm text-slate-500">seconde(s)</span>
                        </div>
                    </div>

                    {COMPANY_RULES.map(renderRule)}
                </CardContent>
            </Card>
        </div>
    );
}
