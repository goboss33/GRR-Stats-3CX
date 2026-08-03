"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
    React.ElementRef<typeof TooltipPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
    <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
            ref={ref}
            sideOffset={sideOffset}
            className={cn(
                "z-50 max-w-xs overflow-hidden rounded-md border border-slate-700/60 bg-slate-900 px-2.5 py-1.5 text-xs font-medium leading-relaxed text-slate-50 shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
                className
            )}
            {...props}
        />
    </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

/**
 * Infobulle maison — remplace le `title` natif dans toute l'application.
 *
 * Le `title` du navigateur impose ~1 s de latence incompressible ; ici
 * l'infobulle apparaît IMMÉDIATEMENT (delayDuration 0), au survol comme au
 * focus clavier, et son contenu passe par un portail — elle n'est jamais
 * rognée par un conteneur `overflow` (tableaux, dialogues).
 *
 * `content` vide, null ou undefined : l'enfant est rendu tel quel — pratique
 * pour les infobulles conditionnelles (`content={cond ? "…" : undefined}`).
 *
 * L'enfant doit être UN élément qui accepte la ref (élément DOM, ou composant
 * qui la relaie). Pour un bouton `disabled`, l'envelopper d'un <span
 * className="inline-flex"> : un élément désactivé n'émet pas d'événements de
 * survol, l'infobulle ne s'ouvrirait jamais.
 */
export function Tip({
    content,
    side = "top",
    align = "center",
    className,
    children,
}: {
    content: React.ReactNode;
    side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
    align?: React.ComponentProps<typeof TooltipPrimitive.Content>["align"];
    className?: string;
    children: React.ReactElement;
}) {
    if (content === undefined || content === null || content === "") return children;
    return (
        <TooltipProvider delayDuration={0} skipDelayDuration={300}>
            <Tooltip>
                <TooltipTrigger asChild>{children}</TooltipTrigger>
                <TooltipContent side={side} align={align} className={className}>
                    {content}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
