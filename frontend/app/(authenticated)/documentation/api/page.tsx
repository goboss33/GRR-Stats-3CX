"use client";

import { useState } from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    BookOpen,
    Key,
    Globe,
    Users,
    Phone,
    BarChart3,
    Copy,
    Check,
    AlertTriangle,
    Shield,
    Clock,
    Code,
} from "lucide-react";

// ============================================
// API ENDPOINTS DEFINITIONS
// ============================================

interface ApiEndpoint {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    title: string;
    description: string;
    params: ApiParam[];
    response: ApiResponseField[];
    example: string;
    exampleResponse?: string;
}

interface ApiParam {
    name: string;
    type: string;
    required: boolean;
    description: string;
    default?: string;
}

interface ApiResponseField {
    name: string;
    type: string;
    description: string;
}

const endpoints: ApiEndpoint[] = [
    {
        method: "GET",
        path: "/api/analytics/logs",
        title: "Liste des appels (Logs)",
        description: "Récupère la liste paginée des appels agrégés avec tous les détails : statut, direction, durée, agents, parcours, etc. Cette endpoint est la source de vérité pour toutes les données d'appels.",
        params: [
            { name: "start", type: "string (ISO 8601)", required: false, description: "Date de début de la période", default: "30 jours avant aujourd'hui" },
            { name: "end", type: "string (ISO 8601)", required: false, description: "Date de fin de la période", default: "aujourd'hui" },
            { name: "queueNumber", type: "string", required: false, description: "Filtrer par numéro de file d'attente (ex: '993')" },
            { name: "page", type: "integer", required: false, description: "Numéro de page", default: "1" },
            { name: "pageSize", type: "integer", required: false, description: "Nombre de résultats par page (max 100)", default: "20" },
            { name: "sort", type: "string", required: false, description: "Champ de tri: startedAt, timeOfDay, duration, sourceNumber, destinationNumber", default: "startedAt" },
            { name: "dir", type: "string", required: false, description: "Direction du tri: asc ou desc", default: "desc" },
        ],
        response: [
            { name: "logs", type: "array", description: "Liste des appels agrégés" },
            { name: "logs[].callHistoryId", type: "string", description: "Identifiant unique de l'appel" },
            { name: "logs[].startedAt", type: "string (ISO)", description: "Horodatage de début" },
            { name: "logs[].endedAt", type: "string (ISO)", description: "Horodatage de fin" },
            { name: "logs[].totalDurationSeconds", type: "number", description: "Durée totale en secondes" },
            { name: "logs[].waitTimeSeconds", type: "number", description: "Temps d'attente en secondes" },
            { name: "logs[].callerNumber", type: "string", description: "Numéro de l'appelant" },
            { name: "logs[].callerName", type: "string|null", description: "Nom de l'appelant" },
            { name: "logs[].calleeNumber", type: "string", description: "Numéro du destinataire" },
            { name: "logs[].handledBy", type: "array", description: "Liste des agents ayant répondu" },
            { name: "logs[].direction", type: "string", description: "Direction: inbound, outbound, internal, bridge" },
            { name: "logs[].finalStatus", type: "string", description: "Statut: answered, missed, voicemail, busy" },
            { name: "logs[].journey", type: "array", description: "Parcours détaillé de l'appel" },
            { name: "totalCount", type: "integer", description: "Nombre total de résultats" },
            { name: "totalPages", type: "integer", description: "Nombre total de pages" },
            { name: "currentPage", type: "integer", description: "Page actuelle" },
        ],
        example: `curl -X GET "https://your-domain.com/api/analytics/logs?start=2026-04-01&end=2026-04-30&queueNumber=993&page=1&pageSize=20" \\
  -H "X-API-Key: votre-cle-api"`,
        exampleResponse: `{
  "logs": [
    {
      "callHistoryId": "abc123-def456",
      "callHistoryIdShort": "F456",
      "segmentCount": 3,
      "startedAt": "2026-04-15T09:23:45.000Z",
      "endedAt": "2026-04-15T09:28:12.000Z",
      "totalDurationSeconds": 267,
      "waitTimeSeconds": 12,
      "callerNumber": "+41791234567",
      "callerName": "Jean Dupont",
      "calleeNumber": "993",
      "handledBy": [
        { "number": "164", "name": "Devanthéry, Aude" }
      ],
      "direction": "inbound",
      "finalStatus": "answered",
      "journey": [
        { "type": "queue", "label": "993", "result": "answered", "agent": "Devanthéry, Aude" }
      ]
    }
  ],
  "totalCount": 345,
  "totalPages": 18,
  "currentPage": 1
}`,
    },
    {
        method: "GET",
        path: "/api/analytics/agents",
        title: "Performance des agents",
        description: "Récupère les statistiques de performance de chaque agent membre d'une file d'attente : appels queue résolus, appels directs reçus/répondus, temps de conversation. Utilise la même logique que les logs pour garantir la cohérence des données.",
        params: [
            { name: "queueNumber", type: "string", required: true, description: "Numéro de la file d'attente (ex: '993')" },
            { name: "start", type: "string (ISO 8601)", required: false, description: "Date de début", default: "30 jours avant aujourd'hui" },
            { name: "end", type: "string (ISO 8601)", required: false, description: "Date de fin", default: "aujourd'hui" },
        ],
        response: [
            { name: "agents", type: "array", description: "Liste des agents" },
            { name: "agents[].extension", type: "string", description: "Numéro d'extension de l'agent" },
            { name: "agents[].name", type: "string", description: "Nom de l'agent" },
            { name: "agents[].callsReceived", type: "integer", description: "Appels queue reçus" },
            { name: "agents[].answered", type: "integer", description: "Appels queue résolus (résolveur final)" },
            { name: "agents[].queueTalkTimeSeconds", type: "integer", description: "Temps de conversation queue en secondes" },
            { name: "agents[].directReceived", type: "integer", description: "Appels directs reçus" },
            { name: "agents[].directAnswered", type: "integer", description: "Appels directs répondus" },
            { name: "agents[].directTalkTimeSeconds", type: "integer", description: "Temps de conversation direct en secondes" },
            { name: "queueNumber", type: "string", description: "Numéro de file demandé" },
        ],
        example: `curl -X GET "https://your-domain.com/api/analytics/agents?queueNumber=993&start=2026-04-01&end=2026-04-30" \\
  -H "X-API-Key: votre-cle-api"`,
        exampleResponse: `{
  "agents": [
    {
      "extension": "164",
      "name": "Devanthéry, Aude",
      "callsReceived": 97,
      "answered": 97,
      "queueTalkTimeSeconds": 14520,
      "directReceived": 164,
      "directAnswered": 164,
      "directTalkTimeSeconds": 28800
    },
    {
      "extension": "163",
      "name": "Meylan, Eva",
      "callsReceived": 89,
      "answered": 89,
      "queueTalkTimeSeconds": 12340,
      "directReceived": 345,
      "directAnswered": 150,
      "directTalkTimeSeconds": 22100
    }
  ],
  "queueNumber": "993"
}`,
    },
    {
        method: "GET",
        path: "/api/analytics/queue",
        title: "KPIs d'une file d'attente",
        description: "Récupère les indicateurs de performance clés d'une file d'attente : appels reçus, répondus, abandonnés, overflow, temps d'attente moyen, taux de ping-pong, destinations d'overflow, et statistiques d'appels directs de l'équipe.",
        params: [
            { name: "queueNumber", type: "string", required: true, description: "Numéro de la file d'attente (ex: '993')" },
            { name: "start", type: "string (ISO 8601)", required: false, description: "Date de début", default: "30 jours avant aujourd'hui" },
            { name: "end", type: "string (ISO 8601)", required: false, description: "Date de fin", default: "aujourd'hui" },
        ],
        response: [
            { name: "queueNumber", type: "string", description: "Numéro de file" },
            { name: "queueName", type: "string", description: "Nom affiché de la file" },
            { name: "callsReceived", type: "integer", description: "Appels uniques reçus" },
            { name: "callsAnswered", type: "integer", description: "Appels répondus" },
            { name: "callsAbandoned", type: "integer", description: "Appels abandonnés" },
            { name: "abandonedBefore10s", type: "integer", description: "Abandons avant 10 secondes" },
            { name: "abandonedAfter10s", type: "integer", description: "Abandons après 10 secondes" },
            { name: "callsOverflow", type: "integer", description: "Appels redirigés (overflow)" },
            { name: "totalPassages", type: "integer", description: "Total des passages CDR" },
            { name: "pingPongCount", type: "integer", description: "Nombre de passages supplémentaires (ping-pong)" },
            { name: "pingPongPercentage", type: "number", description: "Pourcentage de ping-pong" },
            { name: "avgWaitTimeSeconds", type: "number", description: "Temps d'attente moyen" },
            { name: "avgTalkTimeSeconds", type: "number", description: "Temps de conversation moyen" },
            { name: "teamDirectReceived", type: "integer", description: "Appels directs reçus par l'équipe" },
            { name: "teamDirectAnswered", type: "integer", description: "Appels directs répondus par l'équipe" },
            { name: "overflowDestinations", type: "array", description: "Top 10 des destinations d'overflow" },
        ],
        example: `curl -X GET "https://your-domain.com/api/analytics/queue?queueNumber=993&start=2026-04-01&end=2026-04-30" \\
  -H "X-API-Key: votre-cle-api"`,
        exampleResponse: `{
  "queueNumber": "993",
  "queueName": "RR PULLY Gérance 63",
  "callsReceived": 684,
  "callsAnswered": 499,
  "callsAbandoned": 145,
  "abandonedBefore10s": 32,
  "abandonedAfter10s": 113,
  "callsOverflow": 40,
  "totalPassages": 710,
  "pingPongCount": 26,
  "pingPongPercentage": 3.7,
  "avgWaitTimeSeconds": 18.5,
  "avgTalkTimeSeconds": 245.3,
  "teamDirectReceived": 1408,
  "teamDirectAnswered": 659,
  "overflowDestinations": [
    { "destination": "905", "destinationName": "Transport", "count": 28 },
    { "destination": "910", "destinationName": "Comptabilité", "count": 12 }
  ]
}`,
    },
    {
        method: "GET",
        path: "/api/analytics/global",
        title: "Métriques globales (Dashboard)",
        description: "Récupère les indicateurs globaux de l'ensemble du centre d'appels : volume total, taux de réponse, répartition par statut, temps moyens, distribution du nombre d'agents par appel. Inclut la comparaison avec la période précédente.",
        params: [
            { name: "start", type: "string (ISO 8601)", required: false, description: "Date de début", default: "30 jours avant aujourd'hui" },
            { name: "end", type: "string (ISO 8601)", required: false, description: "Date de fin", default: "aujourd'hui" },
            { name: "includePrevious", type: "boolean", required: false, description: "Inclure la comparaison avec la période précédente", default: "true" },
        ],
        response: [
            { name: "totalCalls", type: "integer", description: "Total des appels uniques" },
            { name: "answeredCalls", type: "integer", description: "Appels répondus" },
            { name: "missedCalls", type: "integer", description: "Appels manqués" },
            { name: "voicemailCalls", type: "integer", description: "Appels en messagerie" },
            { name: "busyCalls", type: "integer", description: "Appels occupés" },
            { name: "avgDurationSeconds", type: "number", description: "Durée moyenne de conversation" },
            { name: "avgWaitTimeSeconds", type: "number", description: "Temps d'attente moyen" },
            { name: "avgAgentsPerCall", type: "number", description: "Nombre moyen d'agents par appel" },
            { name: "agentsDistribution", type: "object", description: "Répartition: agents1, agents2, agents3Plus" },
            { name: "previousPeriod", type: "object|null", description: "Métriques de la période précédente (si includePrevious=true)" },
        ],
        example: `curl -X GET "https://your-domain.com/api/analytics/global?start=2026-04-01&end=2026-04-30&includePrevious=true" \\
  -H "X-API-Key: votre-cle-api"`,
        exampleResponse: `{
  "totalCalls": 2092,
  "answeredCalls": 1158,
  "missedCalls": 789,
  "voicemailCalls": 123,
  "busyCalls": 22,
  "avgDurationSeconds": 245.3,
  "avgWaitTimeSeconds": 18.5,
  "avgAgentsPerCall": 1.4,
  "agentsDistribution": {
    "agents1": 856,
    "agents2": 234,
    "agents3Plus": 68
  },
  "previousPeriod": {
    "totalCalls": 1987,
    "answeredCalls": 1089,
    "missedCalls": 756,
    "voicemailCalls": 118,
    "busyCalls": 24,
    "avgDurationSeconds": 238.1,
    "avgWaitTimeSeconds": 19.2,
    "avgAgentsPerCall": 1.3,
    "agentsDistribution": {
      "agents1": 812,
      "agents2": 221,
      "agents3Plus": 62
    }
  }
}`,
    },
];

// ============================================
// COMPOSANTS
// ============================================

function MethodBadge({ method }: { method: string }) {
    const colors: Record<string, string> = {
        GET: "bg-emerald-100 text-emerald-800 border-emerald-200",
        POST: "bg-blue-100 text-blue-800 border-blue-200",
        PUT: "bg-amber-100 text-amber-800 border-amber-200",
        DELETE: "bg-red-100 text-red-800 border-red-200",
    };
    return (
        <Badge variant="outline" className={`font-mono text-xs ${colors[method] || "bg-slate-100 text-slate-800"}`}>
            {method}
        </Badge>
    );
}

function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="relative group">
            <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 text-xs overflow-x-auto font-mono leading-relaxed">
                <code>{code}</code>
            </pre>
            <button
                onClick={handleCopy}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Copier"
            >
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            </button>
        </div>
    );
}

function ParamTable({ params }: { params: ApiParam[] }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-slate-200">
                        <th className="text-left py-2 px-3 font-semibold text-slate-700">Paramètre</th>
                        <th className="text-left py-2 px-3 font-semibold text-slate-700">Type</th>
                        <th className="text-left py-2 px-3 font-semibold text-slate-700">Requis</th>
                        <th className="text-left py-2 px-3 font-semibold text-slate-700">Description</th>
                        <th className="text-left py-2 px-3 font-semibold text-slate-700">Défaut</th>
                    </tr>
                </thead>
                <tbody>
                    {params.map((param) => (
                        <tr key={param.name} className="border-b border-slate-100">
                            <td className="py-2 px-3">
                                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono text-blue-700">{param.name}</code>
                            </td>
                            <td className="py-2 px-3 text-slate-600">{param.type}</td>
                            <td className="py-2 px-3">
                                {param.required ? (
                                    <Badge variant="destructive" className="text-xs">Oui</Badge>
                                ) : (
                                    <Badge variant="secondary" className="text-xs">Non</Badge>
                                )}
                            </td>
                            <td className="py-2 px-3 text-slate-600">{param.description}</td>
                            <td className="py-2 px-3 text-slate-500 text-xs">{param.default || "-"}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ResponseTable({ fields }: { fields: ApiResponseField[] }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-slate-200">
                        <th className="text-left py-2 px-3 font-semibold text-slate-700">Champ</th>
                        <th className="text-left py-2 px-3 font-semibold text-slate-700">Type</th>
                        <th className="text-left py-2 px-3 font-semibold text-slate-700">Description</th>
                    </tr>
                </thead>
                <tbody>
                    {fields.map((field) => (
                        <tr key={field.name} className="border-b border-slate-100">
                            <td className="py-2 px-3">
                                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono text-emerald-700">{field.name}</code>
                            </td>
                            <td className="py-2 px-3 text-slate-600">{field.type}</td>
                            <td className="py-2 px-3 text-slate-600">{field.description}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ============================================
// PAGE PRINCIPALE
// ============================================

export default function ApiDocumentationPage() {
    const [activeEndpoint, setActiveEndpoint] = useState<string>(endpoints[0].path);

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Hero */}
            <div className="bg-white border-b border-slate-200">
                <div className="max-w-6xl mx-auto px-6 py-12">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2.5 bg-blue-600 rounded-xl">
                            <Globe className="h-6 w-6 text-white" />
                        </div>
                        <h1 className="text-3xl font-bold text-slate-900">
                            Documentation API
                        </h1>
                    </div>
                    <p className="text-slate-500 max-w-2xl leading-relaxed">
                        Référence complète de l'API REST <strong>GRR Stats 3CX</strong>. Toutes les données proviennent de la même source de vérité (les logs CDR), garantissant une cohérence parfaite entre l'interface web et les intégrations externes.
                    </p>
                </div>
            </div>

            <div className="max-w-6xl mx-auto px-6 py-12 space-y-16">

                {/* AUTHENTIFICATION */}
                <section>
                    <div className="flex items-center gap-2 mb-6">
                        <Shield className="h-5 w-5 text-blue-600" />
                        <h2 className="text-2xl font-bold text-slate-900">Authentification</h2>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Key className="h-4 w-4 text-amber-600" />
                                    Clé API
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3 text-sm text-slate-600">
                                <p>
                                    Toutes les requêtes API nécessitent une clé d'authentification transmise dans l'en-tête HTTP <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">X-API-Key</code>.
                                </p>
                                <CodeBlock code={`curl -X GET "https://your-domain.com/api/analytics/global" \\
  -H "X-API-Key: sk_live_abc123..."`} />
                                <p className="text-xs text-slate-500">
                                    Les clés API sont générées depuis la page <strong>Paramètres &gt; Clés API</strong> de l'application. Chaque clé est associée à un quota de requêtes par minute configurable.
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-emerald-600" />
                                    Rate Limiting
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3 text-sm text-slate-600">
                                <p>
                                    Chaque clé API possède un quota configurable (défaut: 100 requêtes/minute). En cas de dépassement, l'API retourne un code <code className="text-xs bg-red-100 px-1.5 py-0.5 rounded text-red-700">429 Too Many Requests</code> avec un en-tête <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">Retry-After</code>.
                                </p>
                                <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                                    <p className="text-xs text-amber-800">
                                        <strong>Conseil :</strong> Pour les exports volumineux, utilisez une pagination avec <code className="font-mono">pageSize=100</code> et implémentez un délai entre les requêtes.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <Card className="mt-6">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 text-red-600" />
                                Codes d'erreur
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-200">
                                            <th className="text-left py-2 px-3 font-semibold">Code</th>
                                            <th className="text-left py-2 px-3 font-semibold">Signification</th>
                                            <th className="text-left py-2 px-3 font-semibold">Cause</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className="border-b border-slate-100">
                                            <td className="py-2 px-3"><code className="text-xs bg-red-100 px-1.5 py-0.5 rounded text-red-700">401</code></td>
                                            <td className="py-2 px-3">Unauthorized</td>
                                            <td className="py-2 px-3 text-slate-600">Clé API manquante ou invalide</td>
                                        </tr>
                                        <tr className="border-b border-slate-100">
                                            <td className="py-2 px-3"><code className="text-xs bg-red-100 px-1.5 py-0.5 rounded text-red-700">400</code></td>
                                            <td className="py-2 px-3">Bad Request</td>
                                            <td className="py-2 px-3 text-slate-600">Paramètre manquant ou invalide (ex: queueNumber requis)</td>
                                        </tr>
                                        <tr className="border-b border-slate-100">
                                            <td className="py-2 px-3"><code className="text-xs bg-red-100 px-1.5 py-0.5 rounded text-red-700">404</code></td>
                                            <td className="py-2 px-3">Not Found</td>
                                            <td className="py-2 px-3 text-slate-600">Aucune donnée trouvée pour les critères demandés</td>
                                        </tr>
                                        <tr className="border-b border-slate-100">
                                            <td className="py-2 px-3"><code className="text-xs bg-red-100 px-1.5 py-0.5 rounded text-red-700">429</code></td>
                                            <td className="py-2 px-3">Too Many Requests</td>
                                            <td className="py-2 px-3 text-slate-600">Quota de requêtes dépassé</td>
                                        </tr>
                                        <tr>
                                            <td className="py-2 px-3"><code className="text-xs bg-red-100 px-1.5 py-0.5 rounded text-red-700">500</code></td>
                                            <td className="py-2 px-3">Internal Server Error</td>
                                            <td className="py-2 px-3 text-slate-600">Erreur serveur (consulter les logs)</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </section>

                <hr className="border-slate-200" />

                {/* ENDPOINTS */}
                <section>
                    <div className="flex items-center gap-2 mb-6">
                        <Code className="h-5 w-5 text-blue-600" />
                        <h2 className="text-2xl font-bold text-slate-900">Endpoints</h2>
                    </div>

                    {/* Endpoint tabs */}
                    <div className="flex flex-wrap gap-2 mb-6">
                        {endpoints.map((ep) => (
                            <button
                                key={ep.path}
                                onClick={() => setActiveEndpoint(ep.path)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                    activeEndpoint === ep.path
                                        ? "bg-blue-600 text-white"
                                        : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                                }`}
                            >
                                <MethodBadge method={ep.method} />
                                <span className="font-mono text-xs">{ep.path.replace("/api/analytics/", "")}</span>
                            </button>
                        ))}
                    </div>

                    {endpoints
                        .filter((ep) => ep.path === activeEndpoint)
                        .map((endpoint) => (
                            <div key={endpoint.path} className="space-y-6">
                                <Card>
                                    <CardHeader className="pb-3">
                                        <div className="flex items-center gap-3">
                                            <MethodBadge method={endpoint.method} />
                                            <CardTitle className="text-lg">{endpoint.title}</CardTitle>
                                        </div>
                                        <p className="text-sm text-slate-500 font-mono">{endpoint.path}</p>
                                    </CardHeader>
                                    <CardContent className="space-y-6">
                                        <p className="text-sm text-slate-600 leading-relaxed">{endpoint.description}</p>

                                        {/* Params */}
                                        <div>
                                            <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                                                <BarChart3 className="h-4 w-4 text-blue-600" />
                                                Paramètres de requête
                                            </h4>
                                            <ParamTable params={endpoint.params} />
                                        </div>

                                        {/* Response */}
                                        <div>
                                            <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                                                <Code className="h-4 w-4 text-emerald-600" />
                                                Structure de réponse
                                            </h4>
                                            <ResponseTable fields={endpoint.response} />
                                        </div>

                                        {/* Example */}
                                        <div>
                                            <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                                                <Globe className="h-4 w-4 text-amber-600" />
                                                Exemple de requête
                                            </h4>
                                            <CodeBlock code={endpoint.example} />
                                        </div>

                                        {/* Example Response */}
                                        {endpoint.exampleResponse && (
                                            <div>
                                                <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                                                    <Code className="h-4 w-4 text-purple-600" />
                                                    Exemple de réponse
                                                </h4>
                                                <CodeBlock code={endpoint.exampleResponse} language="json" />
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </div>
                        ))}
                </section>

                <hr className="border-slate-200" />

                {/* INTEGRATION */}
                <section>
                    <div className="flex items-center gap-2 mb-6">
                        <Users className="h-5 w-5 text-blue-600" />
                        <h2 className="text-2xl font-bold text-slate-900">Guide d'intégration</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">JavaScript / Node.js</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <CodeBlock code={`const API_KEY = process.env.GRR_API_KEY;
const BASE_URL = "https://your-domain.com/api/analytics";

async function getQueueStats(queueNumber, start, end) {
  const params = new URLSearchParams({
    queueNumber,
    start: start.toISOString(),
    end: end.toISOString(),
  });
  
  const response = await fetch(\`\${BASE_URL}/queue?\${params}\`, {
    headers: { "X-API-Key": API_KEY },
  });
  
  if (!response.ok) {
    throw new Error(\`API error: \${response.status}\`);
  }
  
  return response.json();
}

// Usage
const stats = await getQueueStats(
  "993",
  new Date("2026-04-01"),
  new Date("2026-04-30")
);
console.log(\`Appels répondus: \${stats.callsAnswered}\`);`} />
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">Python</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <CodeBlock code={`import requests
from datetime import datetime

API_KEY = "sk_live_abc123..."
BASE_URL = "https://your-domain.com/api/analytics"

def get_queue_stats(queue_number, start, end):
    params = {
        "queueNumber": queue_number,
        "start": start.isoformat(),
        "end": end.isoformat(),
    }
    
    headers = {"X-API-Key": API_KEY}
    response = requests.get(
        f"{BASE_URL}/queue",
        params=params,
        headers=headers
    )
    response.raise_for_status()
    return response.json()

# Usage
stats = get_queue_stats(
    "993",
    datetime(2026, 4, 1),
    datetime(2026, 4, 30)
)
print(f"Appels répondus: {stats['callsAnswered']}")`} />
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">Export CSV des logs</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <CodeBlock code={`const API_KEY = process.env.GRR_API_KEY;
const BASE_URL = "https://your-domain.com/api/analytics";

async function exportLogsToCSV(queueNumber, start, end) {
  let page = 1;
  const allLogs = [];
  
  while (true) {
    const params = new URLSearchParams({
      queueNumber,
      start: start.toISOString(),
      end: end.toISOString(),
      page: String(page),
      pageSize: "100",
    });
    
    const response = await fetch(\`\${BASE_URL}/logs?\${params}\`, {
      headers: { "X-API-Key": API_KEY },
    });
    
    const data = await response.json();
    allLogs.push(...data.logs);
    
    if (page >= data.totalPages) break;
    page++;
    
    // Respecter le rate limiting
    await new Promise(r => setTimeout(r, 700));
  }
  
  // Convertir en CSV...
  return allLogs;
}`} />
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">Dashboard personnalisé</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <CodeBlock code={`// Récupérer les métriques globales
// avec comparaison période précédente
const global = await fetch(
  "\${BASE_URL}/global?includePrevious=true",
  { headers: { "X-API-Key": API_KEY } }
).then(r => r.json());

// Calculer les tendances
const answerRate = (global.answeredCalls / global.totalCalls * 100).toFixed(1);
const prevAnswerRate = (global.previousPeriod.answeredCalls / global.previousPeriod.totalCalls * 100).toFixed(1);
const trend = (answerRate - prevAnswerRate).toFixed(1);

console.log(\`Taux de réponse: \${answerRate}% (\${trend > 0 ? "+" : ""}\${trend}%)\`);
// Ex: "Taux de réponse: 55.4% (+2.1%)"`} />
                            </CardContent>
                        </Card>
                    </div>
                </section>

                <hr className="border-slate-200" />

                {/* BEST PRACTICES */}
                <section>
                    <div className="flex items-center gap-2 mb-6">
                        <BookOpen className="h-5 w-5 text-blue-600" />
                        <h2 className="text-2xl font-bold text-slate-900">Bonnes pratiques</h2>
                    </div>

                    <div className="space-y-4">
                        <Card>
                            <CardContent className="p-5">
                                <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                                    <Phone className="h-4 w-4 text-blue-600" />
                                    Utiliser la pagination pour les exports volumineux
                                </h4>
                                <p className="text-sm text-slate-600">
                                    L'endpoint <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">/logs</code> retourne maximum 100 résultats par requête. Pour exporter un mois complet (~2000 appels), implémentez une boucle de pagination avec un délai de 700ms entre chaque requête pour respecter le rate limiting.
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardContent className="p-5">
                                <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                                    <BarChart3 className="h-4 w-4 text-emerald-600" />
                                    Préférer les endpoints agrégés pour les dashboards
                                </h4>
                                <p className="text-sm text-slate-600">
                                    Pour afficher des KPIs, utilisez <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">/queue</code> ou <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">/global</code> plutôt que <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">/logs</code>. Les endpoints agrégés exécutent une seule requête SQL optimisée, tandis que <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">/logs</code> construit un JSON de parcours pour chaque appel.
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardContent className="p-5">
                                <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                                    <Shield className="h-4 w-4 text-amber-600" />
                                    Sécuriser les clés API
                                </h4>
                                <p className="text-sm text-slate-600">
                                    Ne jamais exposer une clé API dans du code côté client (navigateur). Utilisez toujours un serveur intermédiaire ou des variables d'environnement côté serveur. En cas de compromission, révoquez immédiatement la clé depuis la page Paramètres.
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardContent className="p-5">
                                <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-purple-600" />
                                    Limiter les plages de dates
                                </h4>
                                <p className="text-sm text-slate-600">
                                    Les requêtes sur de longues périodes (plusieurs mois) peuvent être lentes. Limitez les exports à quelques semaines et utilisez la pagination. Pour les analyses historiques, privilégiez les endpoints agrégés (<code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">/global</code>, <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">/queue</code>) qui sont optimisés pour les grandes plages.
                                </p>
                            </CardContent>
                        </Card>
                    </div>
                </section>

                {/* Footer */}
                <div className="text-center text-xs text-slate-400 pt-8 pb-4">
                    Documentation API — GRR Stats 3CX
                    <br />
                    Dernière mise à jour : mai 2026
                </div>
            </div>
        </div>
    );
}
