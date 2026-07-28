"use client";

import { toast } from "sonner";

import { useState, useEffect } from "react";
import { Loader2, KeyRound, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface UserProfile {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    authProvider: string;
    profilePicture: string | null;
    jobTitle: string | null;
    department: string | null;
    mobilePhone: string | null;
    officeLocation: string | null;
    createdAt: string;
}

export function PersonalInfoTab() {
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    // Adaptateur : route les appels setMessage(...) existants vers les toasts.
    const setMessage = (m: { type: "success" | "error"; text: string } | null) => {
        if (!m) return;
        if (m.type === "success") toast.success(m.text);
        else toast.error(m.text);
    };

    useEffect(() => {
        fetch("/api/profile")
            .then((res) => res.json())
            .then((data) => {
                if (data.user) {
                    setProfile(data.user);
                    setFirstName(data.user.firstName || "");
                    setLastName(data.user.lastName || "");
                    setEmail(data.user.email);
                }
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const body: { firstName: string; lastName: string; email: string; password?: string } = { firstName, lastName, email };
            if (password) body.password = password;
            const res = await fetch("/api/profile", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) {
                setMessage({ type: "error", text: data.error || "Erreur lors de la sauvegarde" });
            } else {
                setProfile(data.user);
                setMessage({ type: "success", text: "Profil mis à jour avec succès" });
                setPassword("");
            }
        } catch {
            setMessage({ type: "error", text: "Erreur lors de la sauvegarde" });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                <span className="ml-2 text-slate-500">Chargement du profil...</span>
            </div>
        );
    }

    const isMicrosoft = profile?.authProvider === "MICROSOFT";

    return (
        <div className="space-y-6 max-w-2xl">

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        Profil
                        {isMicrosoft && (
                            <svg className="h-5 w-5" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                                <path d="M0 0h10v10H0z" fill="#f25022" />
                                <path d="M11 0h10v10h-10z" fill="#7fba00" />
                                <path d="M0 11h10v10H0z" fill="#00a4ef" />
                                <path d="M11 11h10v10h-10z" fill="#ffb900" />
                            </svg>
                        )}
                    </CardTitle>
                    <CardDescription>
                        {isMicrosoft
                            ? "Vos informations sont synchronisées depuis votre compte Microsoft"
                            : "Vos informations personnelles"}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {profile?.profilePicture && (
                        <div className="flex items-center gap-4">
                            <img
                                src={profile.profilePicture}
                                alt="Photo de profil"
                                className="h-16 w-16 rounded-full object-cover"
                            />
                            <div>
                                <p className="text-sm font-medium text-slate-900">{firstName} {lastName}</p>
                                <p className="text-xs text-slate-500">{email}</p>
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="firstName">Prénom</Label>
                            <Input
                                id="firstName"
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                placeholder="Votre prénom"
                                disabled={isMicrosoft}
                                className={isMicrosoft ? "bg-slate-100" : ""}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="lastName">Nom</Label>
                            <Input
                                id="lastName"
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                placeholder="Votre nom"
                                disabled={isMicrosoft}
                                className={isMicrosoft ? "bg-slate-100" : ""}
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
                            placeholder="votre@email.com"
                            disabled={isMicrosoft}
                            className={isMicrosoft ? "bg-slate-100" : ""}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="role">Rôle</Label>
                        <Input
                            id="role"
                            value={profile?.role === "ADMIN" ? "Administrateur" : profile?.role === "SUPERUSER" ? "Manager" : profile?.role === "MODERATOR" ? "Modérateur" : "Utilisateur"}
                            disabled
                            className="bg-slate-100"
                        />
                    </div>

                    {isMicrosoft && (
                        <>
                            {profile?.jobTitle && (
                                <div className="space-y-2">
                                    <Label htmlFor="jobTitle">Fonction</Label>
                                    <Input id="jobTitle" value={profile.jobTitle} disabled className="bg-slate-100" />
                                </div>
                            )}
                            {profile?.department && (
                                <div className="space-y-2">
                                    <Label htmlFor="department">Département</Label>
                                    <Input id="department" value={profile.department} disabled className="bg-slate-100" />
                                </div>
                            )}
                            {profile?.mobilePhone && (
                                <div className="space-y-2">
                                    <Label htmlFor="mobilePhone">Téléphone mobile</Label>
                                    <Input id="mobilePhone" value={profile.mobilePhone} disabled className="bg-slate-100" />
                                </div>
                            )}
                            {profile?.officeLocation && (
                                <div className="space-y-2">
                                    <Label htmlFor="officeLocation">Bureau</Label>
                                    <Input id="officeLocation" value={profile.officeLocation} disabled className="bg-slate-100" />
                                </div>
                            )}
                        </>
                    )}

                    {!isMicrosoft && (
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sauvegarde...</> : <><Save className="mr-2 h-4 w-4" /> Enregistrer</>}
                        </Button>
                    )}
                </CardContent>
            </Card>

            {!isMicrosoft && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <KeyRound className="h-5 w-5" />
                            Changer le mot de passe
                        </CardTitle>
                        <CardDescription>Laissez vide si vous ne souhaitez pas le modifier</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="new-password">Nouveau mot de passe</Label>
                            <Input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 8 caractères" />
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
