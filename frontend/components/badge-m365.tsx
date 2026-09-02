"use client";

import { cn } from "@/lib/utils";

/**
 * L'état du rapprochement Microsoft 365 d'un collaborateur, en badge.
 *
 * Le logo aux quatre carreaux dit « Microsoft » d'un coup d'œil — en couleur
 * quand le profil est trouvé, éteint sinon. Le texte dit POURQUOI ce n'est pas
 * trouvé : c'est ce sur quoi l'administrateur peut agir.
 */

export type EtatM365 = "ok" | "sans-email" | "inconnu-m365" | "compte-desactive" | "m365-inactif";

export const LIBELLES_M365: Record<EtatM365, string> = {
    "ok": "Rapproché",
    "sans-email": "Sans e-mail au 3CX",
    "inconnu-m365": "Inconnu de Microsoft 365",
    "compte-desactive": "Compte désactivé",
    "m365-inactif": "Intégration éteinte",
};

const STYLES: Record<EtatM365, string> = {
    "ok": "border-emerald-200 bg-emerald-50 text-emerald-700",
    "sans-email": "border-slate-200 bg-slate-50 text-slate-500",
    "inconnu-m365": "border-amber-200 bg-amber-50 text-amber-700",
    "compte-desactive": "border-red-200 bg-red-50 text-red-700",
    "m365-inactif": "border-slate-200 bg-slate-50 text-slate-400",
};

export function LogoMicrosoft({ eteint, className }: { eteint?: boolean; className?: string }) {
    return (
        <svg viewBox="0 0 21 21" aria-hidden="true" className={cn("h-3 w-3 shrink-0", eteint && "grayscale opacity-50", className)}>
            <path d="M0 0h10v10H0z" fill="#f25022" />
            <path d="M11 0h10v10h-10z" fill="#7fba00" />
            <path d="M0 11h10v10H0z" fill="#00a4ef" />
            <path d="M11 11h10v10h-10z" fill="#ffb900" />
        </svg>
    );
}

export function BadgeM365({ etat, className }: { etat: EtatM365 | string; className?: string }) {
    const e = (etat in LIBELLES_M365 ? etat : "sans-email") as EtatM365;
    return (
        <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium", STYLES[e], className)}>
            <LogoMicrosoft eteint={e !== "ok"} />
            {LIBELLES_M365[e]}
        </span>
    );
}
