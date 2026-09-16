import { Eye } from "lucide-react";

import { libelleCible, type CibleVue } from "@/services/domain/vue-en-tant-que";

/**
 * Le bandeau qui dit, sur chaque page, que l'administrateur regarde
 * l'application comme quelqu'un d'autre — et comment en sortir. Il reste
 * tant que la vue dure : on ne doit pas pouvoir oublier que les chiffres à
 * l'écran sont ceux d'un autre.
 */
export function BandeauVueEnTantQue({ cible, quitter }: { cible: CibleVue; quitter: () => Promise<void> }) {
    return (
        <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
            <Eye className="h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1 truncate">
                Vous voyez l&apos;application comme <span className="font-semibold">{libelleCible(cible)}</span> — ses équipes, ses droits, ses chiffres. Rien n&apos;est écrit en son nom.
            </p>
            <form action={quitter}>
                <button type="submit" className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100">
                    Quitter
                </button>
            </form>
        </div>
    );
}
