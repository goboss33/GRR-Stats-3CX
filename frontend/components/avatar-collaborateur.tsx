"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initiales } from "@/services/domain/collaborator-profile";
import { cn } from "@/lib/utils";

/**
 * L'avatar d'un collaborateur : sa photo Microsoft 365 quand on la détient,
 * ses initiales sinon — même dessin pour un ancien collaborateur, dont la
 * photo a été purgée à son départ, et pour quelqu'un que Microsoft ne connaît
 * pas. Radix bascule sur le repli tout seul si l'image ne charge pas.
 */
export function AvatarCollaborateur({ name, photoUrl, className }: {
    name: string;
    photoUrl: string | null | undefined;
    className?: string;
}) {
    return (
        <Avatar className={cn("h-8 w-8", className)}>
            {photoUrl && <AvatarImage src={photoUrl} alt="" />}
            <AvatarFallback
                className="bg-slate-200 text-[11px] font-medium text-slate-700"
                // Aucun délai : sans photo, les initiales doivent être là au premier
                // rendu, pas après un clignotement.
                delayMs={photoUrl ? 300 : 0}
            >
                {initiales(name)}
            </AvatarFallback>
        </Avatar>
    );
}
