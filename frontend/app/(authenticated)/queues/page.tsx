"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import {
    Users,
    Clock,
    UserCheck,
    UserX,
    AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QueueInfo } from "@/types/queues.types";
import { getQueueMembers } from "@/services/queues.service";
import { QueueSearchCombobox } from "@/components/queue-search-combobox";

export default function QueuesPage() {
    const [queues, setQueues] = useState<QueueInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");

    useEffect(() => {
        getQueueMembers()
            .then(setQueues)
            .finally(() => setIsLoading(false));
    }, []);

    // Helper to determine agent status based on last seen
    const getAgentStatus = (lastSeenIso: string) => {
        const lastSeen = new Date(lastSeenIso);
        const daysSince = (new Date().getTime() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSince < 7) return { color: "bg-emerald-500", label: "Actif", class: "text-emerald-700 bg-emerald-50 border-emerald-200" };
        if (daysSince < 30) return { color: "bg-amber-500", label: "Inactif < 30j", class: "text-amber-700 bg-amber-50 border-amber-200" };
        return { color: "bg-slate-400", label: "Inactif > 30j", class: "text-slate-500 bg-slate-50 border-slate-200" };
    };

    // Filter queues based on search
    const filteredQueues = queues.filter(q =>
        q.queueName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        q.queueNumber.includes(searchTerm) ||
        q.members.some(m => m.agentName.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen text-slate-500">
                <div className="flex flex-col items-center gap-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900" />
                    <p>Chargement des files d'attente...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-8 max-w-[1600px] mx-auto space-y-8">
            {/* Header */}
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                        Files d'Attente
                    </h1>
                    <p className="text-slate-500 mt-2 text-lg">
                        Vue d'ensemble des agents par file basée sur l'historique d'activité
                    </p>
                </div>
                <QueueSearchCombobox
                    queues={queues}
                    value={searchTerm}
                    onChange={setSearchTerm}
                    className="w-full md:w-96"
                />
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-gradient-to-br from-blue-50 to-white border-blue-100">
                    <CardContent className="pt-6 flex items-center gap-4">
                        <div className="p-3 bg-blue-100 rounded-full text-blue-600">
                            <Users className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-slate-500">Total Files</p>
                            <h3 className="text-2xl font-bold text-slate-900">{queues.length}</h3>
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-indigo-50 to-white border-indigo-100">
                    <CardContent className="pt-6 flex items-center gap-4">
                        <div className="p-3 bg-indigo-100 rounded-full text-indigo-600">
                            <UserCheck className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-slate-500">Agents Identifiés</p>
                            <h3 className="text-2xl font-bold text-slate-900">
                                {new Set(queues.flatMap(q => q.members.map(m => m.agentExtension))).size}
                            </h3>
                        </div>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-amber-50 to-white border-amber-100">
                    <CardContent className="pt-6 flex items-center gap-4">
                        <div className="p-3 bg-amber-100 rounded-full text-amber-600">
                            <Clock className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-slate-500">Mise à jour</p>
                            <h3 className="text-lg font-bold text-slate-900">Temps Réel (Logs)</h3>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Warning Banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">À propos de ces données</p>
                    <p className="opacity-90">
                        Cette liste est générée dynamiquement à partir de l'activité des appels.
                        Un agent apparaît ici uniquement s'il a été sollicité par la file d'attente.
                        Les agents configurés mais jamais appelés n'apparaîtront pas.
                    </p>
                </div>
            </div>

            {/* Queues Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredQueues.map((queue) => (
                    <Card key={queue.queueNumber} className="flex flex-col h-full border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <CardHeader className="pb-3 border-b bg-slate-50/50">
                            <div className="flex justify-between items-start gap-4">
                                <div className="space-y-1">
                                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                                        <span className="font-mono bg-white border px-1.5 py-0.5 rounded text-sm text-slate-600">
                                            {queue.queueNumber}
                                        </span>
                                        <span className="truncate" title={queue.queueName}>{queue.queueName}</span>
                                    </CardTitle>
                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                        <Badge variant="secondary" className="bg-white border">
                                            {queue.memberCount} agent{queue.memberCount > 1 ? 's' : ''}
                                        </Badge>
                                    </div>
                                </div>
                                <div className="p-2 bg-white rounded-lg border text-slate-400">
                                    <Users className="h-5 w-5" />
                                </div>
                            </div>
                        </CardHeader>

                        <CardContent className="flex-1 p-0">
                            <div className="divide-y divide-slate-100">
                                {queue.members
                                    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
                                    .map((member) => {
                                        const status = getAgentStatus(member.lastSeenAt);
                                        return (
                                            <div key={member.agentExtension} className="p-3 hover:bg-slate-50 transition-colors flex items-center justify-between group">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-2 h-2 rounded-full ${status.color} flex-shrink-0`} title={status.label} />
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-slate-900 group-hover:text-blue-700 transition-colors truncate">
                                                            {member.agentName}
                                                        </p>
                                                        <p className="text-xs text-slate-500 font-mono flex items-center gap-2">
                                                            <span>Ext. {member.agentExtension}</span>
                                                            <span className="text-slate-300">•</span>
                                                            <span title="Dernière activité">
                                                                Vu {formatDistanceToNow(new Date(member.lastSeenAt), { addSuffix: true, locale: fr })}
                                                            </span>
                                                        </p>
                                                    </div>
                                                </div>
                                                <Badge variant="outline" className={`ml-2 text-[10px] font-normal px-1.5 py-0 ${status.class}`}>
                                                    {member.attemptsCount} appels
                                                </Badge>
                                            </div>
                                        );
                                    })}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {filteredQueues.length === 0 && (
                <div className="text-center py-20 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                    <UserX className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-900">Aucune file trouvée</h3>
                    <p className="text-slate-500 mt-1">Essayez de modifier votre recherche</p>
                </div>
            )}
        </div>
    );
}
