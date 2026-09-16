import { redirect } from "next/navigation";

import { auth, signOut } from "@/lib/auth";
import { prismaAuth } from "@/lib/prisma-auth";

/**
 * FIN D'UNE SESSION SANS COMPTE (sept. 2026).
 *
 * Une session vit trente jours dans un cookie qui désigne un compte par son
 * identifiant. Quand ce compte disparaît — les six doublons supprimés le
 * 16 sept. 2026 —, le navigateur garde une session valide et l'app s'ouvrait
 * VIDE, sans jamais redemander de connexion. Le layout authentifié renvoie
 * ici : on efface le cookie et l'on repart de la page de connexion.
 *
 * Une route, et non un simple renvoi vers /login : un composant serveur ne
 * peut pas effacer un cookie, et le middleware renvoie /login vers le tableau
 * de bord tant que le cookie existe — la boucle serait sans fin.
 *
 * Une adresse qui déconnecte pourrait servir à déconnecter quelqu'un contre
 * son gré, par un lien piégé : on ne déconnecte donc QUE si la session ne
 * désigne plus aucun compte. Une session saine repart au tableau de bord.
 */
export async function GET() {
    const session = await auth();
    const id = session?.user?.id;
    const compte = id ? await prismaAuth.user.findUnique({ where: { id }, select: { id: true } }) : null;
    if (compte) redirect("/dashboard");
    await signOut({ redirectTo: "/login?error=SessionExpiree" });
}
