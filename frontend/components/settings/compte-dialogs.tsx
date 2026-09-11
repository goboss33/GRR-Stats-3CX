"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * LES DEUX DIALOGUES DE COMPTE hérités de l'ancien écran Utilisateurs :
 * créer un compte à mot de passe (pour qui n'est pas au 3CX — prestataire,
 * compte de test) et modifier un compte existant. Ils parlent aux mêmes
 * routes qu'avant ; seul l'écran qui les héberge a changé.
 */

export interface CompteEditable {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
}

function ChoixRole({ value, onChange, roleCourant }: { value: string; onChange: (v: string) => void; roleCourant: string }) {
    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
                <SelectItem value="AGENT">Collaborateur</SelectItem>
                <SelectItem value="MODERATOR">Modérateur</SelectItem>
                <SelectItem value="MANAGER">Manager</SelectItem>
                {roleCourant === "ADMIN" && <SelectItem value="ADMIN">Administrateur</SelectItem>}
            </SelectContent>
        </Select>
    );
}

export function NouveauCompteDialog({ open, onOpenChange, roleCourant, onCree }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    roleCourant: string;
    onCree: () => void;
}) {
    const vide = { firstName: "", lastName: "", email: "", password: "", role: "AGENT" };
    const [form, setForm] = useState(vide);
    const [envoi, setEnvoi] = useState(false);
    useEffect(() => { if (open) setForm(vide); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const creer = async () => {
        setEnvoi(true);
        try {
            const res = await fetch("/api/admin/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            });
            const data = await res.json();
            if (!res.ok) toast.error(data.error || "Erreur lors de la création");
            else { toast.success("Compte créé"); onOpenChange(false); onCree(); }
        } catch {
            toast.error("Erreur lors de la création");
        } finally {
            setEnvoi(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Nouveau compte à mot de passe</DialogTitle>
                    <DialogDescription>
                        Pour qui n&apos;est pas au 3CX : prestataire, compte de test. Un collaborateur se prépare depuis sa ligne, sans mot de passe.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label>Prénom</Label><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
                        <div className="space-y-2"><Label>Nom</Label><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
                    </div>
                    <div className="space-y-2"><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                    <div className="space-y-2"><Label>Mot de passe</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Minimum 8 caractères" /></div>
                    <div className="space-y-2"><Label>Rôle</Label><ChoixRole value={form.role} onChange={(v) => setForm({ ...form, role: v })} roleCourant={roleCourant} /></div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
                    <Button onClick={creer} disabled={envoi}>
                        {envoi ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Création…</> : "Créer"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function ModifierCompteDialog({ compte, onClose, roleCourant, onModifie }: {
    compte: CompteEditable | null;
    onClose: () => void;
    roleCourant: string;
    onModifie: () => void;
}) {
    const [form, setForm] = useState({ firstName: "", lastName: "", email: "", role: "AGENT" });
    const [envoi, setEnvoi] = useState(false);
    useEffect(() => {
        if (compte) setForm({ firstName: compte.firstName ?? "", lastName: compte.lastName ?? "", email: compte.email, role: compte.role });
    }, [compte]);

    const enregistrer = async () => {
        if (!compte) return;
        setEnvoi(true);
        try {
            const res = await fetch("/api/admin/users", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: compte.id, ...form }),
            });
            const data = await res.json();
            if (!res.ok) toast.error(data.error || "Erreur lors de la modification");
            else { toast.success("Compte modifié"); onClose(); onModifie(); }
        } catch {
            toast.error("Erreur lors de la modification");
        } finally {
            setEnvoi(false);
        }
    };

    return (
        <Dialog open={compte !== null} onOpenChange={(o) => !o && onClose()}>
            <DialogContent>
                <DialogHeader><DialogTitle>Modifier le compte</DialogTitle></DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2"><Label>Prénom</Label><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
                        <div className="space-y-2"><Label>Nom</Label><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
                    </div>
                    <div className="space-y-2"><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                    <div className="space-y-2"><Label>Rôle</Label><ChoixRole value={form.role} onChange={(v) => setForm({ ...form, role: v })} roleCourant={roleCourant} /></div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Annuler</Button>
                    <Button onClick={enregistrer} disabled={envoi}>
                        {envoi ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sauvegarde…</> : "Enregistrer"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
