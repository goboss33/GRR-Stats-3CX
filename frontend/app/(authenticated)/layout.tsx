import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { HeaderScopeProvider } from "@/components/header-scope";
import { Suspense } from "react";
import Loading from "./loading";
import { prismaAuth } from "@/lib/prisma-auth";
import { cookies } from "next/headers";
import { lireVueEnTantQue } from "@/lib/vue-en-tant-que";
import { COOKIE_VUE_EN_TANT_QUE } from "@/services/domain/vue-en-tant-que";
import { BandeauVueEnTantQue } from "@/components/bandeau-vue-en-tant-que";

export default async function AuthenticatedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    // Un cookie présent mais illisible : le middleware laisse passer, et
    // renvoyer vers /login bouclerait (cf. app/api/session/fin).
    if (!session) {
        redirect("/api/session/fin");
    }

    const handleSignOut = async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
    };

    // « Voir en tant que » : la navigation suit le rôle et les droits de la
    // personne regardée ; le nom et la photo restent ceux de l'administrateur.
    const vue = await lireVueEnTantQue();
    const quitterVue = async () => {
        "use server";
        (await cookies()).delete(COOKIE_VUE_EN_TANT_QUE);
        redirect("/admin/settings?section=users");
    };

    const userRole = vue?.role ?? session.user?.role ?? "AGENT";
    const userFirstName = session.user?.firstName;
    const userLastName = session.user?.lastName;
    const authProvider = session.user?.authProvider || "CREDENTIALS";
    const userName = [userFirstName, userLastName].filter(Boolean).join(" ") || "Utilisateur";

    const dbUser = await prismaAuth.user.findUnique({
        where: { id: session.user.id },
        select: { profilePicture: true, canViewLogs: true, canViewExtensionStats: true }
    });
    // Une session dont le compte n'existe plus (doublon supprimé, compte
    // retiré) ouvrirait une app vide, sans jamais redemander de connexion.
    if (!dbUser) {
        redirect("/api/session/fin");
    }
    const profilePicture = dbUser?.profilePicture || null;
    // Sans les droits « Voir les logs » / « Extension/DDI », les entrées
    // disparaissent de la navigation — les pages et services refusent de
    // toute façon (contrôle côté serveur).
    const droits = vue
        ? await prismaAuth.user.findUnique({ where: { id: vue.id }, select: { canViewLogs: true, canViewExtensionStats: true } })
        : dbUser;
    const canViewLogs = droits?.canViewLogs ?? true;
    const canViewExtensionStats = droits?.canViewExtensionStats ?? true;

    return (
        <div className="flex h-screen bg-slate-50">
            <Sidebar
                userRole={userRole}
                canViewLogs={canViewLogs}
                canViewExtensionStats={canViewExtensionStats}
                user={{
                    firstName: userFirstName,
                    lastName: userLastName,
                }}
                authProvider={authProvider}
                profilePicture={profilePicture}
                signOutAction={handleSignOut}
            />
            {/* min-w-0 est VITAL : sans lui, un item flex ne rétrécit jamais
                sous la largeur minimale de son contenu (min-width:auto). Un
                tableau large dans une page élargirait alors toute cette
                colonne — header compris — au-delà de la fenêtre, et les
                boutons à droite du header seraient clippés hors de l'écran. */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                {vue && <BandeauVueEnTantQue cible={vue} quitter={quitterVue} />}
                {/* Le provider relie les pages au header : elles y déclarent
                    quelles provenances sont préchargées (spinners du toggle). */}
                <HeaderScopeProvider>
                    <Header userName={userName} />
                    <main className="flex-1 overflow-y-auto p-6">
                        <Suspense fallback={<Loading />}>
                            {children}
                        </Suspense>
                    </main>
                </HeaderScopeProvider>
            </div>
        </div>
    );
}
