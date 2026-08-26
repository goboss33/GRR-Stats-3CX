import { Skeleton } from "@/components/ui/skeleton";
import { FilDeProgression } from "@/components/ui/etat-chargement";
import { SqueletteCourbe, SqueletteAffluences } from "@/components/stats-v2/squelettes";

/**
 * Première peinture du tableau de bord (repli Suspense).
 *
 * Auparavant : des blocs gris aux proportions approximatives, qui ne
 * ressemblaient pas à l'écran attendu. Ici, la grille des six chiffres-clés
 * et les deux cartes ont leurs dimensions réelles — la page ne bougera pas
 * quand les données arriveront.
 */
export default function DashboardLoading() {
    return (
        <div className="space-y-6">
            <FilDeProgression actif libelle="Calcul du tableau de bord" />

            {/* Six chiffres-clés, mêmes points de rupture que l'écran réel. */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="mb-2 flex items-center justify-between">
                            <Skeleton className="h-4 w-4 rounded" />
                            <Skeleton className="h-4 w-11 rounded-full" />
                        </div>
                        <Skeleton className="h-7 w-16" />
                        <Skeleton className="mt-2 h-3 w-24" />
                    </div>
                ))}
            </div>

            {/* Courbe et carte des affluences, à leur taille définitive. */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2"><SqueletteCourbe /></div>
                <div className="lg:col-span-1"><SqueletteAffluences /></div>
            </div>
        </div>
    );
}
