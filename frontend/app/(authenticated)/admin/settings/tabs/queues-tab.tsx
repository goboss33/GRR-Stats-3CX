"use client";

import { useState, useEffect } from "react";
import { Loader2, UserX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { QueueInfo } from "@/types/queues.types";
import { getQueueMembers } from "@/services/queues.service";
import { QueueSearchCombobox } from "@/components/queue-search-combobox";
import { getSelectedServer } from "@/lib/selected-server";

export function QueuesTab() {
    const [queues, setQueues] = useState<QueueInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");

    useEffect(() => {
        const serverId = getSelectedServer();
        getQueueMembers(serverId)
            .then(setQueues)
            .finally(() => setIsLoading(false));
    }, []);

    const getAgentStatus = (lastSeenIso: string) => {
        const lastSeen = new Date(lastSeenIso);
        const daysSince = (new Date().getTime() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince < 7) return { color: "bg-emerald-500", label: "Actif", class: "text-emerald-700 bg-emerald-50 border-emerald-200" };
        if (daysSince < 30) return { color: "bg-amber-500", label: "Inactif < 30j", class: "text-amber-700 bg-amber-50 border-amber-200" };
        return { color: "bg-slate-400", label: "Inactif > 30j", class: "text-slate-500 bg-slate-50 border-slate-200" };
    };

    const filteredQueues = queues.filter(q =>
        q.queueName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        q.queueNumber.includes(searchTerm) ||
        q.members.some(m => m.agentName.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                <span className="ml-2 text-slate-500">Chargement des files d'attente...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-slate-900">Files d'attente</h2>
                    <p className="text-sm text-slate-500">{queues.length} file(s) détectée(s)</p>
                </div>
                <QueueSearchCombobox
                    queues={queues}
                    value={searchTerm}
                    onChange={setSearchTerm}
                    className="w-full md:w-96"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredQueues.map((queue) => (
                    <Card key={queue.queueNumber} className="flex flex-col h-full border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                        <CardHeader className="pb-3 border-b bg-slate-50/50">
                            <div className="flex justify-between items-start gap-4">
                                <div className="space-y-1">
                                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                                        <span className="font-mono bg-white border px-1.5 py-0.5 rounded text-sm text-slate-600">
                                            {queue.queueNumber}
                                        </span>
                                        <span className="truncate" title={queue.queueName}>{queue.queueName}</span>
                                    </CardTitle>
                                    <Badge variant="secondary" className="bg-white border">
                                        {queue.memberCount} agent{queue.memberCount > 1 ? 's' : ''}
                                    </Badge>
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
                                                        <p className="text-xs text-slate-500 font-mono">
                                                            Ext. {member.agentExtension} • Vu {formatDistanceToNow(new Date(member.lastSeenAt), { addSuffix: true, locale: fr })}
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
