import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { HeaderScopeProvider } from "@/components/header-scope";
import { Suspense } from "react";
import Loading from "./loading";
import { prismaAuth } from "@/lib/prisma-auth";

export default async function AuthenticatedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    if (!session) {
        redirect("/login");
    }

    const handleSignOut = async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
    };

    const userRole = session.user?.role || "AGENT";
    const userFirstName = session.user?.firstName;
    const userLastName = session.user?.lastName;
    const authProvider = session.user?.authProvider || "CREDENTIALS";
    const userName = [userFirstName, userLastName].filter(Boolean).join(" ") || "Utilisateur";

    const dbUser = await prismaAuth.user.findUnique({
        where: { id: session.user.id },
        select: { profilePicture: true, canViewLogs: true }
    });
    const profilePicture = dbUser?.profilePicture || null;
    // Sans le droit « Voir les logs », l'entrée disparaît de la navigation —
    // la page et le service refusent de toute façon (contrôle côté serveur).
    const canViewLogs = dbUser?.canViewLogs ?? true;

    return (
        <div className="flex h-screen bg-slate-50">
            <Sidebar
                userRole={userRole}
                canViewLogs={canViewLogs}
                user={{
                    firstName: userFirstName,
                    lastName: userLastName,
                }}
                authProvider={authProvider}
                profilePicture={profilePicture}
                signOutAction={handleSignOut}
            />
            <div className="flex-1 flex flex-col overflow-hidden">
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
