import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { Suspense } from "react";
import Loading from "./loading";

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
    const userName = [userFirstName, userLastName].filter(Boolean).join(" ") || "Utilisateur";

    return (
        <div className="flex h-screen bg-slate-50">
            <Sidebar
                userRole={userRole}
                user={{
                    firstName: userFirstName,
                    lastName: userLastName,
                }}
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
