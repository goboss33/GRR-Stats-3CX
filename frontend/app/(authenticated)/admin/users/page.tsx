import { requirePageRole } from "@/lib/auth-guard";
import { getUsers } from "./actions";
import { UsersClient } from "@/components/users-client";

export default async function UsersPage() {
    // Gestion des utilisateurs réservée aux administrateurs (cohérent avec les
    // Server Actions ADMIN-only de ./actions).
    const user = await requirePageRole(["ADMIN"]);

    const users = await getUsers();

    return <UsersClient users={users} currentUserId={user.id} />;
}
