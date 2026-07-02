import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
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

    const userRole = session.user?.role || "USER";
    const userFirstName = (session.user as any)?.firstName;
    const userLastName = (session.user as any)?.lastName;
    const authProvider = (session.user as any)?.authProvider || "CREDENTIALS";
    const userName = [userFirstName, userLastName].filter(Boolean).join(" ") || "Utilisateur";

    const dbUser = await prismaAuth.user.findUnique({
        where: { id: session.user.id },
        select: { profilePicture: true }
    });
    const profilePicture = dbUser?.profilePicture || null;

    return (
        <div className="flex h-screen bg-slate-50">
            <Sidebar
                userRole={userRole}
                user={{
                    firstName: userFirstName,
                    lastName: userLastName,
                }}
                authProvider={authProvider}
                profilePicture={profilePicture}
                signOutAction={handleSignOut}
            />
            <div className="flex-1 flex flex-col overflow-hidden">
                <Header userRole={userRole} userName={userName} />
                <main className="flex-1 overflow-y-auto p-6">
                    <Suspense fallback={<Loading />}>
                        {children}
                    </Suspense>
                </main>
            </div>
        </div>
    );
}
