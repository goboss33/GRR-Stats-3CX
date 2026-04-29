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

    const userFirstName = (session.user as any)?.firstName;
    const userLastName = (session.user as any)?.lastName;
    const userName = [userFirstName, userLastName].filter(Boolean).join(" ") || "Utilisateur";

    return (
        <div className="flex h-screen bg-slate-50">
            <Sidebar
                userRole={session.user?.role || "USER"}
                user={{
                    firstName: userFirstName,
                    lastName: userLastName,
                    email: session.user?.email,
                }}
                signOutAction={handleSignOut}
            />
            <div className="flex-1 flex flex-col overflow-hidden">
                <Header userRole={session.user?.role || "USER"} userName={userName} />
                <main className="flex-1 overflow-y-auto p-6">
                    <Suspense fallback={<Loading />}>
                        {children}
                    </Suspense>
                </main>
            </div>
        </div>
    );
}
