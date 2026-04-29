"use client";

import { useState, useEffect } from "react";
import { Role } from "@prisma/client";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { UserRow } from "@/app/(authenticated)/admin/users/actions";

interface UserFormDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    user: UserRow | null;
    currentUserId: string;
    onSubmit: (data: {
        email: string;
        firstName: string;
        lastName: string;
        role: Role;
        password?: string;
    }) => Promise<{ success: boolean; error?: string }>;
}

export function UserFormDialog({
    open,
    onOpenChange,
    user,
    currentUserId,
    onSubmit,
}: UserFormDialogProps) {
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [role, setRole] = useState<Role>("USER");
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const isEdit = !!user;
    const isSelf = user?.id === currentUserId;

    useEffect(() => {
        if (open) {
            setFirstName(user?.firstName ?? "");
            setLastName(user?.lastName ?? "");
            setEmail(user?.email ?? "");
            setPassword("");
            setRole(user?.role ?? "USER");
            setError("");
        }
    }, [open, user]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setIsLoading(true);

        const data: { email: string; firstName: string; lastName: string; role: Role; password?: string } = {
            email,
            firstName,
            lastName,
            role,
        };
        if (password) {
            data.password = password;
        }

        const result = await onSubmit(data);
        setIsLoading(false);

        if (!result.success) {
            setError(result.error ?? "Une erreur est survenue");
        } else {
            onOpenChange(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {isEdit ? "Modifier l'utilisateur" : "Nouvel utilisateur"}
                    </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="firstName">Prénom</Label>
                            <Input
                                id="firstName"
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                placeholder="Jean"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="lastName">Nom</Label>
                            <Input
                                id="lastName"
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                placeholder="Dupont"
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="jean@exemple.com"
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="password">
                            Mot de passe{isEdit ? " (laisser vide pour ne pas changer)" : ""}
                        </Label>
                        <Input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required={!isEdit}
                            minLength={4}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="role">Rôle</Label>
                        <Select
                            value={role}
                            onValueChange={(v) => setRole(v as Role)}
                            disabled={isSelf}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ADMIN">Administrateur</SelectItem>
                                <SelectItem value="SUPERUSER">Manager</SelectItem>
                                <SelectItem value="USER">Utilisateur</SelectItem>
                            </SelectContent>
                        </Select>
                        {isSelf && (
                            <p className="text-xs text-muted-foreground">
                                Vous ne pouvez pas modifier votre propre rôle
                            </p>
                        )}
                    </div>

                    {error && (
                        <p className="text-sm text-red-600 bg-red-50 p-2 rounded">
                            {error}
                        </p>
                    )}

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Annuler
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading
                                ? "Enregistrement..."
                                : isEdit
                                  ? "Enregistrer"
                                  : "Créer"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
