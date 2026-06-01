"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ServerId, SERVERS } from "@/lib/prisma-cdr";
import { getAvailableServers } from "@/lib/servers";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Building2 } from "lucide-react";

interface ServerSelectorProps {
    currentServer: ServerId;
}

export function ServerSelector({ currentServer }: ServerSelectorProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const availableServers = getAvailableServers();

    function handleServerChange(value: string) {
        const serverId = value as ServerId;
        
        startTransition(async () => {
            document.cookie = `selectedServer=${serverId}; path=/; max-age=31536000; SameSite=Lax`;
            router.refresh();
        });
    }

    if (availableServers.length === 0) {
        return null;
    }

    if (availableServers.length === 1) {
        const server = SERVERS[availableServers[0]];
        return (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300">
                <Building2 className="h-4 w-4" />
                <span>{server.name}</span>
            </div>
        );
    }

    return (
        <Select value={currentServer} onValueChange={handleServerChange} disabled={isPending}>
            <SelectTrigger className="w-[180px] bg-slate-800 border-slate-700 text-white hover:bg-slate-700">
                <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-blue-400" />
                    <SelectValue placeholder="Sélectionner un serveur" />
                </div>
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700">
                {availableServers.map((serverId) => {
                    const server = SERVERS[serverId];
                    return (
                        <SelectItem
                            key={serverId}
                            value={serverId}
                            className="text-white focus:bg-slate-700 focus:text-white"
                        >
                            {server.name}
                        </SelectItem>
                    );
                })}
            </SelectContent>
        </Select>
    );
}
