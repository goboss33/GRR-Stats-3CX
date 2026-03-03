"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Role } from "@prisma/client";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from "@/components/ui/dialog";
import { UserFormDialog } from "@/components/user-form-dialog";
import {
    createUser,
    updateUser,
    deleteUser,
    type UserRow,
} from "@/app/(authenticated)/admin/users/actions";

const roleBadgeVariants: Record<Role, string> = {
    ADMIN: "bg-red-100 text-red-700 border-red-200",
    SUPERUSER: "bg-amber-100 text-amber-700 border-amber-200",
    USER: "bg-green-100 text-green-700 border-green-200",
};

const roleLabels: Record<Role, string> = {
    ADMIN: "Administrateur",
    SUPERUSER: "Manager",
    USER: "Utilisateur",
};

interface UsersClientProps {
    users: UserRow[];
    currentUserId: string;
}

export function UsersClient({ users, currentUserId }: UsersClientProps) {
    const router = useRouter();
    const [formOpen, setFormOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<UserRow | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState("");

    const handleCreate = () => {
        setEditingUser(null);
        setFormOpen(true);
    };

    const handleEdit = (user: UserRow) => {
        setEditingUser(user);
        setFormOpen(true);
    };

    const handleFormSubmit = async (data: {
        email: string;
        name: string;
        role: Role;
        password?: string;
    }) => {
        if (editingUser) {
            const result = await updateUser(editingUser.id, data);
            if (result.success) router.refresh();
            return result;
        } else {
            if (!data.password) {
                return { success: false as const, error: "Le mot de passe est requis" };
            }
            const result = await createUser({
                email: data.email,
                name: data.name,
                role: data.role,
                password: data.password,
            });
            if (result.success) router.refresh();
            return result;
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setIsDeleting(true);
        setDeleteError("");
        const result = await deleteUser(deleteTarget.id);
        setIsDeleting(false);
        if (result.success) {
            setDeleteTarget(null);
            router.refresh();
        } else {
            setDeleteError(result.error);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">
                        Gestion des utilisateurs
                    </h1>
                    <p className="text-slate-500">
                        {users.length} utilisateur{users.length !== 1 ? "s" : ""}
                    </p>
                </div>
                <Button onClick={handleCreate}>
                    <Plus className="h-4 w-4 mr-2" />
                    Ajouter un utilisateur
                </Button>
            </div>

            {/* Table */}
            <div className="border rounded-lg">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Nom</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Rôle</TableHead>
                            <TableHead>Créé le</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {users.map((user) => {
                            const isSelf = user.id === currentUserId;
                            return (
                                <TableRow key={user.id}>
                                    <TableCell className="font-medium">
                                        {user.name || "—"}
                                        {isSelf && (
                                            <span className="ml-2 text-xs text-muted-foreground">
                                                (vous)
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell>{user.email}</TableCell>
                                    <TableCell>
                                        <Badge
                                            variant="outline"
                                            className={roleBadgeVariants[user.role]}
                                        >
                                            {roleLabels[user.role]}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {format(new Date(user.createdAt), "d MMM yyyy", {
                                            locale: fr,
                                        })}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleEdit(user)}
                                                title="Modifier"
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => setDeleteTarget(user)}
                                                disabled={isSelf}
                                                title={
                                                    isSelf
                                                        ? "Vous ne pouvez pas supprimer votre propre compte"
                                                        : "Supprimer"
                                                }
                                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                        {users.length === 0 && (
                            <TableRow>
                                <TableCell
                                    colSpan={5}
                                    className="text-center text-muted-foreground py-8"
                                >
                                    Aucun utilisateur
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Create/Edit Dialog */}
            <UserFormDialog
                open={formOpen}
                onOpenChange={setFormOpen}
                user={editingUser}
                currentUserId={currentUserId}
                onSubmit={handleFormSubmit}
            />

            {/* Delete Confirmation Dialog */}
            <Dialog
                open={!!deleteTarget}
                onOpenChange={(open) => {
                    if (!open) {
                        setDeleteTarget(null);
                        setDeleteError("");
                    }
                }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Supprimer l&apos;utilisateur</DialogTitle>
                        <DialogDescription>
                            Êtes-vous sûr de vouloir supprimer{" "}
                            <span className="font-medium text-slate-900">
                                {deleteTarget?.name || deleteTarget?.email}
                            </span>{" "}
                            ? Cette action est irréversible.
                        </DialogDescription>
                    </DialogHeader>
                    {deleteError && (
                        <p className="text-sm text-red-600 bg-red-50 p-2 rounded">
                            {deleteError}
                        </p>
                    )}
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDeleteTarget(null)}
                        >
                            Annuler
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleDelete}
                            disabled={isDeleting}
                        >
                            {isDeleting ? "Suppression..." : "Supprimer"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
