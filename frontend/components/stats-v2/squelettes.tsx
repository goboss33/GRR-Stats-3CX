import { Skeleton } from "@/components/ui/skeleton";

/**
 * Squelettes d'attente — la silhouette EXACTE de l'écran, pas une évocation.
 *
 * Les squelettes précédents tiraient leurs hauteurs au sort
 * (`Math.random()`) : la forme changeait à chaque rendu, le regard y lisait
 * du bruit plutôt que son écran, et le contenu « sautait » à l'arrivée des
 * données. Ici, tout ce qui est CONNU d'avance est déjà dessiné — cadres,
 * titres, en-têtes de colonnes, libellés d'axes, jours de la semaine — et
 * seul l'inconnu reste en gris : les nombres et les courbes.
 *
 * Conséquence recherchée : la page ne se remplit pas, elle se révèle. Aucune
 * dimension ne bouge entre l'attente et le contenu.
 */

const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
/** Mêmes heures que la carte des affluences (composant heatmap-chart). */
const HEURES = Array.from({ length: 24 }, (_, i) => i);

/** Hauteurs FIXES, choisies une fois — jamais tirées au sort. */
const HAUTEURS_COURBE = [42, 58, 51, 66, 47, 72, 61, 55, 78, 64, 49, 70, 57, 45];

/** Vignette KPI : icône, libellé, grand nombre, sous-ligne. */
function SqueletteVignette({ teinte, bordure }: { teinte: string; bordure: string }) {
    return (
        <div className={`flex flex-col rounded-xl border p-3 ${teinte} ${bordure}`}>
            <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-4 w-12 rounded-full" />
            </div>
            <Skeleton className="h-7 w-16" />
            <div className="mt-auto flex items-end justify-between gap-1.5 pt-0.5">
                <Skeleton className="h-2.5 w-28" />
                <Skeleton className="h-3 w-3 rounded-full" />
            </div>
        </div>
    );
}

/** Bloc de canal : pastille, titre, puis la rangée de chiffres en trois temps. */
function SqueletteCanal({ teinte, bordure }: { teinte: string; bordure: string }) {
    return (
        <div className={`flex items-center justify-between rounded-lg border p-2.5 ${teinte} ${bordure}`}>
            <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-3 rounded-full" />
                <Skeleton className="h-4 w-32" />
            </div>
            <div className="flex items-end gap-4">
                <div className="flex flex-col items-center gap-1">
                    <Skeleton className="h-5 w-10" />
                    <Skeleton className="h-2.5 w-9" />
                </div>
                <div className="flex items-end gap-4 self-stretch border-x border-slate-200 px-4">
                    {["Répondus", "Transférés", "Non aboutis"].map((c) => (
                        <div key={c} className="flex flex-col items-center gap-1">
                            <Skeleton className="h-4 w-9" />
                            <Skeleton className="h-2.5 w-12" />
                        </div>
                    ))}
                </div>
                <div className="flex flex-col items-center gap-1">
                    <Skeleton className="h-4 w-9" />
                    <Skeleton className="h-2.5 w-7" />
                </div>
            </div>
        </div>
    );
}

/**
 * Bilan d'équipe : le donut garde ses 320×256 et son anneau, les quatre
 * vignettes gardent leurs teintes — la légende de couleur est déjà lisible
 * avant même que les chiffres arrivent.
 */
export function SqueletteBilanEquipe() {
    return (
        <div className="rounded-xl border border-slate-200 bg-white">
            <div className="px-6 py-6">
                {/* En-tête : nom du groupe à gauche, attente moyenne à droite. */}
                <div className="mb-6 grid grid-cols-1 items-center gap-6 lg:grid-cols-12">
                    <div className="lg:col-span-4">
                        <div className="flex items-center gap-2">
                            <Skeleton className="h-4 w-4 rounded" />
                            <Skeleton className="h-4 w-44" />
                        </div>
                        <Skeleton className="mt-1 ml-6 h-3 w-32" />
                    </div>
                    <div className="flex justify-end lg:col-span-8">
                        <Skeleton className="h-9 w-40 rounded-lg" />
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                    {/* Donut : l'anneau est DESSINÉ, seul son remplissage manque. */}
                    <div className="flex items-center justify-center lg:col-span-4">
                        <div className="relative flex h-64 w-80 items-center justify-center">
                            <div className="h-[190px] w-[190px] rounded-full border-[25px] border-slate-100" />
                            <div className="absolute flex flex-col items-center gap-1.5">
                                <Skeleton className="h-8 w-16" />
                                <Skeleton className="h-3 w-10" />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4 lg:col-span-8">
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                            <SqueletteVignette teinte="bg-slate-50" bordure="border-slate-200" />
                            <SqueletteVignette teinte="bg-emerald-50/50" bordure="border-emerald-200" />
                            <SqueletteVignette teinte="bg-amber-50/50" bordure="border-amber-200" />
                            <SqueletteVignette teinte="bg-red-50/50" bordure="border-red-200" />
                        </div>
                        <SqueletteCanal teinte="bg-blue-50/50" bordure="border-blue-100" />
                        <SqueletteCanal teinte="bg-violet-50/50" bordure="border-violet-100" />
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Tableau des collaborateurs : les en-têtes de colonnes sont VRAIS — on sait
 * déjà ce qu'on va lire, et la largeur des colonnes ne bougera pas.
 */
export function SqueletteTableauCollaborateurs({ lignes = 5 }: { lignes?: number }) {
    const colonnes = [
        { libelle: "Collaborateur", largeur: "w-[22%]", centre: false },
        { libelle: "Appels directs", largeur: "w-[9%]", centre: true },
        { libelle: "Appels d'équipe", largeur: "w-[9%]", centre: true },
        { libelle: "Appels transférés", largeur: "w-[10%]", centre: true },
        { libelle: "Prise en charge totale", largeur: "w-[14%]", centre: true },
        { libelle: "Taux de participation", largeur: "w-[14%]", centre: true },
        { libelle: "Durée totale", largeur: "w-[11%]", centre: true },
        { libelle: "Durée moy.", largeur: "w-[11%]", centre: true },
    ];
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2">
                <Skeleton className="h-5 w-5 rounded" />
                <Skeleton className="h-5 w-56" />
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-slate-200">
                            {colonnes.map((c) => (
                                <th
                                    key={c.libelle}
                                    className={`${c.largeur} whitespace-pre-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 ${c.centre ? "text-center" : "text-left"}`}
                                >
                                    {c.libelle}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {Array.from({ length: lignes }).map((_, i) => (
                            <tr key={i} className="border-b border-slate-100">
                                <td className="px-3 py-3">
                                    <Skeleton className="h-4 w-36" />
                                    <Skeleton className="mt-1.5 h-3 w-16" />
                                </td>
                                {colonnes.slice(1).map((c) => (
                                    <td key={c.libelle} className="px-3 py-3">
                                        <Skeleton className="mx-auto h-4 w-10" />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/**
 * Courbe d'évolution : le cadre, le titre et la légende sont là ; seules les
 * barres manquent. Hauteurs FIXES — un profil qui change à chaque rendu
 * trahit le faux.
 */
export function SqueletteCourbe({ titre = "Évolution du Volume" }: { titre?: string }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between gap-4">
                <h3 className="text-lg font-semibold text-slate-900">{titre}</h3>
                <Skeleton className="h-6 w-40 rounded-full" />
            </div>
            <div className="flex h-[425px] flex-col">
                <div className="flex flex-1 items-end gap-2 pb-3">
                    {HAUTEURS_COURBE.map((h, i) => (
                        <Skeleton key={i} className="flex-1 rounded-sm" style={{ height: `${h}%` }} />
                    ))}
                </div>
                <div className="flex items-center justify-center gap-6 pt-2">
                    {["Répondus", "Perdus", "Débordements"].map((s) => (
                        <span key={s} className="inline-flex items-center gap-1.5">
                            <Skeleton className="h-2.5 w-2.5 rounded-full" />
                            <span className="text-xs font-medium text-slate-400">{s}</span>
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}

/**
 * Carte des affluences : les jours et les heures sont ÉCRITS, la grille a sa
 * densité réelle (7 × 24). Seule l'intensité des cases manque.
 */
export function SqueletteAffluences({ titre = "Carte des Affluences" }: { titre?: string }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h3 className="mb-4 text-lg font-semibold text-slate-900">{titre}</h3>
            <div className="flex h-[425px] w-full flex-col pb-2">
                <div className="mb-1 flex gap-[2px]">
                    <div className="w-8 shrink-0" />
                    {JOURS.map((j) => (
                        <div key={j} className="flex-1 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:text-xs">
                            {j}
                        </div>
                    ))}
                </div>
                <div className="flex flex-1 flex-col gap-[2px]">
                    {HEURES.map((h) => (
                        <div key={h} className="flex flex-1 items-center gap-[2px]">
                            <div className="w-8 shrink-0 pr-2 text-right text-[10px] font-medium text-slate-400">{h}h</div>
                            {JOURS.map((j) => (
                                <Skeleton key={j} className="h-full flex-1 rounded-[2px]" />
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

/** L'écran de statistiques au complet, à sa taille définitive. */
export function SqueletteEcranStats() {
    return (
        <div className="space-y-6">
            <SqueletteBilanEquipe />
            <SqueletteTableauCollaborateurs />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2"><SqueletteCourbe /></div>
                <div className="lg:col-span-1"><SqueletteAffluences /></div>
            </div>
        </div>
    );
}
