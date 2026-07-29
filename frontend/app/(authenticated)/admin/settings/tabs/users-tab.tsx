"use client";

import { toast } from "sonner";

import { useState, useEffect } from "react";
import { Loader2, UserPlus, Pencil, Trash2, Lock, ShieldCheck } from "lucide-react";
import { UserAccessDialog } from "@/components/user-access-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AppUser {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    authProvider: string;
    createdAt: string;
}

export function UsersTab() {
    const [users, setUsers] = useState<AppUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [currentUserRole, setCurrentUserRole] = useState<string>("AGENT");
    const [editUser, setEditUser] = useState<AppUser | null>(null);
    const [editForm, setEditForm] = useState({ firstName: "", lastName: "", email: "", role: "" });
    const [editLoading, setEditLoading] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
    // Adaptateur : route les appels setMessage(...) existants vers les toasts.
    const setMessage = (m: { type: "success" | "error"; text: string } | null) => {
        if (!m) return;
        if (m.type === "success") toast.success(m.text);
        else toast.error(m.text);
    };
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [createForm, setCreateForm] = useState({ firstName: "", lastName: "", email: "", password: "", role: "AGENT" });
    const [createLoading, setCreateLoading] = useState(false);

    const loadUsers = () => {
        fetch("/api/admin/users")
            .then((res) => res.json())
            .then((data) => {
                setUsers(data.users || []);
                setIsLoading(false);
            })
            .catch(() => setIsLoading(false));
    };

    useEffect(() => {
        loadUsers();
        fetch("/api/profile")
            .then((res) => res.json())
            .then((data) => {
                if (data.user) {
                    setCurrentUserId(data.user.id);
                    setCurrentUserRole(data.user.role || "AGENT");
                }
            });
    }, []);

    const [accessUser, setAccessUser] = useState<AppUser | null>(null);

    const openEdit = (user: AppUser) => {
        setEditUser(user);
        setEditForm({ firstName: user.firstName || "", lastName: user.lastName || "", email: user.email, role: user.role });
    };

    const handleEdit = async () => {
        if (!editUser) return;
        setEditLoading(true);
        try {
            const res = await fetch("/api/admin/users", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: editUser.id, ...editForm }),
            });
            const data = await res.json();
            if (!res.ok) {
                setMessage({ type: "error", text: data.error || "Erreur lors de la modification" });
            } else {
                setMessage({ type: "success", text: "Utilisateur modifié avec succès" });
                setEditUser(null);
                loadUsers();
            }
        } catch {
            setMessage({ type: "error", text: "Erreur lors de la modification" });
        } finally {
            setEditLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Êtes-vous sûr de vouloir supprimer cet utilisateur ?")) return;
        setDeleteLoading(id);
        try {
            const res = await fetch(`/api/admin/users?id=${id}`, { method: "DELETE" });
            const data = await res.json();
            if (!res.ok) {
                setMessage({ type: "error", text: data.error || "Erreur lors de la suppression" });
            } else {
                setMessage({ type: "success", text: "Utilisateur supprimé avec succès" });
                loadUsers();
            }
        } catch {
            setMessage({ type: "error", text: "Erreur lors de la suppression" });
        } finally {
            setDeleteLoading(null);
        }
    };

    const handleCreate = async () => {
        setCreateLoading(true);
        try {
            const res = await fetch("/api/admin/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(createForm),
            });
            const data = await res.json();
            if (!res.ok) {
                setMessage({ type: "error", text: data.error || "Erreur lors de la création" });
            } else {
                setMessage({ type: "success", text: "Utilisateur créé avec succès" });
                setCreateDialogOpen(false);
                setCreateForm({ firstName: "", lastName: "", email: "", password: "", role: "AGENT" });
                loadUsers();
            }
        } catch {
            setMessage({ type: "error", text: "Erreur lors de la création" });
        } finally {
            setCreateLoading(false);
        }
    };

    const getDisplayName = (user: AppUser) => {
        const parts = [user.firstName, user.lastName].filter(Boolean);
        return parts.length > 0 ? parts.join(" ") : "—";
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                <span className="ml-2 text-slate-500">Chargement des utilisateurs...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6">

            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-slate-900">Gestion des utilisateurs</h2>
                    <p className="text-sm text-slate-500">{users.length} utilisateur(s) enregistré(s)</p>
                </div>
                <Button onClick={() => setCreateDialogOpen(true)}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Ajouter un utilisateur
                </Button>
            </div>

            <Card>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 border-b">
                                <tr>
                                    <th className="text-left py-3 px-4 font-medium text-slate-600">Nom</th>
                                    <th className="text-left py-3 px-4 font-medium text-slate-600">Email</th>
                                    <th className="text-left py-3 px-4 font-medium text-slate-600">Rôle</th>
                                    <th className="text-left py-3 px-4 font-medium text-slate-600">Connexion</th>
                                    <th className="text-left py-3 px-4 font-medium text-slate-600">Créé le</th>
                                    <th className="text-right py-3 px-4 font-medium text-slate-600">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {users.map((user) => {
                                    const isSelf = user.id === currentUserId;
                                    const isTargetAdmin = user.role === "ADMIN";
                                    const isModerator = currentUserRole === "MODERATOR";
                                    const canEdit = !isModerator || !isTargetAdmin;
                                    const canDelete = !isSelf && (!isModerator || !isTargetAdmin);
                                    const isMicrosoft = user.authProvider === "MICROSOFT";
                                    return (
                                        <tr key={user.id} className="hover:bg-slate-50">
                                            <td className="py-3 px-4 font-medium">{getDisplayName(user)}</td>
                                            <td className="py-3 px-4 text-slate-500">{user.email}</td>
                                            <td className="py-3 px-4">
                                                <Badge
                                                    variant="outline"
                                                    className={cn(
                                                        user.role === "ADMIN" && "bg-red-50 text-red-700 border-red-200",
                                                        user.role === "MANAGER" && "bg-amber-50 text-amber-700 border-amber-200",
                                                        user.role === "MODERATOR" && "bg-blue-50 text-blue-700 border-blue-200",
                                                        user.role === "AGENT" && "bg-green-50 text-green-700 border-green-200"
                                                    )}
                                                >
                                                    {user.role === "ADMIN" ? "Administrateur" : user.role === "MANAGER" ? "Manager" : user.role === "MODERATOR" ? "Modérateur" : "Agent"}
                                                </Badge>
                                            </td>
                                            <td className="py-3 px-4">
                                                {isMicrosoft ? (
                                                    <div className="flex items-center gap-1.5">
                                                        <svg className="h-4 w-4" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                                                            <path d="M0 0h10v10H0z" fill="#f25022" />
                                                            <path d="M11 0h10v10h-10z" fill="#7fba00" />
                                                            <path d="M0 11h10v10H0z" fill="#00a4ef" />
                                                            <path d="M11 11h10v10h-10z" fill="#ffb900" />
                                                        </svg>
                                                        <span className="text-xs text-slate-500">Microsoft</span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1.5">
                                                        <Lock className="h-4 w-4 text-slate-400" />
                                                        <span className="text-xs text-slate-500">Mot de passe</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="py-3 px-4 text-slate-500">{new Date(user.createdAt).toLocaleDateString("fr-FR")}</td>
                                            <td className="py-3 px-4">
                                                <div className="flex items-center justify-end gap-2">
                                                    {isSelf && (
                                                        <span className="text-xs text-slate-400 italic">Vous</span>
                                                    )}
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                        title="Gérer les accès (tenants, périmètre, permissions)"
                                                        onClick={() => setAccessUser(user)}
                                                    >
                                                        <ShieldCheck className="h-4 w-4" />
                                                    </Button>
                                                    {!isSelf && canEdit && (
                                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(user)}>
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    {!isSelf && canDelete && (
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(user.id)} disabled={deleteLoading === user.id}>
                                                            {deleteLoading === user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {users.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="py-8 text-center text-slate-500">
                                            Aucun utilisateur trouvé
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            <UserAccessDialog
                user={accessUser}
                open={!!accessUser}
                onOpenChange={(open) => !open && setAccessUser(null)}
            />

            {/* Edit Dialog */}
            <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Modifier l'utilisateur</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Prénom</Label>
                                <Input value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Nom</Label>
                                <Input value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Rôle</Label>
                            <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v })}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="AGENT">Agent</SelectItem>
                                    <SelectItem value="MODERATOR">Modérateur</SelectItem>
                                    <SelectItem value="MANAGER">Manager</SelectItem>
                                    {currentUserRole === "ADMIN" && <SelectItem value="ADMIN">Administrateur</SelectItem>}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditUser(null)}>Annuler</Button>
                        <Button onClick={handleEdit} disabled={editLoading}>
                            {editLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sauvegarde...</> : "Enregistrer"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Create Dialog */}
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Ajouter un utilisateur</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Prénom</Label>
                                <Input value={createForm.firstName} onChange={(e) => setCreateForm({ ...createForm, firstName: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Nom</Label>
                                <Input value={createForm.lastName} onChange={(e) => setCreateForm({ ...createForm, lastName: e.target.value })} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Mot de passe</Label>
                            <Input type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} placeholder="Minimum 8 caractères" />
                        </div>
                        <div className="space-y-2">
                            <Label>Rôle</Label>
                            <Select value={createForm.role} onValueChange={(v) => setCreateForm({ ...createForm, role: v })}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="AGENT">Agent</SelectItem>
                                    <SelectItem value="MODERATOR">Modérateur</SelectItem>
                                    <SelectItem value="MANAGER">Manager</SelectItem>
                                    {currentUserRole === "ADMIN" && <SelectItem value="ADMIN">Administrateur</SelectItem>}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Annuler</Button>
                        <Button onClick={handleCreate} disabled={createLoading}>
                            {createLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Création...</> : "Créer"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
