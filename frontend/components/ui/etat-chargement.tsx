"use client";

import { AlertTriangle, RotateCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Signaux d'état des chargements — la réponse à « on ne sait pas si ça a
 * planté ou s'il faut continuer d'attendre ».
 *
 * Deux pièces, une doctrine : l'écran ne ment jamais sur ce qu'il fait.
 * Tant qu'un calcul court, un fil de progression le dit ; quand il échoue,
 * un message le dit et propose de réessayer. Jamais d'écran vide muet, et
 * jamais de pourcentage inventé : la durée d'un calcul n'est pas connue
 * d'avance, une barre qui prétendrait le contraire tromperait.
 */

/**
 * Fil de progression indéterminé, à poser en haut d'une zone qui recalcule.
 *
 * Épaisseur volontairement minime (2 px) : il informe sans occuper. Il ne
 * réserve pas de place quand il est inactif — la zone ne saute donc pas au
 * démarrage ni à la fin du chargement.
 */
export function FilDeProgression({
    actif,
    className,
    libelle = "Calcul en cours",
}: {
    actif: boolean;
    className?: string;
    /** Annonce faite aux lecteurs d'écran. */
    libelle?: string;
}) {
    if (!actif) return null;
    return (
        <div
            role="progressbar"
            aria-label={libelle}
            aria-busy="true"
            className={cn("h-0.5 w-full overflow-hidden rounded-full bg-blue-100", className)}
        >
            {/* motion-safe : sans animation système, le segment reste visible
                et immobile — le signal « ça travaille » subsiste. */}
            <div className="h-full w-1/4 rounded-full bg-blue-600 motion-safe:animate-glissement" />
        </div>
    );
}

/**
 * Zone en échec : ce qui a manqué, et le bouton pour réessayer.
 *
 * Prend la place du contenu attendu plutôt que de laisser un vide, et n'est
 * jamais plus grande que nécessaire — une panne partielle ne doit pas
 * bousculer le reste de l'écran.
 */
export function ZoneEnEchec({
    message,
    onReessayer,
    enCours = false,
    className,
}: {
    /** Ce qui n'a pas pu être fait, en une phrase. */
    message: string;
    onReessayer?: () => void;
    /** Une nouvelle tentative est déjà en route. */
    enCours?: boolean;
    className?: string;
}) {
    return (
        <div
            role="alert"
            className={cn(
                "flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50/60 p-5 sm:flex-row sm:items-center sm:justify-between",
                className,
            )}
        >
            <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
                <div>
                    <p className="text-sm font-semibold text-red-900">Ces chiffres n&apos;ont pas pu être chargés</p>
                    <p className="mt-0.5 text-sm text-red-700">{message}</p>
                </div>
            </div>
            {onReessayer && (
                <button
                    type="button"
                    onClick={onReessayer}
                    disabled={enCours}
                    className={cn(
                        "inline-flex flex-shrink-0 items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-2",
                        "text-sm font-medium text-red-800 transition-colors",
                        "hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600",
                        "disabled:cursor-wait disabled:opacity-60",
                    )}
                >
                    {enCours
                        ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
                        : <RotateCw className="h-4 w-4" />}
                    {enCours ? "Nouvelle tentative…" : "Réessayer"}
                </button>
            )}
        </div>
    );
}

/**
 * Enveloppe des chiffres encore affichés pendant un recalcul.
 *
 * Changer de période ne doit pas vider l'écran : les chiffres précédents
 * restent lisibles, estompés, jusqu'à l'arrivée des nouveaux. On évite ainsi
 * le clignotement, le saut de mise en page, et la perte du repère visuel.
 * L'estompage est le signal que ces chiffres ne sont plus ceux demandés.
 */
export function ContenuPerime({
    perime,
    children,
    className,
}: {
    perime: boolean;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            aria-busy={perime || undefined}
            className={cn(
                "transition-opacity duration-200",
                perime && "pointer-events-none select-none opacity-45",
                className,
            )}
        >
            {children}
        </div>
    );
}
