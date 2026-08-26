import { SqueletteEcranStats } from "@/components/stats-v2/squelettes";
import { FilDeProgression } from "@/components/ui/etat-chargement";

/**
 * Première peinture de l'écran de statistiques (repli Suspense).
 *
 * Auparavant : un arc tournant centré sur toute la hauteur de fenêtre, puis
 * l'écran surgissait d'un coup. Désormais la page arrive à sa taille
 * définitive, cadres et titres compris ; seuls les chiffres manquent.
 */
export default function Loading() {
    return (
        <div className="mx-auto max-w-[1800px] space-y-6 p-6">
            <FilDeProgression actif libelle="Calcul des statistiques" />
            <SqueletteEcranStats />
        </div>
    );
}
