"use client";

import { useState } from "react";
import { FileTreeExplorer } from "@/components/file-tree";
import type { FileNode } from "@/components/file-tree";
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
    GitBranch,
    FileText,
    ArrowRight,
    Box,
    HelpCircle,
    ChevronRight,
    FolderOpen,
    BookOpen,
    Search,
    TrendingUp,
    AlertTriangle,
} from "lucide-react";

// ============================================
// ARBORESCENCE DU PROJET AVEC DOCUMENTATION
// ============================================

const projectTree: FileNode[] = [
    {
        name: "frontend",
        type: "folder",
        shortDesc: "Application Next.js complète (frontend + API)",
        details: {
            role: "Contient l'ensemble de l'application. Next.js regroupe ici le frontend (pages, composants) et le backend (API routes, Server Actions) dans un seul projet. Cette unification simplifie le déploiement et la communication entre le client et le serveur.",
            dependencies: ["Nécessite Docker pour l'exécution en production", "Dépend de la base PostgreSQL définie dans docker-compose.yml"],
            example: "C'est dans ce dossier que vous passerez 90% de votre temps si vous modifiez l'application.",
        },
        children: [
            {
                name: "app",
                type: "folder",
                shortDesc: "Routage App Router de Next.js 15",
                details: {
                    role: "Dossier central du routage dans Next.js. Chaque sous-dossier correspond à une URL. Le système App Router permet de créer des pages tout en gérant le chargement des données côté serveur avant l'affichage.",
                    dependencies: ["Composants dans components/", "Services dans services/ (via Server Actions)"],
                    example: "Le dossier app/(authenticated)/statistics/page.tsx correspond à l'URL /statistics affichant les statistiques par file d'attente.",
                    pitfalls: "Ne pas confondre les Server Components (affichage de données) et les Client Components (interactions utilisateur). Les fichiers page.tsx sont par défaut des Server Components.",
                },
                children: [
                    {
                        name: "(authenticated)",
                        type: "folder",
                        shortDesc: "Groupe de routes protégées par authentification",
                        details: {
                            role: "Regroupe toutes les pages nécessitant une connexion (dashboard, statistiques, logs, paramètres). Le nom entre parenthèses signifie qu'il ne crée pas de segment dans l'URL. Le layout.tsx interne contient la barre latérale et l'en-tête communs.",
                            dependencies: ["middleware.ts (protection des routes)", "lib/auth.ts (vérification de session)"],
                            example: "Toutes les routes /dashboard, /statistics, /admin/logs partagent le même layout avec sidebar et header.",
                        },
                        children: [
                            {
                                name: "dashboard",
                                type: "folder",
                                shortDesc: "Page d'accueil avec KPIs globaux",
                                details: {
                                    role: "Première page affichée après connexion. Présente une vue synthétique de l'activité téléphonique : volume d'appels, taux de réponse, tendances temporelles, heatmap des heures d'affluence.",
                                    dependencies: ["services/dashboard.service.ts (données globales)", "components/calls-chart.tsx, heatmap-chart.tsx (graphiques)"],
                                    example: "Le manager arrive ici le matin et visualise en un coup d'œil si la veille a été bien couverte.",
                                },
                            },
                            {
                                name: "statistics",
                                type: "folder",
                                shortDesc: "Statistiques détaillées par file d'attente",
                                details: {
                                    role: "Page d'analyse approfondie par file d'attente (queue). Affiche le donut de répartition (répondus / abandonnés / redirigés), le tableau de performance des agents, et les tendances journalières / horaires. C'est la page la plus consultée par les managers.",
                                    dependencies: ["services/queue-statistics.service.ts", "components/stats/unified-call-flow.tsx (donut)", "components/stats/agent-performance-table.tsx"],
                                    example: "Sélectionner la queue 'Réception RC 993' pour voir que 210 appels ont été reçus, dont 187 répondus (89%).",
                                    pitfalls: "Les chiffres affichés ici utilisent la logique des 'appels uniques' (voir section Décisions métier). Ne pas les confondre avec les 'passages' qui apparaissent comme information secondaire.",
                                },
                            },
                            {
                                name: "queues",
                                type: "folder",
                                shortDesc: "Explorateur de files d'attente et agents",
                                details: {
                                    role: "Page permettant de parcourir les différentes files d'attente du système et de voir rapidement leur composition (agents membres).",
                                    dependencies: ["services/queues.service.ts"],
                                    example: "Permet de découvrir que la queue 905 contient les agents du service transport.",
                                },
                            },
                            {
                                name: "diagnostic",
                                type: "folder",
                                shortDesc: "Outil de diagnostic interne",
                                details: {
                                    role: "Outil technique de vérification de la cohérence des données. Compare les résultats obtenus par le SQL du dashboard avec la logique TypeScript des logs. Affiche le taux de correspondance et les divergences éventuelles.",
                                    dependencies: ["services/diagnostic.service.ts", "app/api/diagnostic/route.ts"],
                                    example: "Lancer un diagnostic sur la semaine dernière pour vérifier que le dashboard et les logs comptent bien le même nombre d'appels répondus.",
                                    pitfalls: "Cette page est réservée à l'administration technique. Elle consomme beaucoup de ressources PostgreSQL car elle analyse l'ensemble des CDR sur la période.",
                                },
                            },
                            {
                                name: "admin",
                                type: "folder",
                                shortDesc: "Espace d'administration",
                                details: {
                                    role: "Contient les pages réservées au rôle ADMIN : audit des logs complets, gestion des utilisateurs (création, modification, suppression), et paramètres système.",
                                    dependencies: ["middleware.ts (restriction rôle ADMIN)", "app/(authenticated)/admin/users/actions.ts"],
                                    example: "L'administrateur crée un compte manager@grr.ch avec le rôle SUPERUSER depuis la page /admin/users.",
                                },
                                children: [
                                    {
                                        name: "logs",
                                        type: "folder",
                                        shortDesc: "Audit détaillé des CDR",
                                        details: {
                                            role: "Page d'audit la plus complète. Affiche un tableau agrégé (un appel = une ligne) avec filtres avancés : dates, direction, statut, durée, temps d'attente, file d'attente, parcours (journey), nombre de segments. Permet l'export CSV et la visualisation du SQL généré.",
                                            dependencies: ["services/logs.service.ts (requêtes SQL complexes)", "components/logs-table.tsx", "components/call-chain-modal.tsx"],
                                            example: "Filtrer les appels de la queue 993 abandonnés après plus de 30 secondes d'attente, entre le 1er et le 15 mars.",
                                            pitfalls: "La requête SQL générée peut être très lourde selon les filtres. Toujours limiter la plage de dates.",
                                        },
                                    },
                                    {
                                        name: "users",
                                        type: "folder",
                                        shortDesc: "Gestion des utilisateurs",
                                        details: {
                                            role: "Interface de gestion des comptes utilisateurs : création, modification du rôle (ADMIN / SUPERUSER / USER), réinitialisation de mot de passe, suppression.",
                                            dependencies: ["lib/auth.ts (hachage bcrypt)", "prisma/schema.prisma (modèle User)"],
                                        },
                                    },
                                    {
                                        name: "settings",
                                        type: "folder",
                                        shortDesc: "Paramètres de l'application",
                                        details: {
                                            role: "Page de configuration des paramètres globaux de l'application.",
                                        },
                                    },
                                ],
                            },
                            {
                                name: "layout.tsx",
                                type: "file",
                                shortDesc: "Layout partagé sidebar + header",
                                details: {
                                    role: "Définit la structure visuelle commune à toutes les pages authentifiées : barre latérale à gauche, en-tête en haut, zone de contenu centrale. Vérifie également la session utilisateur et redirige vers /login si nécessaire.",
                                    dependencies: ["components/sidebar.tsx", "components/header.tsx", "lib/auth.ts"],
                                },
                            },
                        ],
                    },
                    {
                        name: "api",
                        type: "folder",
                        shortDesc: "Routes API REST",
                        details: {
                            role: "Points d'entrée API pour les appels externes ou internes. Bien que la plupart des données transitent par des Server Actions (plus direct), certaines fonctionnalités comme le diagnostic nécessitent une API dédiée.",
                        },
                        children: [
                            {
                                name: "auth",
                                type: "folder",
                                shortDesc: "Endpoints NextAuth",
                                details: {
                                    role: "Gère les requêtes de connexion et déconnexion. NextAuth crée automatiquement les routes /api/auth/signin, /api/auth/signout, /api/auth/session, etc.",
                                    dependencies: ["lib/auth.ts (configuration NextAuth)"],
                                },
                            },
                            {
                                name: "diagnostic",
                                type: "folder",
                                shortDesc: "Endpoint de diagnostic",
                                details: {
                                    role: "API POST qui reçoit une plage de dates et retourne le résultat du diagnostic de cohérence (voir diagnostic.service.ts).",
                                    dependencies: ["services/diagnostic.service.ts"],
                                },
                            },
                        ],
                    },
                    {
                        name: "login",
                        type: "folder",
                        shortDesc: "Page de connexion",
                        details: {
                            role: "Interface de connexion par email et mot de passe. Utilise les Credentials de NextAuth avec vérification bcrypt. Redirige automatiquement vers /dashboard si l'utilisateur est déjà connecté.",
                            dependencies: ["lib/auth.ts", "next-auth/react (signIn)"],
                        },
                    },
                    {
                        name: "page.tsx",
                        type: "file",
                        shortDesc: "Page racine",
                        details: {
                            role: "Page d'accueil de l'application (URL /). Redirige automatiquement vers /dashboard pour les utilisateurs connectés ou /login pour les visiteurs.",
                        },
                    },
                    {
                        name: "layout.tsx",
                        type: "file",
                        shortDesc: "Layout racine",
                        details: {
                            role: "Définit la structure HTML de base (balises <html>, <body>), charge la police Inter, applique les styles globaux et définit les métadonnées SEO (titre, description).",
                            dependencies: ["app/globals.css"],
                        },
                    },
                    {
                        name: "globals.css",
                        type: "file",
                        shortDesc: "Styles globaux Tailwind",
                        details: {
                            role: "Fichier CSS central qui importe Tailwind (base, composants, utilitaires) et définit les variables CSS personnalisées (couleurs, rayons de bordure).",
                        },
                    },
                ],
            },
            {
                name: "components",
                type: "folder",
                shortDesc: "Composants React réutilisables",
                details: {
                    role: "Regroupe tous les éléments d'interface réutilisables. Séparés en trois catégories : composants génériques UI (boutons, tableaux), composants métier stats (donut, agents), et composants spécifiques logs (filtres, tableaux).",
                    dependencies: ["Dépend de lib/utils.ts pour les classes conditionnelles"],
                },
                children: [
                    {
                        name: "ui",
                        type: "folder",
                        shortDesc: "Composants Shadcn/ui",
                        details: {
                            role: "Bibliothèque de composants primitives accessibles et stylisés : boutons, badges, dialogues, tableaux, menus déroulants, calendriers, etc. Basés sur Radix UI (gestion du focus, accessibilité clavier) et stylisés avec Tailwind.",
                            example: "Le composant <Button variant='outline'> est utilisé partout dans l'application pour garantir la cohérence visuelle.",
                        },
                    },
                    {
                        name: "stats",
                        type: "folder",
                        shortDesc: "Composants de statistiques",
                        details: {
                            role: "Composants spécifiques à la page /statistics : sélecteur de queue, donut de flux d'appels, tableau de performance agents, tendances journalières/horaires, bandeau bilan d'équipe.",
                            dependencies: ["services/queue-statistics.service.ts", "types/statistics.types.ts"],
                            example: "unified-call-flow.tsx affiche le donut avec les liens cliquables vers les logs préfiltrés.",
                        },
                    },
                    {
                        name: "column-filters",
                        type: "folder",
                        shortDesc: "Filtres du tableau de logs",
                        details: {
                            role: "Composants de filtrage pour chaque colonne du tableau logs : input texte, sélecteur de dates, plage numérique (durée, attente), sélecteur de direction, sélecteur de statut, filtre de parcours (journey), etc.",
                            example: "ColumnFilterJourney.tsx permet de construire des conditions complexes comme 'a passé par la queue 903 puis a été transféré'.",
                        },
                    },
                    {
                        name: "logs-table.tsx",
                        type: "file",
                        shortDesc: "Tableau principal des logs",
                        details: {
                            role: "Composant central de la page /admin/logs. Affiche les appels agrégés (un appel = une ligne) avec les colonnes configurables. Gère l'état de chargement (skeletons), le tri colonne, et les états vides.",
                            dependencies: ["components/ui/table.tsx", "column-filters/*", "types/logs.types.ts"],
                            pitfalls: "Ce composant reçoit énormément de props (filtres + callbacks). Toute modification des filtres doit être synchronisée avec la page parente qui gère l'URL.",
                        },
                    },
                    {
                        name: "sidebar.tsx",
                        type: "file",
                        shortDesc: "Barre de navigation latérale",
                        details: {
                            role: "Menu de navigation fixe à gauche. Affiche les liens vers Dashboard, Statistiques, Queues, Logs, Utilisateurs, Paramètres. Masque les liens admin si l'utilisateur n'a pas le rôle ADMIN.",
                            dependencies: ["lib/auth.ts (rôle utilisateur)"],
                        },
                    },
                    {
                        name: "header.tsx",
                        type: "file",
                        shortDesc: "En-tête de page",
                        details: {
                            role: "Bandeau supérieur affichant le nom de l'application, l'email de l'utilisateur connecté, et le bouton de déconnexion.",
                        },
                    },
                    {
                        name: "call-chain-modal.tsx",
                        type: "file",
                        shortDesc: "Modale de détail d'appel",
                        details: {
                            role: "Fenêtre modale qui s'affiche au clic sur un appel dans le tableau logs. Montre le parcours complet CDR segment par segment avec horodatage, durée, type de destination, et raison de terminaison.",
                            dependencies: ["services/repositories/cdr.repository.ts (getCallSegments)"],
                            example: "Visualiser qu'un appel a transité par : Provider -> Queue 993 -> Extension 593 (répondu) -> Transfert -> Extension 610 (répondu).",
                        },
                    },
                ],
            },
            {
                name: "lib",
                type: "folder",
                shortDesc: "Utilitaires et configuration",
                details: {
                    role: "Couche d'infrastructure et outils transversaux. Contient la configuration de l'authentification, le client de base de données, et les fonctions utilitaires réutilisables.",
                },
                children: [
                    {
                        name: "auth.ts",
                        type: "file",
                        shortDesc: "Configuration NextAuth",
                        details: {
                            role: "Définit le système d'authentification : stratégie JWT, provider Credentials (email + mot de passe avec bcrypt), callbacks pour enrichir le token avec le rôle, et page de connexion personnalisée (/login).",
                            dependencies: ["prisma/schema.prisma (table User)", "bcryptjs (hachage)"],
                            pitfalls: "Le secret JWT (NEXTAUTH_SECRET) doit être défini en production. Ne jamais utiliser la valeur par défaut.",
                        },
                    },
                    {
                        name: "prisma.ts",
                        type: "file",
                        shortDesc: "Client Prisma singleton",
                        details: {
                            role: "Crée et exporte une instance unique du client Prisma pour éviter les connexions multiples à la base de données en développement (hot reload).",
                            dependencies: ["prisma/schema.prisma", "@prisma/client"],
                            pitfalls: "Ne jamais instancier @prisma/client directement dans un autre fichier. Toujours importer depuis lib/prisma.ts.",
                        },
                    },
                    {
                        name: "utils.ts",
                        type: "file",
                        shortDesc: "Fonctions utilitaires",
                        details: {
                            role: "Contient la fonction cn() qui fusionne les classes CSS conditionnelles (utilisée par tous les composants UI) et d'autres helpers transversaux.",
                        },
                    },
                    {
                        name: "use-debounce.ts",
                        type: "file",
                        shortDesc: "Hook de debounce",
                        details: {
                            role: "Hook React qui retarde l'exécution d'une fonction (ex: recherche texte) pour éviter de lancer une requête à chaque frappe clavier. Utilisé dans la page logs pour les champs de recherche.",
                            example: "Dans les logs, la recherche par numéro d'appelant attend 500ms après la dernière frappe avant de lancer la requête.",
                        },
                    },
                ],
            },
            {
                name: "services",
                type: "folder",
                shortDesc: "Logique métier (Server Actions)",
                details: {
                    role: "Cœur métier de l'application. Contient les Server Actions (fonctions exécutées côté serveur appelées par les composants), les repositories (accès SQL), et le domaine (logique pure).",
                    dependencies: ["lib/prisma.ts", "types/*"],
                },
                children: [
                    {
                        name: "repositories",
                        type: "folder",
                        shortDesc: "Pattern Repository",
                        details: {
                            role: "Principe fondamental de l'architecture : seul ce dossier exécute du SQL brut. Les repositories retournent des données brutes typées. Les services (dossier parent) font l'orchestration et la transformation métier.",
                            example: "cdr.repository.ts contient toutes les requêtes SQL complexes sur la table cdroutput. Si vous modifiez la logique de comptage des appels, c'est ici.",
                            pitfalls: "Ne jamais écrire de SQL dans un autre fichier que le repository. Cela garantit la cohérence entre dashboard et logs.",
                        },
                        children: [
                            {
                                name: "cdr.repository.ts",
                                type: "file",
                                shortDesc: "Accès SQL aux CDR",
                                details: {
                                    role: "Source unique de vérité pour l'accès aux données d'appels. Contient les CTEs SQL complexes pour calculer les métriques globales, les KPIs par queue, les tendances, les membres de queue, et les segments individuels.",
                                    dependencies: ["lib/prisma.ts", "services/domain/call-aggregation.ts (constantes SQL)"],
                                    example: "getQueueKpisRaw() calcule en une requête SQL : appels reçus, répondus, abandonnés, redirigés, temps d'attente moyen, temps de conversation moyen.",
                                    pitfalls: "C'est le fichier le plus critique de l'application. Toute modification doit être suivie d'un test via la page Diagnostic.",
                                },
                            },
                        ],
                    },
                    {
                        name: "domain",
                        type: "folder",
                        shortDesc: "Logique métier pure",
                        details: {
                            role: "Code métier indépendant de la technologie. Définit comment déterminer le statut d'un appel (answered / missed / voicemail / busy), sa direction (inbound / outbound / internal / bridge), et sa catégorie. C'est la 'Single Source of Truth' métier.",
                            example: "La fonction determineCallStatus() est utilisée à la fois par les logs (TypeScript) et le dashboard (SQL) pour garantir que les deux comptent pareil.",
                        },
                        children: [
                            {
                                name: "call-aggregation.ts",
                                type: "file",
                                shortDesc: "Règles métier d'appels",
                                details: {
                                    role: "Fichier le plus important pour la cohérence des données. Définit : les types système (queue, IVR, ring_group), la détermination du statut final, la détermination de la direction, la catégorisation des segments, et les helpers SQL.",
                                    dependencies: ["Utilisé par logs.service.ts, cdr.repository.ts, diagnostic.service.ts"],
                                    pitfalls: "NE JAMAIS DUPLIQUER cette logique ailleurs. Si vous modifiez une règle ici, elle s'applique partout. Sinon, le dashboard et les logs afficheront des chiffres différents.",
                                },
                            },
                            {
                                name: "call.types.ts",
                                type: "file",
                                shortDesc: "Types du domaine",
                                details: {
                                    role: "Définitions TypeScript des structures de données métier : CallStatus, CallDirection, SegmentCategory, et les interfaces de segments.",
                                },
                            },
                        ],
                    },
                    {
                        name: "dashboard.service.ts",
                        type: "file",
                        shortDesc: "Métriques globales",
                        details: {
                            role: "Ordonnance les appels au repository pour calculer les indicateurs du dashboard : appels totaux, répondus, manqués, voicemail, occupés, durée moyenne, temps d'attente moyen. Compare également avec la période précédente pour afficher les évolutions.",
                            dependencies: ["services/repositories/cdr.repository.ts"],
                            example: "Pour la période 01-15 mars, calcule les métriques et les compare avec la période 14-28 février.",
                        },
                    },
                    {
                        name: "queue-statistics.service.ts",
                        type: "file",
                        shortDesc: "Statistiques par queue",
                        details: {
                            role: "Agrège les données d'une file d'attente spécifique : KPIs (donut), performance des agents, tendances journalières et horaires. Formate les données brutes du repository pour l'affichage dans les composants stats.",
                            dependencies: ["services/repositories/cdr.repository.ts", "services/domain/call.types.ts"],
                            example: "Pour la queue 993 sur mars 2026 : calcule les 210 appels uniques, 187 répondus, les 8 agents et leurs scores.",
                        },
                    },
                    {
                        name: "logs.service.ts",
                        type: "file",
                        shortDesc: "Requêtes logs CDR",
                        details: {
                            role: "Construit et exécute les requêtes SQL complexes pour la page logs. Gère la pagination, le tri, et la dizaine de filtres possibles (dates, direction, statut, durée, attente, créneaux horaires, parcours, etc.). Export CSV et génération SQL pour debug.",
                            dependencies: ["lib/prisma.ts", "services/domain/call-aggregation.ts"],
                            pitfalls: "Contient ~1000 lignes de SQL dynamique. C'est la partie la plus complexe et la plus sensible de l'application. Toute modification des filtres doit être testée sur plusieurs scénarios.",
                        },
                    },
                    {
                        name: "diagnostic.service.ts",
                        type: "file",
                        shortDesc: "Diagnostic de cohérence",
                        details: {
                            role: "Service qui compare les résultats du SQL du dashboard avec la logique TypeScript des logs. Identifie les divergences appel par appel et calcule le taux de correspondance. Essentiel pour maintenir la confiance dans les chiffres.",
                            dependencies: ["services/dashboard.service.ts", "services/domain/call-aggregation.ts"],
                            example: "Sur une semaine de 4200 appels, le diagnostic indique un taux de correspondance de 99.98%. Les 6 divergences sont affichées avec détail.",
                        },
                    },
                    {
                        name: "queues.service.ts",
                        type: "file",
                        shortDesc: "Gestion des queues",
                        details: {
                            role: "Fournit la liste des files d'attente et leurs membres en analysant les CDR historiques pour découvrir les relations queue/agent.",
                        },
                    },
                ],
            },
            {
                name: "types",
                type: "folder",
                shortDesc: "Définitions TypeScript",
                details: {
                    role: "Définitions de types globales utilisées par les composants et services. Séparés du dossier services/domain/ qui contient les types métier spécifiques.",
                    pitfalls: "Il existe un chevauchement partiel avec services/domain/call.types.ts. C'est une dette technique connue à rationaliser à terme.",
                },
                children: [
                    {
                        name: "logs.types.ts",
                        type: "file",
                        shortDesc: "Types logs et filtres",
                        details: {
                            role: "Interfaces pour les appels agrégés, les filtres de recherche, le tri, la visibilité des colonnes, et les conditions de parcours (journey).",
                        },
                    },
                    {
                        name: "statistics.types.ts",
                        type: "file",
                        shortDesc: "Types statistiques",
                        details: {
                            role: "Interfaces pour les KPIs de queue, les performances agents, et les tendances.",
                        },
                    },
                    {
                        name: "queues.types.ts",
                        type: "file",
                        shortDesc: "Types files d'attente",
                        details: {
                            role: "Interfaces pour les informations de files d'attente et leurs membres.",
                        },
                    },
                    {
                        name: "next-auth.d.ts",
                        type: "file",
                        shortDesc: "Extensions NextAuth",
                        details: {
                            role: "Étend les types natifs de NextAuth pour ajouter le champ 'role' à l'utilisateur et au token JWT.",
                        },
                    },
                ],
            },
            {
                name: "prisma",
                type: "folder",
                shortDesc: "Base de données",
                details: {
                    role: "Contient le schéma Prisma (définition des tables) et le script de seed (données initiales). Prisma génère automatiquement le client TypeScript à partir du schéma.",
                },
                children: [
                    {
                        name: "schema.prisma",
                        type: "file",
                        shortDesc: "Schéma Prisma",
                        details: {
                            role: "Définit la structure de la base de données PostgreSQL : modèle User (authentification), modèles cdroutput et cdrbilling (données 3CX), enum Role. Définit également les index pour optimiser les requêtes.",
                            example: "Index sur cdr_started_at et destination_dn_number pour accélérer les filtres par date et par file d'attente.",
                        },
                    },
                    {
                        name: "seed.ts",
                        type: "file",
                        shortDesc: "Données initiales",
                        details: {
                            role: "Script exécuté une fois pour créer les comptes utilisateurs de test (admin, manager, user) avec leurs mots de passe hashés.",
                            dependencies: ["bcryptjs (hachage)"],
                        },
                    },
                ],
            },
            {
                name: "middleware.ts",
                type: "file",
                shortDesc: "Protection des routes",
                details: {
                    role: "Fonction exécutée à chaque requête HTTP avant l'affichage de la page. Redirige vers /login si l'utilisateur n'est pas connecté. Redirige vers /dashboard si un utilisateur non-ADMIN tente d'accéder à /admin.",
                    dependencies: ["lib/auth.ts"],
                    pitfalls: "Les routes /api et les fichiers statiques sont exclues du matcher pour éviter de bloquer les appels internes.",
                },
            },
            {
                name: "next.config.mjs",
                type: "file",
                shortDesc: "Configuration Next.js",
                details: {
                    role: "Configuration du framework : paramètres de build, configuration des images, variables d'environnement exposées côté client, et options expérimentales.",
                },
            },
            {
                name: "tailwind.config.ts",
                type: "file",
                shortDesc: "Configuration Tailwind",
                details: {
                    role: "Personnalisation du framework CSS : palette de couleurs, espacements, breakpoints responsive, et plugins. Intègre également les classes personnalisées de Shadcn/ui.",
                },
            },
            {
                name: "package.json",
                type: "file",
                shortDesc: "Dépendances et scripts",
                details: {
                    role: "Liste exhaustive des librairies utilisées et des scripts disponibles (dev, build, db:push, db:seed, lint).",
                    example: "npm run db:studio lance Prisma Studio pour inspecter la base de données via une interface graphique.",
                },
            },
        ],
    },
    {
        name: "docker-compose.yml",
        type: "file",
        shortDesc: "Docker production",
        details: {
            role: "Définit les services Docker pour l'environnement de production : container Next.js et container PostgreSQL. Gère les volumes, les ports exposés, et les variables d'environnement.",
        },
    },
    {
        name: "docker-compose.dev.yml",
        type: "file",
        shortDesc: "Docker développement",
        details: {
            role: "Configuration Docker pour le développement local. Active le hot reload (rechargement automatique à la modification du code) et monte le code source comme volume.",
            example: "docker-compose -f docker-compose.dev.yml up --build démarre l'environnement complet en quelques secondes.",
        },
    },
    {
        name: "DECISIONS.md",
        type: "file",
        shortDesc: "Journal des décisions",
        details: {
            role: "Document de référence recensant l'ensemble des décisions métier et architecturales prises durant le développement. Chaque décision contient le problème, la solution retenue, les alternatives écartées, et la justification.",
            example: "Décision 1.8 : pourquoi les appels uniques sont la métrique principale plutôt que les passages.",
            pitfalls: "Ce fichier est la mémoire du projet. Le consulter avant toute modification de logique de comptage.",
        },
    },
    {
        name: "README.md",
        type: "file",
        shortDesc: "Guide de démarrage",
        details: {
            role: "Instructions pour cloner, installer et démarrer le projet. Contient également la liste des utilisateurs de test et les commandes Docker courantes.",
        },
    },
];

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
        justification: "Ce n'est pas un cas exceptionnel mais un comportement quotidien (ex: client appuie 2, parle au mauvais service, retourne à la réception, est redirigé correctement). Masquer ce phénomène sous-estime la charge réelle des agents.",
        impact: "Le taux de ping-pong (passages supplémentaires / total passages) devient un KPI stratégique pour identifier les problèmes de routage. Exemple : 3.8% sur la queue 993 = bon routage ; 37.5% sur une autre = problème à investiguer.",
    },
    {
        id: "1.2",
        category: "Statistiques Queue",
        title: "Distinction répondus vs transférés",
        date: "Initial",
        summary: "Un appel transféré par un agent est comptabilisé comme 'répondu' dans le donut. Le nombre de transferts apparaît séparément comme information complémentaire.",
        justification: "L'appel a bien été décroché : le client n'est pas resté sans interlocuteur. Le transfert est une action volontaire de l'agent après avoir pris l'appel. Séparer 'transférés' comme catégorie à part créerait un donut dont la somme des parts dépasserait 100%.",
        impact: "Le taux de réponse de la queue n'est pas artificiellement gonflé ni dégonflé. Les transferts sont visibles dans le tableau agents (colonne abandonnée au profit du format X/Total).",
    },
    {
        id: "1.9",
        category: "Statistiques Queue",
        title: "Bandeau 'Bilan de l'équipe'",
        date: "3 mars 2026",
        summary: "Bandeau affiché au-dessus du donut combinant les appels queue et les appels directs de l'équipe, avec leurs taux respectifs.",
        justification: "Un agent peu actif en queue peut être très chargé en directs. Sans cette vue d'ensemble, le manager pourrait conclure à tort qu'un agent est inactif.",
        impact: "Affichage : '89 appels répondus · Queue: 42/55 (76%) · Directs: 47/55 (85%)'. Le manager dispose d'une vision consolidée de l'activité totale.",
    },
    {
        id: "1.6",
        category: "Statistiques Queue",
        title: "Redirections = Overflow automatique",
        date: "Initial",
        summary: "Différenciation stricte entre 'redirigé' (débordement automatique du système : timeout, règle de routage) et 'transféré' (action manuelle d'un agent après avoir décroché).",
        justification: "Ce sont deux mécanismes fondamentalement différents : automatique vs volontaire. Le manager doit pouvoir distinguer 'personne n'a répondu' de 'l'agent a répondu puis a choisi de transférer'.",
        impact: "Les appels redirigés vers une autre queue apparaissent dans la catégorie 'Redirigés' (orange) du donut. Les transferts manuels restent dans 'Répondus'.",
    },
    {
        id: "1.5",
        category: "Statistiques Queue",
        title: "Exclusion des destinations techniques",
        date: "Initial",
        summary: "Les transferts pointant vers des entrées techniques (ring groups, IVR) sont exclus du comptage des transferts affichés.",
        justification: "Ces destinations sont des artefacts du système 3CX, pas des actions volontaires d'un agent. Les inclure fausserait le comptage des 'vrais' transferts vers des personnes.",
        impact: "Seuls les transferts vers des extensions ou des queues externes sont comptabilisés comme tels.",
    },
    {
        id: "2.1",
        category: "Performance Agents",
        title: "Absence de taux de réponse individuel sur la queue",
        date: "Initial",
        summary: "Le tableau agents n'affiche pas de 'taux de réponse' basé sur les appels queue car ce chiffre est structurellement biaisé à la baisse.",
        justification: "Dans une queue à 9 agents, chaque appel fait sonner ~5 agents simultanément. Une agent peut recevoir 534 sonneries et n'en décrocher que 116 (22%). Mais les 418 autres ont été décrochées par des collègues : elle ne les a pas 'ratées'. Afficher 22% serait trompeur.",
        impact: "Le taux de réponse individuel est remplacé par le Score de performance (0-100) qui compare le volume relatif à la moyenne de l'équipe.",
    },
    {
        id: "2.3",
        category: "Performance Agents",
        title: "Score de performance (0-100)",
        date: "Initial",
        summary: "Score composite calculé sur chaque agent : 60% volume relatif (appels traités / moyenne équipe, plafonné à 60 points) + 40% réactivité directe (taux de décroché sur les appels directs).",
        justification: "Le volume est relatif à la moyenne de l'équipe : un agent à mi-temps n'est pas pénalisé par rapport à un temps plein. La réactivité directe est un ratio individuel non dilué par le partage de la queue.",
        impact: "Un agent sans appel direct reçoit les 40 points de réactivité (pas de pénalisation). Score < 40 = signal d'attention ; 40-69 = moyenne ; 70-100 = performant.",
    },
    {
        id: "2.9",
        category: "Performance Agents",
        title: "Résolveur Final",
        date: "3 mars 2026",
        summary: "Quand un appel passe plusieurs fois par la même queue et est décroché par différents agents, seul le dernier agent à décrocher est crédité dans la colonne 'Queue (résolu)'.",
        justification: "C'est le dernier agent qui a effectivement résolu la demande du client. Cette règle garantit l'invariant mathématique : la somme des colonnes 'Queue (résolu)' des agents = le nombre dans le donut 'Répondus'.",
        impact: "Cohérence parfaite entre le donut et le tableau agents. Le manager ne voit jamais de divergence entre les deux vues.",
    },
    {
        id: "2.7",
        category: "Performance Agents",
        title: "Transferts reçus = Appels directs",
        date: "Initial",
        summary: "Un appel transféré vers un agent (qu'il provienne d'une autre queue ou du sein de la même queue) est comptabilisé comme un appel direct pour l'agent receveur.",
        justification: "Du point de vue de la charge de travail de l'agent receveur, un transfert et un direct sont identiques : il décroche et traite la demande. Côté queue, l'appel reste crédité à l'agent initial (pas de double comptage).",
        impact: "La jauge de charge et le score reflètent fidèlement le travail réel de chaque agent, quelle que soit l'origine de l'appel.",
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

const decisionCategories = Array.from(new Set(decisions.map((d) => d.category)));

// ============================================
// FAQ RESPONSABLE
// ============================================

interface FAQItem {
    question: string;
    answer: string;
    tag?: string;
}

const faqItems: FAQItem[] = [
    {
        question: "Pourquoi avons-nous développé une application sur mesure plutôt que d'utiliser Power BI ou Tableau ?",
        answer: "Les outils de BI généralistes ne comprennent pas la logique métier spécifique du CDR 3CX : le phénomène de ping-pong (passages multiples), la distinction entre overflow automatique et transfert manuel, ou le crédit 'résolveur final'. Une requête SQL standard dans Power BI compterait chaque passage comme un appel distinct, faussant totalement les statistiques. Notre application encode ces règles métier directement dans le code, garantissant des chiffres fiables et actionnables.",
        tag: "Stratégie",
    },
    {
        question: "Pourquoi le nombre d'appels dans les statistiques de queue peut-il différer de celui dans les logs filtrés ?",
        answer: "Normalement, il ne devrait pas y avoir de divergence : cette cohérence est un invariant fondamental de l'application. Si vous observez une différence, il s'agit probablement d'un bug récent. L'application intègre un outil de diagnostic (page /diagnostic) qui compare automatiquement les deux sources et identifie les appels incohérents. Contactez l'administrateur technique pour lancer un diagnostic sur la période concernée.",
        tag: "Données",
    },
    {
        question: "Pourquoi un agent affiche-t-il un score de 22% s'il a décroché 116 appels sur 534 reçus ?",
        answer: "Le tableau agents n'affiche pas de 'taux de réponse individuel sur la queue' car ce chiffre est mathématiquement biaisé. Dans une queue partagée, un seul agent peut décrocher chaque appel. Les 418 autres appels n'ont pas été 'ratés' par l'agent : ils ont été décrochés par des collègues. Le score de performance (0-100) remplace ce taux trompeur par une métrique composite juste : 60% volume relatif à la moyenne de l'équipe + 40% taux de décroché sur les appels directs (ratio individuel non dilué).",
        tag: "Métriques",
    },
    {
        question: "Un appel transféré est-il compté comme 'répondu' ou comme 'transféré' dans le donut ?",
        answer: "Il est compté comme 'répondu'. Le transfert est un sous-ensemble des appels répondus. Le donut raconte l'histoire : '266 appels sont entrés dans la queue -> que sont-ils devenus ?'. Un appel transféré a bien été décroché par un agent avant d'être redirigé. Le nombre de transferts apparaît dans le tableau de performance des agents comme information complémentaire, sans affecter le total du donut.",
        tag: "Métriques",
    },
    {
        question: "Que signifie le taux de ping-pong affiché sous le donut ?",
        answer: "Le ping-pong mesure le pourcentage d'appels qui sont repassés plusieurs fois par la même queue. Exemple : un client appelle, est mal dirigé vers le transport, revient à la réception, est renvoyé vers le bon service. Cela génère 2 passages pour le même appel. Un taux élevé (>15%) indique un problème de routage (IVR confus, scripts d'accueil peu clairs, formation insuffisante). Un taux faible (<5%) indique un bon routage. Ce KPI est stratégique pour optimiser l'expérience client.",
        tag: "Métriques",
    },
    {
        question: "Pourquoi les durées d'attente affichées ne correspondent pas toujours à ce que les agents ressentent ?",
        answer: "Le temps d'attente est calculé comme la durée entre l'entrée dans la queue et le moment où un agent décroche. Cependant, si l'appel passe par plusieurs files (ping-pong), chaque passage génère son propre temps d'attente. Le temps affiché est la moyenne de ces attentes. De plus, le système 3CX ne distingue pas 'en ligne' de 'en pause/DND' dans les CDR. Un agent en pause continue d'être considéré comme disponible pour le calcul des taux de réponse.",
        tag: "Données",
    },
    {
        question: "L'application est-elle sécurisée ? Qui peut accéder aux logs complets ?",
        answer: "L'application utilise l'authentification par JWT (tokens sécurisés) avec hachage bcrypt des mots de passe. Trois niveaux d'accès existent : USER (dashboard personnel), SUPERUSER (dashboard global), et ADMIN (logs complets, gestion des utilisateurs, paramètres). Seuls les utilisateurs avec le rôle ADMIN peuvent accéder à la page /admin/logs contenant l'ensemble des CDR. Les routes sont protégées par un middleware qui redirige automatiquement les utilisateurs non autorisés.",
        tag: "Sécurité",
    },
    {
        question: "Combien de temps les données CDR sont-elles conservées ?",
        answer: "La durée de conservation dépend de la politique de rétention configurée sur le serveur PostgreSQL. L'application elle-même ne supprime aucune donnée. Les requêtes sont optimisées avec des index sur les dates et les numéros de file d'attente pour rester performantes même sur plusieurs années de données. Pour les exports CSV volumineux, il est recommandé de limiter la plage de dates à quelques semaines.",
        tag: "Données",
    },
    {
        question: "Que faire si les chiffres du dashboard semblent incorrects ?",
        answer: "Procédez en trois étapes : (1) Vérifiez que la plage de dates sélectionnée correspond à votre attente. (2) Cliquez sur le KPI concerné dans le dashboard : il redirige vers les logs préfiltrés avec les mêmes critères. Comparez visuellement. (3) Si une divergence persiste, demandez à l'administrateur technique de lancer un diagnostic sur la période via la page /diagnostic. Cet outil compare appel par appel les résultats du dashboard et des logs.",
        tag: "Support",
    },
    {
        question: "L'application peut-elle évoluer pour intégrer d'autres sources de données (CRM, plannings) ?",
        answer: "L'architecture est conçue pour l'évolutivité. Le pattern Repository permet d'ajouter de nouvelles sources sans modifier la logique métier. Par exemple, intégrer les plannings RH permettrait de pondérer le score de performance par le temps de présence réel. Intégrer le CRM permettrait de lier un appel à un dossier client. Ces évolutions nécessitent une phase de spécification pour identifier les champs de jointure et la fréquence de synchronisation.",
        tag: "Évolution",
    },
];

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
    description,
    why,
}: {
    icon: React.ElementType;
    title: string;
    badges: string[];
    description: string;
    why: string;
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
                <p className="text-sm text-slate-500 mb-3">{description}</p>
                <div className="mt-auto">
                    <div className="bg-blue-50 rounded-lg p-3 border border-blue-100 mb-3">
                        <p className="text-xs font-semibold text-blue-900 mb-1">Pourquoi cette technologie ?</p>
                        <p className="text-xs text-blue-800 leading-relaxed">{why}</p>
                    </div>
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
                            <BookOpen className="h-6 w-6 text-white" />
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
                        subtitle="Technologies utilisées et justification de chaque choix"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        <StackCard
                            icon={Layout}
                            title="Frontend"
                            badges={["Next.js 15", "React 19", "TypeScript", "Tailwind CSS"]}
                            description="Framework fullstack avec rendu serveur, routage intégré, et typage fort."
                            why="Next.js App Router permet de mélanger Server Components (chargement de données sans JavaScript côté client) et Client Components (interactivité). Cela réduit le volume de code envoyé au navigateur tout en gardant une expérience réactive. Alternative écartée : React pur avec Vite (nécessite un backend séparé et plus de configuration)."
                        />
                        <StackCard
                            icon={Database}
                            title="Base de données"
                            badges={["PostgreSQL", "Prisma ORM", "Raw SQL"]}
                            description="Base relationnelle avec ORM pour le typage et requêtes SQL brutes pour la performance."
                            why="Prisma offre un typage TypeScript automatique et une migration facilitée. Cependant, les requêtes CDR sont trop complexes (CTEs imbriquées, aggrégations JSON) pour être efficacement générées par un ORM. Nous utilisons donc Prisma pour le schéma et les requêtes simples, et du SQL brut optimisé pour les statistiques. Alternative écartée : MongoDB (pas adapté aux jointures complexes du CDR)."
                        />
                        <StackCard
                            icon={Shield}
                            title="Authentification"
                            badges={["NextAuth v5", "JWT", "bcrypt", "Middleware"]}
                            description="Système de connexion sécurisé avec trois niveaux de rôles."
                            why="NextAuth est le standard de fait pour Next.js. Il gère nativement les sessions JWT, le hachage bcrypt, et la protection des routes via middleware. Alternative écartée : Auth0 (coût récurrent et dépendance externe non justifiée pour un usage interne)."
                        />
                        <StackCard
                            icon={Container}
                            title="Infrastructure"
                            badges={["Docker", "Docker Compose", "Node.js 20"]}
                            description="Conteneurisation des environnements dev et production."
                            why="Docker garantit que l'application fonctionne identiquement sur toutes les machines (développement, test, production). Un seul fichier docker-compose suffit à démarrer l'ensemble de la stack (application + base de données)."
                        />
                        <StackCard
                            icon={Box}
                            title="UI & Composants"
                            badges={["Shadcn/ui", "Radix UI", "Lucide Icons", "Recharts"]}
                            description="Design system accessible avec graphiques interactifs."
                            why="Shadcn/ui fournit des composants accessibles (ARIA, clavier, lecteurs d'écran) sans imposer de librairie de style fermée. Les composants sont copiés dans le projet et entièrement personnalisables. Recharts est choisi pour sa simplicité avec React. Alternative écartée : Material UI (trop lourd et difficile à surcharger visuellement)."
                        />
                        <StackCard
                            icon={Server}
                            title="API & Backend"
                            badges={["App Router API", "Server Actions", "Edge Runtime"]}
                            description="Points d'entrée serveur intégrés au framework."
                            why="Les Server Actions de Next.js éliminent le besoin d'une API REST manuelle pour la plupart des opérations. Le code serveur est appelé directement depuis les composants, réduisant la duplication et les erreurs de sérialisation."
                        />
                    </div>
                </section>

                <hr className="border-slate-200" />

                {/* ARCHITECTURE - PARCOURS D'UNE REQUÊTE */}
                <section>
                    <SectionTitle
                        icon={Server}
                        title="Architecture"
                        subtitle="Comprendre le parcours d'une donnée depuis l'écran jusqu'à la base"
                    />
                    <Card>
                        <CardContent className="p-6 space-y-8">
                            <p className="text-sm text-slate-600">
                                Pour illustrer l'architecture, suivons le parcours complet d'une action courante :
                                <strong> une manager consulte les statistiques de la file d'attente 993 pour le mois de mars.</strong>
                            </p>

                            <div className="space-y-6">
                                {/* Step 1 */}
                                <div className="flex gap-4">
                                    <div className="flex flex-col items-center">
                                        <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">1</div>
                                        <div className="w-0.5 flex-1 bg-blue-200 mt-2" />
                                    </div>
                                    <div className="pb-6">
                                        <h4 className="font-semibold text-slate-900">Interface utilisateur</h4>
                                        <p className="text-sm text-slate-600 mt-1">
                                            La manager arrive sur <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">/statistics</code> (fichier <code>app/(authenticated)/statistics/page.tsx</code>).
                                            Elle sélectionne la queue 993 et la période 1-31 mars via les contrôles de filtre.
                                            Le composant React déclenche un appel à la Server Action <code>getQueueStatistics()</code>.
                                        </p>
                                    </div>
                                </div>

                                {/* Step 2 */}
                                <div className="flex gap-4">
                                    <div className="flex flex-col items-center">
                                        <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center text-sm font-bold">2</div>
                                        <div className="w-0.5 flex-1 bg-emerald-200 mt-2" />
                                    </div>
                                    <div className="pb-6">
                                        <h4 className="font-semibold text-slate-900">Couche Service</h4>
                                        <p className="text-sm text-slate-600 mt-1">
                                            Le fichier <code>services/queue-statistics.service.ts</code> reçoit la demande. Il orchestre 5 appels parallèles au repository :
                                            nom de la queue, KPIs (donut), agents, tendance journalière, tendance horaire.
                                            Aucun SQL n'est écrit ici : le service fait uniquement de l'agrégation et du formatage.
                                        </p>
                                    </div>
                                </div>

                                {/* Step 3 */}
                                <div className="flex gap-4">
                                    <div className="flex flex-col items-center">
                                        <div className="w-8 h-8 rounded-full bg-amber-600 text-white flex items-center justify-center text-sm font-bold">3</div>
                                        <div className="w-0.5 flex-1 bg-amber-200 mt-2" />
                                    </div>
                                    <div className="pb-6">
                                        <h4 className="font-semibold text-slate-900">Couche Repository</h4>
                                        <p className="text-sm text-slate-600 mt-1">
                                            Le fichier <code>services/repositories/cdr.repository.ts</code> exécute les requêtes SQL.
                                            Pour les KPIs, il calcule en une seule requête : appels uniques reçus, répondus, abandonnés, redirigés,
                                            temps d'attente moyen, temps de conversation moyen. Les CTEs (Common Table Expressions) PostgreSQL permettent de décomposer la logique complexe en étapes lisibles.
                                        </p>
                                    </div>
                                </div>

                                {/* Step 4 */}
                                <div className="flex gap-4">
                                    <div className="flex flex-col items-center">
                                        <div className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center text-sm font-bold">4</div>
                                        <div className="w-0.5 flex-1 bg-purple-200 mt-2" />
                                    </div>
                                    <div className="pb-6">
                                        <h4 className="font-semibold text-slate-900">Base de données</h4>
                                        <p className="text-sm text-slate-600 mt-1">
                                            PostgreSQL exécute la requête sur la table <code>cdroutput</code> (données CDR 3CX).
                                            Les indexes définis dans <code>prisma/schema.prisma</code> accélèrent le filtrage par date et par numéro de file d'attente.
                                            Pour un mois complet (~60 000 lignes), le temps de réponse est inférieur à 100 ms.
                                        </p>
                                    </div>
                                </div>

                                {/* Step 5 */}
                                <div className="flex gap-4">
                                    <div className="flex flex-col items-center">
                                        <div className="w-8 h-8 rounded-full bg-slate-700 text-white flex items-center justify-center text-sm font-bold">5</div>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-slate-900">Retour et affichage</h4>
                                        <p className="text-sm text-slate-600 mt-1">
                                            Les données remontent le chemin inverse : Repository → Service → Composant.
                                            Le composant <code>UnifiedCallFlow</code> affiche le donut, <code>AgentPerformanceTable</code> le tableau des agents,
                                            et <code>TrendCharts</code> les graphiques journalier et horaire. Les liens du donut redirigent vers les logs préfiltrés avec les mêmes critères.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-slate-50 rounded-lg p-5 border border-slate-200 mt-4">
                                <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                                    Principes fondamentaux
                                </h4>
                                <ul className="space-y-2 text-sm text-slate-600 list-disc list-inside">
                                    <li><strong>Séparation stricte :</strong> le SQL ne se trouve que dans <code>cdr.repository.ts</code>.</li>
                                    <li><strong>Logique métier unique :</strong> <code>call-aggregation.ts</code> est la seule source de vérité pour déterminer si un appel est répondu, manqué, ou redirigé.</li>
                                    <li><strong>Cohérence garantie :</strong> le service <code>diagnostic.service.ts</code> compare automatiquement les résultats SQL et TypeScript pour détecter toute divergence.</li>
                                </ul>
                            </div>
                        </CardContent>
                    </Card>
                </section>

                <hr className="border-slate-200" />

                {/* ARBORESCENCE */}
                <section>
                    <SectionTitle
                        icon={GitBranch}
                        title="Arborescence du projet"
                        subtitle="Cliquez sur un élément pour afficher sa documentation détaillée"
                    />
                    <FileTreeExplorer data={projectTree} />
                </section>

                <hr className="border-slate-200" />

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
                            .filter((d) => d.category === activeDecisionCategory)
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

                {/* GUIDE DU DÉVELOPPEUR */}
                <section>
                    <SectionTitle
                        icon={Box}
                        title="Guide du développeur"
                        subtitle="Référentiel d'intervention pour la maintenance et l'évolution"
                    />
                    <Card>
                        <CardContent className="p-6 space-y-6">
                            <p className="text-sm text-slate-600">
                                Ce guide s'adresse aux développeurs reprenant le projet ou intervenant sur une évolution.
                                Il est structuré par intention plutôt que par technologie.
                            </p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div className="bg-slate-50 rounded-lg p-5 border border-slate-200">
                                    <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                                        <TrendingUp className="h-4 w-4 text-blue-600" />
                                        Je souhaite modifier une métrique affichée
                                    </h4>
                                    <ol className="space-y-2 text-sm text-slate-600 list-decimal list-inside">
                                        <li>Identifier la requête SQL dans <code>services/repositories/cdr.repository.ts</code></li>
                                        <li>Modifier la CTE concernée et vérifier l'impact sur les autres métriques</li>
                                        <li>Mettre à jour les types dans <code>services/domain/call.types.ts</code> si nécessaire</li>
                                        <li>Lancer un diagnostic sur la page /diagnostic pour valider la cohérence</li>
                                        <li>Documenter la modification dans <code>DECISIONS.md</code></li>
                                    </ol>
                                </div>

                                <div className="bg-slate-50 rounded-lg p-5 border border-slate-200">
                                    <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                                        <Search className="h-4 w-4 text-emerald-600" />
                                        Je souhaite ajouter un filtre dans les logs
                                    </h4>
                                    <ol className="space-y-2 text-sm text-slate-600 list-decimal list-inside">
                                        <li>Ajouter le champ dans l'interface <code>LogsFilters</code> (<code>types/logs.types.ts</code>)</li>
                                        <li>Modifier <code>buildAggregatedQueryParts()</code> dans <code>services/logs.service.ts</code></li>
                                        <li>Créer le composant de filtre dans <code>components/column-filters/</code></li>
                                        <li>Intégrer le filtre dans <code>components/logs-table.tsx</code></li>
                                        <li>Ajouter la gestion de l'URL dans <code>app/(authenticated)/admin/logs/page.tsx</code></li>
                                    </ol>
                                </div>

                                <div className="bg-slate-50 rounded-lg p-5 border border-slate-200">
                                    <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                                        Les chiffres du dashboard et des logs divergent
                                    </h4>
                                    <ol className="space-y-2 text-sm text-slate-600 list-decimal list-inside">
                                        <li>Vérifier que la même plage de dates est sélectionnée dans les deux vues</li>
                                        <li>Vérifier que les filtres appliqués sont identiques</li>
                                        <li>Lancer le diagnostic via la page /diagnostic sur la période concernée</li>
                                        <li>Inspecter les appels divergents : comparer le statut SQL et le statut TypeScript</li>
                                        <li>Si le statut diffère, vérifier <code>determineCallStatus()</code> dans <code>services/domain/call-aggregation.ts</code></li>
                                    </ol>
                                </div>

                                <div className="bg-slate-50 rounded-lg p-5 border border-slate-200">
                                    <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                                        <FileText className="h-4 w-4 text-purple-600" />
                                        Je souhaite ajouter une page
                                    </h4>
                                    <ol className="space-y-2 text-sm text-slate-600 list-decimal list-inside">
                                        <li>Créer le dossier dans <code>app/(authenticated)/</code> (ou <code>app/</code> si publique)</li>
                                        <li>Si la route est protégée, ajouter le chemin dans <code>middleware.ts</code></li>
                                        <li>Ajouter le lien dans <code>components/sidebar.tsx</code></li>
                                        <li>Créer la Server Action dans <code>services/</code> en respectant le pattern Repository</li>
                                        <li>Utiliser un Server Component par défaut ; migrer en Client Component uniquement si interactivité requise</li>
                                    </ol>
                                </div>
                            </div>

                            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                <h4 className="font-semibold text-red-900 mb-2 flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4" />
                                    Anti-patterns à éviter absolument
                                </h4>
                                <ul className="space-y-1.5 text-sm text-red-800 list-disc list-inside">
                                    <li>Ne jamais dupliquer la logique de détermination de statut (<code>determineCallStatus</code>) ailleurs que dans <code>services/domain/call-aggregation.ts</code></li>
                                    <li>Ne jamais écrire de SQL dans un fichier autre que <code>services/repositories/cdr.repository.ts</code></li>
                                    <li>Ne jamais modifier le SQL de logs sans mettre à jour le diagnostic et vice versa</li>
                                    <li>Ne jamais ignorer un écart détecté par le diagnostic : il révèle une incohérence réelle</li>
                                </ul>
                            </div>
                        </CardContent>
                    </Card>
                </section>

                <hr className="border-slate-200" />

                {/* FAQ RESPONSABLE */}
                <section>
                    <SectionTitle
                        icon={HelpCircle}
                        title="Questions fréquentes"
                        subtitle="Réponses aux interrogations des équipes de direction et management"
                    />
                    <div className="space-y-4">
                        {faqItems.map((faq, idx) => (
                            <Card key={idx} className="hover:shadow-sm transition-shadow">
                                <CardContent className="p-5">
                                    <div className="flex items-start gap-3">
                                        <HelpCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-2">
                                                <h3 className="font-semibold text-slate-900">{faq.question}</h3>
                                                {faq.tag && (
                                                    <Badge variant="secondary" className="text-xs">
                                                        {faq.tag}
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-sm text-slate-600 leading-relaxed">{faq.answer}</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </section>

                {/* Footer */}
                <div className="text-center text-xs text-slate-400 pt-8 pb-4">
                    Documentation technique — GRR Stats 3CX
                    <br />
                    Dernière mise à jour : avril 2026
                </div>
            </div>
        </div>
    );
}
