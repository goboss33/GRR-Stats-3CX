import { requirePageRole } from "@/lib/auth-guard";

/**
 * La documentation technique (décisions métier, contrat d'API) s'adresse aux
 * seuls administrateurs. Retirer l'entrée du menu ne protège rien : la porte
 * se ferme ICI, donc une URL tapée à la main est refusée de la même façon.
 * Le layout couvre /documentation ET /documentation/api d'un seul geste.
 */
export default async function DocumentationLayout({ children }: { children: React.ReactNode }) {
    await requirePageRole(["ADMIN"]);
    return <>{children}</>;
}
