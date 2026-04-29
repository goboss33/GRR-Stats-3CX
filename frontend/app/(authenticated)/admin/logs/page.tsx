import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import LogsClient from "./logs-client";

export default async function AdminLogsPage() {
    const session = await auth();

    if (!session?.user || session.user.role !== "ADMIN") {
        redirect("/dashboard");
    }

    return <LogsClient />;
}
