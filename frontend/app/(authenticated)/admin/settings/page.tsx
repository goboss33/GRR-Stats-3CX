import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import SettingsClient from "./settings-client";

export default async function AdminSettingsPage() {
    const session = await auth();

    if (!session?.user || session.user.role !== "ADMIN") {
        redirect("/dashboard");
    }

    return <SettingsClient />;
}
