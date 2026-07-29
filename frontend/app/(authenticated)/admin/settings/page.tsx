import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import SettingsClient from "./settings-client";

export default async function AdminSettingsPage() {
    const session = await auth();

    if (!session?.user) {
        redirect("/login");
    }

    // Tout utilisateur authentifié accède à « Informations personnelles » ; les onglets
    // d'administration sont filtrés par rôle (cf. PRD droits d'accès §4.1). Ce filtrage
    // d'affichage est doublé par les gardes serveur des routes API correspondantes.
    return <SettingsClient userRole={session.user.role} />;
}
