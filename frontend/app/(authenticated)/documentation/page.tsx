"use client";

import { useState } from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Layers,
    Database,
    Shield,
    Container,
    Layout,
    Server,
    FileText,
    Box,
    TrendingUp,
    AlertTriangle,
} from "lucide-react";

// ============================================
// DÉCISIONS MÉTIER ACTIVES
// ============================================

interface Decision {
    id: string;
    category: string;
    title: string;
    date: string;
    summary: string;
    justification: string;
    impact: string;
}

const decisions: Decision[] = [
    {
        id: "1.16",
        category: "Statistiques Queue",
        title: "Le transfert accompli est un Répondu ; « Redirigés » devient « Débordements »",
        date: "7 août 2026",
        summary: "Un appel décroché par l'équipe puis servi ailleurs (statut fin « Transféré ») est compté dans la vignette Répondus, en sous-catégorie visible (File · Directs · Transférés). La vignette orange, renommée « Débordements », ne contient plus que les appels partis SANS décroché. Dans les entrées plus anciennes de cette page, « Redirigés » se lit désormais « Débordements ».",
        justification: "L'ancienne vignette orange mélangeait du travail accompli (décrocher puis transférer — le métier des réceptions) et de la vraie fuite (personne n'a décroché). Ce mélange rendait la couleur d'alerte mensongère et créait un écart inexpliqué entre les Répondus du haut de page et la « Prise en charge totale » du tableau des collaborateurs (ex. 421 vs 426). Revers assumé : un appel transféré est répondu chez l'équipe qui a décroché ET chez celle qui a servi en dernier — la somme des répondus par équipe n'est plus additive entre équipes (les vues multi-équipes de l'app dédupliquent par préséance).",
        impact: "DEFAULT_OUTCOME_GROUPING (handed_off → answered) et computeTeamTotals : vignettes, donuts, courbe de volume et liens vers les logs suivent la même table. Le statut fin « Transféré » reste visible partout (badge des logs en vert clair, colonne du tableau des collaborateurs, sous-ligne de la vignette). Les consommateurs de l'API analytics voient leurs « répondus » augmenter du nombre de transferts accomplis.",
    },
    {
        id: "1.10",
        category: "Statistiques Queue",
        title: "Cercle fermé : Total = Répondus + Perdus + Redirigés",
        date: "12 mai 2026",
        summary: "Invariant mathématique fondamental : la somme des trois catégories d'outcomes doit toujours égaler le nombre total d'appels reçus (File + Directs). Aucun appel ne doit être compté deux fois ni disparaître.",
        justification: "Les cadres de direction utilisent ces chiffres pour évaluer la performance de l'équipe (règle métier : >20% d'appels perdus = pas de télétravail). Une incohérence entre le total et la somme des parts détruirait la confiance dans l'outil. L'analyse de 4 scénarios CDR réels a permis de définir des règles de comptage précises pour chaque cas limite.",
        impact: "Refonte complète de la logique SQL dans route.ts (CTE call_outcomes, direct_calls_stats), du type QueueKPIs (ajout de directLost), et du composant team-overview.tsx (totalLost = callsAbandoned + directLost). Les logs restent inchangés.",
    },
    {
        id: "1.11",
        category: "Statistiques Queue",
        title: "Overflow 'yo-yo' : un appel qui revient n'est pas redirigé",
        date: "12 mai 2026",
        summary: "Un appel qui quitte la file (overflow vers une autre file) mais revient ensuite et est traité par un collaborateur de la file d'origine est compté comme 'Répondu', pas comme 'Redirigé'.",
        justification: "Analyse du scénario N°1 : un appel passe par 993 → 900 (Lucia répond) → transfert → retour en 993 → Aude (164) répond. La file 993 a fait son travail : un de ses collaborateurs a décroché. Le classer 'Redirigé' serait incorrect car l'appel a été traité par la file.",
        impact: "Modification du CTE call_outcomes dans route.ts : ajout de la condition `AND NOT bool_or(was_answered)` avant de classer un appel comme overflow. Élimine ~10 appels de double-comptage sur un mois.",
    },
    {
        id: "1.12",
        category: "Statistiques Queue",
        title: "Perdus = File abandonnée + Directs non répondus",
        date: "12 mai 2026",
        summary: "Le KPI 'Perdus' englobe désormais les appels abandonnés dans la file ET les appels directs non répondus par les collaborateurs de l'équipe. Le détail affiche 'File: X · Directs: Y' au lieu de '<10s: X · ≥10s: Y'.",
        justification: "Le détail <10s/≥10s n'était pas pertinent pour le management. En revanche, distinguer les perdus par canal (file vs direct) permet d'identifier si le problème vient du routage (file) ou de la disponibilité des collaborateurs (directs).",
        impact: "Ajout du CTE direct_calls_stats dans route.ts. Le composant team-overview.tsx calcule totalLost = kpis.callsAbandoned + kpis.directLost. Le sous-titre de la carte Perdus affiche 'File: 83 · Directs: 700' au lieu de '<10s: 60 · ≥10s: 23'.",
    },
    {
        id: "1.13",
        category: "Statistiques Queue",
        title: "Déduplication des directs au niveau équipe",
        date: "12 mai 2026",
        summary: "Le nombre d'appels directs reçus est compté au niveau équipe (COUNT DISTINCT call_history_id) et non par somme des collaborateurs. Un appel transféré entre deux collaborateurs de la même équipe compte comme 1 seul appel direct.",
        justification: "L'ancienne logique sommant les directReceived par collaborateur gonflait le total de ~71 appels (77 appels multi-collaborateurs identifiés). Un appel transféré de Lucia → Maxime était compté 1x pour Lucia + 1x pour Maxime = 2, alors qu'il s'agit d'un seul appel.",
        impact: "Le CTE direct_calls_stats utilise COUNT(DISTINCT c.call_history_id). Le tableau des collaborateurs affiche les totaux dédupliqués de l'équipe (1347 au lieu de 1418), avec un tooltip explicatif. Les chiffres individuels par collaborateur restent inchangés.",
    },
    {
        id: "1.14",
        category: "Statistiques Queue",
        title: "Redirigé = sorti SANS retour traité",
        date: "12 mai 2026",
        summary: "Un appel n'est classé 'Redirigé' que s'il a quitté la file et n'est JAMAIS revenu y être traité. Si l'appel revient (par file ou par direct) et est décroché par un collaborateur de la file, le statut 'Redirigé' est annulé au profit de 'Répondu'.",
        justification: "Analyse du scénario N°3 : un appel arrive sur le DID de Maxime (forward_all activé) → ring group → script → file 993 → timeout → overflow vers 900 → Lucia répond → transfère à Maxime → Maxime répond. Maxime faisant partie de 993, l'appel est 'Répondu' pour 993, pas 'Redirigé'.",
        impact: "La logique SQL vérifie bool_or(was_answered) au niveau du call_history_id global, pas au niveau du passage. Un appel yo-yo (993 → 900 → retour 993 → répondu) est correctement classé 'answered'.",
    },
    {
        id: "1.15",
        category: "Statistiques Queue",
        title: "Direct = premier destinataire extension OU transfert vers extension",
        date: "12 mai 2026",
        summary: "Un appel est compté comme 'Direct' si son premier destinataire est une extension (DID direct) OU s'il est transféré vers une extension (peu importe le parcours précédent). Les forward_all, transferts, et appels en occupation comptent tous comme 'Direct'.",
        justification: "Même si Maxime a forward_all activé (statut absent), l'appel lui était destiné. Le comptabiliser comme direct reflète la charge potentielle du collaborateur. Exclure les forward_all diminuerait artificiellement le nombre de directs reçus.",
        impact: "Le CTE direct_calls_stats inclut tous les segments vers une extension avec creation_forward_reason IS DISTINCT FROM 'polling'. Le filtre de bruit système (<1s non répondus) reste actif pour exclure les artefacts de routage.",
    },
    {
        id: "1.8",
        category: "Statistiques Queue",
        title: "Appels uniques comme métrique principale",
        date: "3 mars 2026",
        summary: "Les KPIs affichent les appels uniques (DISTINCT call_history_id) comme chiffre principal. Les passages multiples (ping-pong) apparaissent comme information secondaire via une jauge de qualité.",
        justification: "La page Logs affiche 1 ligne = 1 appel unique. Si les statistiques affichent des 'passages', les managers comparent les deux pages et voient des chiffres différents sans comprendre pourquoi. L'unification sur les appels uniques garantit la cohérence visuelle.",
        impact: "Le donut 'Répondus / Abandonnés / Redirigés' reflète désormais le nombre réel d'appelants distincts. Un appel abandonné puis rappelé et répondu est compté comme 'répondu' (priorité : answered > overflow > abandoned).",
    },
    {
        id: "1.7",
        category: "Statistiques Queue",
        title: "Phénomène du Ping-Pong",
        date: "12 février 2026",
        summary: "Un même appel peut passer plusieurs fois par la même queue (client mal dirigé, retour à la réception). Cette réalité est rendue visible via deux métriques : 'appels uniques' et 'total passages'.",
        justification: "Ce n'est pas un cas exceptionnel mais un comportement quotidien (ex: client appuie 2, parle au mauvais service, retourne à la réception, est redirigé correctement). Masquer ce phénomène sous-estime la charge réelle des collaborateurs.",
        impact: "Le taux de ping-pong (passages supplémentaires / total passages) devient un KPI stratégique pour identifier les problèmes de routage. Exemple : 3.8% sur la queue 993 = bon routage ; 37.5% sur une autre = problème à investiguer.",
    },
    {
        id: "1.2",
        category: "Statistiques Queue",
        title: "Distinction répondus vs transférés",
        date: "Initial",
        summary: "Un appel transféré par un collaborateur est comptabilisé comme 'répondu' dans le donut. Le nombre de transferts apparaît séparément comme information complémentaire.",
        justification: "L'appel a bien été décroché : le client n'est pas resté sans interlocuteur. Le transfert est une action volontaire du collaborateur après avoir pris l'appel. Séparer 'transférés' comme catégorie à part créerait un donut dont la somme des parts dépasserait 100%.",
        impact: "Le taux de réponse de la queue n'est pas artificiellement gonflé ni dégonflé. Les transferts sont visibles dans le tableau collaborateurs (colonne abandonnée au profit du format X/Total).",
    },
    {
        id: "1.9",
        category: "Statistiques Queue",
        title: "Bandeau 'Bilan de l'équipe'",
        date: "3 mars 2026",
        summary: "Bandeau affiché au-dessus du donut combinant les appels queue et les appels directs de l'équipe, avec leurs taux respectifs.",
        justification: "Un collaborateur peu actif en queue peut être très chargé en directs. Sans cette vue d'ensemble, le manager pourrait conclure à tort qu'un collaborateur est inactif.",
        impact: "Affichage : '89 appels répondus · Queue: 42/55 (76%) · Directs: 47/55 (85%)'. Le manager dispose d'une vision consolidée de l'activité totale.",
    },
    {
        id: "1.6",
        category: "Statistiques Queue",
        title: "Redirections = Overflow automatique",
        date: "Initial",
        summary: "Différenciation stricte entre 'redirigé' (débordement automatique du système : timeout, règle de routage) et 'transféré' (action manuelle d'un collaborateur après avoir décroché).",
        justification: "Ce sont deux mécanismes fondamentalement différents : automatique vs volontaire. Le manager doit pouvoir distinguer 'personne n'a répondu' de 'le collaborateur a répondu puis a choisi de transférer'.",
        impact: "Les appels redirigés vers une autre queue apparaissent dans la catégorie 'Redirigés' (orange) du donut. Les transferts manuels restent dans 'Répondus'.",
    },
    {
        id: "1.5",
        category: "Statistiques Queue",
        title: "Exclusion des destinations techniques",
        date: "Initial",
        summary: "Les transferts pointant vers des entrées techniques (ring groups, IVR) sont exclus du comptage des transferts affichés.",
        justification: "Ces destinations sont des artefacts du système 3CX, pas des actions volontaires d'un collaborateur. Les inclure fausserait le comptage des 'vrais' transferts vers des personnes.",
        impact: "Seuls les transferts vers des extensions ou des queues externes sont comptabilisés comme tels.",
    },
    {
        id: "2.1",
        category: "Activité des Collaborateurs",
        title: "Absence de taux de réponse individuel sur la queue",
        date: "Initial",
        summary: "Le tableau collaborateurs n'affiche pas de 'taux de réponse' basé sur les appels queue car ce chiffre est structurellement biaisé à la baisse.",
        justification: "Dans une queue à 9 collaborateurs, chaque appel fait sonner ~5 collaborateurs simultanément. Une collaboratrice peut recevoir 534 sonneries et n'en décrocher que 116 (22%). Mais les 418 autres ont été décrochées par des collègues : elle ne les a pas 'ratées'. Afficher 22% serait trompeur.",
        impact: "Le taux de réponse individuel est remplacé par le Score de performance (0-100) qui compare le volume relatif à la moyenne de l'équipe.",
    },
    {
        id: "2.3",
        category: "Activité des Collaborateurs",
        title: "Score de performance (0-100)",
        date: "Initial",
        summary: "Score composite calculé sur chaque collaborateur : 60% volume relatif (appels traités / moyenne équipe, plafonné à 60 points) + 40% réactivité directe (taux de décroché sur les appels directs).",
        justification: "Le volume est relatif à la moyenne de l'équipe : un collaborateur à mi-temps n'est pas pénalisé par rapport à un temps plein. La réactivité directe est un ratio individuel non dilué par le partage de la queue.",
        impact: "Un collaborateur sans appel direct reçoit les 40 points de réactivité (pas de pénalisation). Score < 40 = signal d'attention ; 40-69 = moyenne ; 70-100 = performant.",
    },
    {
        id: "2.9",
        category: "Activité des Collaborateurs",
        title: "Résolveur Final",
        date: "3 mars 2026",
        summary: "Quand un appel passe plusieurs fois par la même queue et est décroché par différents collaborateurs, seul le dernier collaborateur à décrocher est crédité dans la colonne 'Queue (résolu)'.",
        justification: "C'est le dernier collaborateur qui a effectivement résolu la demande du client. Cette règle garantit l'invariant mathématique : la somme des colonnes 'Queue (résolu)' des collaborateurs = le nombre dans le donut 'Répondus'.",
        impact: "Cohérence parfaite entre le donut et le tableau collaborateurs. Le manager ne voit jamais de divergence entre les deux vues.",
    },
    {
        id: "2.7",
        category: "Activité des Collaborateurs",
        title: "Transferts reçus = Appels directs",
        date: "Initial",
        summary: "Un appel transféré vers un collaborateur (qu'il provienne d'une autre queue ou du sein de la même queue) est comptabilisé comme un appel direct pour le collaborateur receveur.",
        justification: "Du point de vue de la charge de travail du collaborateur receveur, un transfert et un direct sont identiques : il décroche et traite la demande. Côté queue, l'appel reste crédité au collaborateur initial (pas de double comptage).",
        impact: "La jauge de charge et le score reflètent fidèlement le travail réel de chaque collaborateur, quelle que soit l'origine de l'appel.",
    },
    {
        id: "3.3",
        category: "Logs & CDR",
        title: "Tableau agrégé et modal de détail",
        date: "Initial",
        summary: "La page logs affiche un appel = une ligne (agrégation par call_history_id). Un clic ouvre une modale montrant tous les segments CDR de cet appel.",
        justification: "Un seul appel peut générer 5 à 15 entrées CDR (queue, polling, transferts, ring groups). Afficher toutes les lignes serait illisible pour un manager. L'agrégation donne une vue '1 appel = 1 ligne'. La modale permet aux utilisateurs techniques d'inspecter le détail.",
        impact: "Interface lisible pour le manager, transparence totale pour l'audit technique.",
    },
    {
        id: "5.2",
        category: "Architecture",
        title: "Repository Pattern",
        date: "Mars 2026",
        summary: "Un seul fichier exécute du SQL vers la table cdroutput : cdr.repository.ts. Les services font de l'orchestration. Les pages font de l'affichage.",
        justification: "La logique SQL était auparavant dupliquée entre plusieurs services, causant des incohérences de données entre le dashboard et les logs. La centralisation garantit que le même calcul est utilisé partout.",
        impact: "Toute modification de la logique de comptage se fait en un seul endroit. Le diagnostic service vérifie que dashboard et logs restent cohérents.",
    },
    {
        id: "5.3",
        category: "Architecture",
        title: "Persistance des filtres dans l'URL",
        date: "Avant mars 2026",
        summary: "Tous les filtres de la page logs sont sérialisés dans l'URL. Ils survivent au rafraîchissement de page et permettent le partage par lien direct.",
        justification: "Un manager doit pouvoir partager une vue filtrée avec un collègue ou la bookmarker. Les valeurs textuelles utilisent le debounce pour éviter de polluer l'historique navigateur.",
        impact: "Un clic sur un KPI du dashboard génère un lien direct vers les logs préfiltrés avec les mêmes critères.",
    },
];

const excludedDecisionIds = ["1.8", "1.9", "1.2", "1.7", "2.1", "2.3", "5.2", "5.3"];
const decisionCategories = Array.from(new Set(decisions.filter((d) => !excludedDecisionIds.includes(d.id)).map((d) => d.category)));

// ============================================
// COMPOSANTS INTERMÉDIAIRES
// ============================================

function SectionTitle({
    icon: Icon,
    title,
    subtitle,
}: {
    icon: React.ElementType;
    title: string;
    subtitle?: string;
}) {
    return (
        <div className="mb-8">
            <div className="flex items-center gap-2 mb-1">
                <Icon className="h-5 w-5 text-blue-600" />
                <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
            </div>
            {subtitle && <p className="text-slate-500">{subtitle}</p>}
        </div>
    );
}

function StackCard({
    icon: Icon,
    title,
    badges,
}: {
    icon: React.ElementType;
    title: string;
    badges: string[];
}) {
    return (
        <Card className="hover:shadow-md transition-shadow h-full flex flex-col">
            <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-slate-100">
                        <Icon className="h-5 w-5 text-slate-700" />
                    </div>
                    <CardTitle className="text-base">{title}</CardTitle>
                </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col">
                <div className="mt-auto">
                    <div className="flex flex-wrap gap-1.5">
                        {badges.map((b) => (
                            <Badge key={b} variant="secondary" className="text-xs">
                                {b}
                            </Badge>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

export default function DocumentationPage() {
    const [activeDecisionCategory, setActiveDecisionCategory] = useState<string>(decisionCategories[0]);

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Hero */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-6xl mx-auto px-6 py-12">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2.5 bg-blue-600 rounded-xl">
                            <FileText className="h-6 w-6 text-white" />
                        </div>
                        <h1 className="text-3xl font-bold text-slate-900">
                            Documentation Technique
                        </h1>
                    </div>
                    <p className="text-slate-500 max-w-2xl leading-relaxed">
                        Référence complète du projet <strong>GRR Stats 3CX</strong>. Cette documentation s'adresse aux équipes de direction, aux développeurs reprenant le projet, et à toute personne souhaitant comprendre l'architecture et les décisions métier qui fondent l'application.
                    </p>
                </div>
            </div>

            <div className="max-w-6xl mx-auto px-6 py-12 space-y-16">

                {/* STACK TECHNIQUE */}
                <section>
                    <SectionTitle
                        icon={Layers}
                        title="Stack Technique"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        <StackCard
                            icon={Layout}
                            title="Frontend"
                            badges={["Next.js 15", "React 19", "TypeScript", "Tailwind CSS"]}
                        />
                        <StackCard
                            icon={Database}
                            title="Base de données"
                            badges={["PostgreSQL", "Prisma ORM", "Raw SQL"]}
                        />
                        <StackCard
                            icon={Shield}
                            title="Authentification"
                            badges={["NextAuth v5", "JWT", "bcrypt", "Middleware"]}
                        />
                        <StackCard
                            icon={Container}
                            title="Infrastructure"
                            badges={["Docker", "Docker Compose", "Node.js 20"]}
                        />
                        <StackCard
                            icon={Box}
                            title="UI & Composants"
                            badges={["Shadcn/ui", "Radix UI", "Lucide Icons", "Recharts"]}
                        />
                        <StackCard
                            icon={Server}
                            title="API & Backend"
                            badges={["App Router API", "Server Actions", "Edge Runtime"]}
                        />
                    </div>
                </section>

                {/* DÉCISIONS MÉTIER */}
                <section>
                    <SectionTitle
                        icon={FileText}
                        title="Décisions métier"
                        subtitle="Règles fondamentales déterminant les chiffres affichés"
                    />

                    {/* Category tabs */}
                    <div className="flex flex-wrap gap-2 mb-6">
                        {decisionCategories.map((cat) => (
                            <button
                                key={cat}
                                onClick={() => setActiveDecisionCategory(cat)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                    activeDecisionCategory === cat
                                        ? "bg-blue-600 text-white"
                                        : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                                }`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                        {decisions
                            .filter((d) => d.category === activeDecisionCategory && !excludedDecisionIds.includes(d.id))
                            .map((decision) => (
                                <Card key={decision.id} className="hover:shadow-sm transition-shadow">
                                    <CardContent className="p-5">
                                        <div className="flex items-start justify-between gap-4 mb-3">
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <Badge variant="outline" className="text-xs font-mono">
                                                        #{decision.id}
                                                    </Badge>
                                                    <span className="text-xs text-slate-400">{decision.date}</span>
                                                </div>
                                                <h3 className="font-semibold text-slate-900">{decision.title}</h3>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                                            <div className="md:col-span-1">
                                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Résumé</p>
                                                <p className="text-slate-600 leading-relaxed">{decision.summary}</p>
                                            </div>
                                            <div className="md:col-span-1">
                                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Justification</p>
                                                <p className="text-slate-600 leading-relaxed">{decision.justification}</p>
                                            </div>
                                            <div className="md:col-span-1">
                                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Impact</p>
                                                <p className="text-slate-600 leading-relaxed">{decision.impact}</p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                    </div>
                </section>

                <hr className="border-slate-200" />

                {/* ÉTUDE DE CAS : SCÉNARIOS D'APPELS */}
                <section>
                    <SectionTitle
                        icon={TrendingUp}
                        title="Étude de cas : scénarios d'appels"
                        subtitle="Comment chaque type d'appel est comptabilisé pour garantir Total = Répondus + Perdus + Débordements"
                    />

                    <Card className="mb-6">
                        <CardContent className="p-6">
                            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-4">
                                <h4 className="font-semibold text-emerald-900 mb-2 flex items-center gap-2">
                                    <TrendingUp className="h-4 w-4" />
                                    Invariant fondamental
                                </h4>
                                <p className="text-sm text-emerald-800">
                                    <code className="font-mono font-bold">Total reçus = Répondus (dont Transférés) + Perdus + Débordements</code>
                                </p>
                                <p className="text-xs text-emerald-700 mt-1">
                                    Chaque appel doit être compté exactement une fois, quelque part. Aucun appel ne doit être double-compté ni disparaître.
                                </p>
                            </div>

                            <p className="text-sm text-slate-600 mb-4">
                                Quatre scénarios CDR réels ont été analysés pour définir les règles de comptage. Chaque scénario illustre un cas limite
                                et la manière dont il est classé dans les KPIs.
                            </p>
                        </CardContent>
                    </Card>

                    {/* Scénario 1 */}
                    <Card className="mb-4">
                        <CardContent className="p-5">
                            <div className="flex items-center gap-2 mb-3">
                                <Badge className="bg-blue-600 text-white text-xs">Scénario 1</Badge>
                                <h3 className="font-semibold text-slate-900">Appel yo-yo : 993 → 900 → retour 993 → répondu</h3>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Parcours</p>
                                    <div className="space-y-1 text-sm">
                                        <p className="text-slate-600">1. Externe → IVR → <strong>Queue 900</strong> → Lucia répond ✅</p>
                                        <p className="text-slate-600">2. Lucia transfère → Filip (174) → pas répondu</p>
                                        <p className="text-slate-600">3. Ring group → Script → <strong>Queue 993</strong> → timeout</p>
                                        <p className="text-slate-600">4. Overflow → Script → <strong>Queue 900</strong> → Lucia répond ✅</p>
                                        <p className="text-slate-600">5. Lucia transfère → Filip → pas répondu</p>
                                        <p className="text-slate-600">6. Ring group → Script → <strong>Queue 993</strong> → <strong>Aude (164) répond ✅</strong></p>
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Comptabilisation pour 993</p>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex items-center gap-2">
                                            <span className="text-emerald-600 font-bold">Répondu : 1</span>
                                            <span className="text-slate-400">Aude (collaborateur 993) a décroché au 2ème passage</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-slate-400">Perdu : 0</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-slate-400">Débordé : 0</span>
                                            <span className="text-slate-400">— l'appel est revenu et a été traité</span>
                                        </div>
                                    </div>
                                    <div className="mt-3 bg-slate-50 rounded p-3 border border-slate-200">
                                        <p className="text-xs text-slate-600">
                                            <strong>Règle :</strong> Un appel est "Répondu" pour une file si au moins un agent de cette file a décroché, peu importe le nombre de passages ou les allers-retours.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Scénario 2 */}
                    <Card className="mb-4">
                        <CardContent className="p-5">
                            <div className="flex items-center gap-2 mb-3">
                                <Badge className="bg-blue-600 text-white text-xs">Scénario 2</Badge>
                                <h3 className="font-semibold text-slate-900">Appel multi-files : 900 → 993 → 900 → 905 → répondu ailleurs</h3>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Parcours</p>
                                    <div className="space-y-1 text-sm">
                                        <p className="text-slate-600">1. Externe → IVR → <strong>Queue 900</strong> → Lucia répond ✅</p>
                                        <p className="text-slate-600">2. Lucia transfère → Damien (167) → pas répondu</p>
                                        <p className="text-slate-600">3. Ring group → Script → <strong>Queue 993</strong> → timeout (162, 177, 174)</p>
                                        <p className="text-slate-600">4. Overflow → Script → <strong>Queue 900</strong> → Lucia répond ✅</p>
                                        <p className="text-slate-600">5. ... (boucles 900 ↔ 905) ...</p>
                                        <p className="text-slate-600">6. <strong>Queue 905</strong> → Dylan (188) répond ✅</p>
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Comptabilisation pour 993</p>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex items-center gap-2">
                                            <span className="text-slate-400">Répondu : 0</span>
                                            <span className="text-slate-400">— aucun collaborateur 993 n'a décroché</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-slate-400">Perdu : 0</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-amber-600 font-bold">Débordé : 1</span>
                                            <span className="text-slate-400">— sorti de 993 sans y être traité</span>
                                        </div>
                                    </div>
                                    <div className="mt-3 bg-slate-50 rounded p-3 border border-slate-200">
                                        <p className="text-xs text-slate-600">
                                            <strong>Règle :</strong> Un appel est "Débordé" s'il a quitté la file SANS y être traité ET sans y revenir. Ici, 993 n'a traité personne → Débordé.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Scénario 3 */}
                    <Card className="mb-4">
                        <CardContent className="p-5">
                            <div className="flex items-center gap-2 mb-3">
                                <Badge className="bg-blue-600 text-white text-xs">Scénario 3</Badge>
                                <h3 className="font-semibold text-slate-900">Direct forward_all : DID Maxime → file 993 → overflow → retour Maxime</h3>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Parcours</p>
                                    <div className="space-y-1 text-sm">
                                        <p className="text-slate-600">1. Externe → <strong>DID Maxime (162)</strong> → forward_all activé</p>
                                        <p className="text-slate-600">2. Ring group → Script → <strong>Queue 993</strong> → timeout (164, 163, 174, 177)</p>
                                        <p className="text-slate-600">3. Overflow → Script → <strong>Queue 900</strong> → Lucia répond ✅</p>
                                        <p className="text-slate-600">4. Lucia transfère → <strong>Maxime (162)</strong> → <strong>Maxime répond ✅</strong></p>
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Comptabilisation pour 993</p>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex items-center gap-2">
                                            <span className="text-emerald-600 font-bold">Répondu : 1</span>
                                            <span className="text-slate-400">Maxime (collaborateur 993) a répondu via transfert</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-slate-400">Perdu : 0</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-slate-400">Débordé : 0</span>
                                            <span className="text-slate-400">— l'appel est revenu via direct</span>
                                        </div>
                                    </div>
                                    <div className="mt-3 bg-slate-50 rounded p-3 border border-slate-200">
                                        <p className="text-xs text-slate-600">
                                            <strong>Règle :</strong> Un transfert vers un agent de la file annule le statut "Débordé". Maxime faisant partie de 993, l'appel est "Répondu" pour 993.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Scénario 4 */}
                    <Card className="mb-4">
                        <CardContent className="p-5">
                            <div className="flex items-center gap-2 mb-3">
                                <Badge className="bg-blue-600 text-white text-xs">Scénario 4</Badge>
                                <h3 className="font-semibold text-slate-900">Perdu après retour : 993 → 900 → retour 993 → appelant raccroche</h3>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Parcours</p>
                                    <div className="space-y-1 text-sm">
                                        <p className="text-slate-600">1. Externe → Script → <strong>Queue 993</strong> → timeout (174, 164)</p>
                                        <p className="text-slate-600">2. Overflow → Script → <strong>Queue 900</strong> → Céline (106) répond ✅</p>
                                        <p className="text-slate-600">3. Céline transfère → Filip (174) → pas répondu</p>
                                        <p className="text-slate-600">4. Ring group → Script → <strong>Queue 993</strong> → Filip (174), Aude (164) sonnent</p>
                                        <p className="text-slate-600">5. <strong>Appelant raccroche</strong> (terminated_by_originator) pendant l'attente</p>
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Comptabilisation pour 993</p>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex items-center gap-2">
                                            <span className="text-slate-400">Répondu : 0</span>
                                            <span className="text-slate-400">— aucun collaborateur 993 n'a décroché</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-red-600 font-bold">Perdu : 1</span>
                                            <span className="text-slate-400">— appelant a raccroché dans 993</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-slate-400">Débordé : 0</span>
                                            <span className="text-slate-400">— "Perdu" annule "Débordé"</span>
                                        </div>
                                    </div>
                                    <div className="mt-3 bg-slate-50 rounded p-3 border border-slate-200">
                                        <p className="text-xs text-slate-600">
                                            <strong>Règle :</strong> Si l'appelant raccroche dans la file, c'est "Perdu", même si l'appel était précédemment allé ailleurs. Le résultat final prime.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Résumé des règles */}
                    <Card>
                        <CardContent className="p-6">
                            <h4 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                                <FileText className="h-4 w-4 text-blue-600" />
                                Résumé des règles de comptage
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-200">
                                    <h5 className="font-semibold text-emerald-900 mb-2">Répondu ✅</h5>
                                    <p className="text-sm text-emerald-800">
                                        Un agent de la file a décroché, peu importe le parcours (file ou direct, 1er ou 2ème passage).
                                    </p>
                                </div>
                                <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                                    <h5 className="font-semibold text-red-900 mb-2">Perdu ❌</h5>
                                    <p className="text-sm text-red-800">
                                        File abandonnée (appelant raccroche) OU direct non répondu (y compris forward_all, occupation).
                                    </p>
                                </div>
                                <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
                                    <h5 className="font-semibold text-amber-900 mb-2">Débordé ↗️</h5>
                                    <p className="text-sm text-amber-800">
                                        Appel sorti de la file SANS y être traité ET sans y revenir. Si l'appel revient et est traité → annulé.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </section>

                {/* Footer */}
                <div className="text-center text-xs text-slate-400 pt-8 pb-4">
                    Documentation technique — GRR Stats 3CX
                    <br />
                    Dernière mise à jour : août 2026
                </div>
            </div>
        </div>
    );
}
