import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUsers } from "./actions";
import { UsersClient } from "@/components/users-client";

export default async function UsersPage() {
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }

    const users = await getUsers();

    return <UsersClient users={users} currentUserId={session.user.id} />;
}
