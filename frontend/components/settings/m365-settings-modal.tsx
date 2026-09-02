"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Cloud, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { etatSecret, ROLES_GRAPH_REQUIS } from "@/lib/graph-diagnostic";

/**
 * RÉGLAGES DE L'INTÉGRATION MICROSOFT 365 — photos et titres de poste des
 * collaborateurs, lus dans Microsoft Graph.
 *
 * Même patron que la surcouche XAPI : par tenant, derrière une roue dentée,
 * secret en écriture seule, test avec les identifiants ENREGISTRÉS. Le choix
 * « en base plutôt qu'en variables d'environnement » est délibéré : deux
 * tenants Microsoft, et un secret qui expire tous les 24 mois doit pouvoir
 * se renouveler ici, sans redéploiement.
 */

export interface ReglagesM365 {
    id: string;
    name: string;
    m365Enabled: boolean;
    m365TenantId: string;
    m365ClientId: string;
    m365SecretConfigured: boolean;
    m365SecretUpdatedAt: string | null;
    m365SecretExpiresAt: string | null;
}

export type ChampM365 = "m365TenantId" | "m365ClientId" | "m365SecretExpiresAt";

interface Verdict {
    ok: boolean;
    reason: string | null;
    accordes?: string[];
    manquants?: string[];
    sonde?: { utilisateurs: string; titre: boolean; photo: string; detail: string | null };
}

const LIBELLE_ROLE: Record<(typeof ROLES_GRAPH_REQUIS)[number], string> = {
    "User.Read.All": "Profils des utilisateurs, titre de poste compris",
    "ProfilePhoto.Read.All": "Photos de profil",
};

export function M365SettingsModal({
    serveur,
    open,
    onOpenChange,
    onChampSauve,
    onInterrupteur,
    onSecretSauve,
}: {
    serveur: ReglagesM365 | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onChampSauve: (champ: ChampM365, valeur: string) => Promise<void>;
    onInterrupteur: (valeur: boolean) => Promise<void>;
    /** Une chaîne vide supprime le secret enregistré. */
    onSecretSauve: (secret: string) => Promise<void>;
}) {
    const [brouillon, setBrouillon] = useState("");
    const [enregistrement, setEnregistrement] = useState(false);
    const [test, setTest] = useState<"encours" | null>(null);
    const [verdict, setVerdict] = useState<Verdict | null>(null);

    if (!serveur) return null;

    const complet = serveur.m365SecretConfigured && !!serveur.m365TenantId && !!serveur.m365ClientId;
    const secret = etatSecret(serveur.m365SecretExpiresAt);

    const tester = async () => {
        setTest("encours");
        setVerdict(null);
        try {
            const res = await fetch("/api/admin/tenants/m365-test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serverId: serveur.id }),
            });
            const data = await res.json();
            setVerdict(res.ok ? data : { ok: false, reason: data.error || "Échec du test" });
        } catch {
            setVerdict({ ok: false, reason: "Le test n'a pas abouti" });
        } finally {
            setTest(null);
        }
    };

    const sauverSecret = async (valeur: string) => {
        setEnregistrement(true);
        try {
            await onSecretSauve(valeur);
            setBrouillon("");
            setVerdict(null);
        } finally {
            setEnregistrement(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Cloud className="h-4 w-4 text-slate-500" />
                        Microsoft 365 — {serveur.name}
                    </DialogTitle>
                    <DialogDescription>
                        Photos et titres de poste des collaborateurs, lus dans l&apos;annuaire Microsoft.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 p-3">
                        <div>
                            <Label htmlFor="m365-maitre" className="text-sm font-medium text-slate-900">
                                Activer l&apos;intégration
                            </Label>
                            <p className="mt-0.5 text-xs text-slate-500">
                                Éteinte, les collaborateurs s&apos;affichent avec leurs initiales — le secret est conservé.
                            </p>
                        </div>
                        <Switch
                            id="m365-maitre"
                            checked={serveur.m365Enabled}
                            onCheckedChange={onInterrupteur}
                            className="mt-1 data-[state=checked]:bg-blue-600"
                        />
                    </div>

                    {serveur.m365Enabled && (
                        <>
                            <div className="space-y-2">
                                <Label htmlFor="m365-tenant" className="text-xs text-slate-600">ID de l&apos;annuaire (locataire)</Label>
                                <Input
                                    id="m365-tenant"
                                    placeholder="00000000-0000-0000-0000-000000000000"
                                    autoComplete="off"
                                    defaultValue={serveur.m365TenantId}
                                    onBlur={(e) => onChampSauve("m365TenantId", e.target.value)}
                                    className="font-mono text-xs"
                                />

                                <Label htmlFor="m365-client" className="text-xs text-slate-600">ID d&apos;application (client)</Label>
                                <Input
                                    id="m365-client"
                                    placeholder="00000000-0000-0000-0000-000000000000"
                                    autoComplete="off"
                                    defaultValue={serveur.m365ClientId}
                                    onBlur={(e) => onChampSauve("m365ClientId", e.target.value)}
                                    className="font-mono text-xs"
                                />

                                <Label htmlFor="m365-secret" className="text-xs text-slate-600">Secret client</Label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        id="m365-secret"
                                        type="password"
                                        autoComplete="off"
                                        placeholder={serveur.m365SecretConfigured ? "•••••••• (remplacer)" : "Coller la colonne « Valeur » du secret"}
                                        value={brouillon}
                                        onChange={(e) => setBrouillon(e.target.value)}
                                        disabled={enregistrement}
                                        className="flex-1 font-mono text-xs"
                                    />
                                    <Button size="sm" onClick={() => sauverSecret(brouillon)} disabled={enregistrement || !brouillon.trim()}>
                                        {enregistrement ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enregistrer"}
                                    </Button>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    {serveur.m365SecretConfigured ? (
                                        <span className="flex items-center gap-1.5 text-xs text-emerald-700">
                                            <ShieldCheck className="h-3.5 w-3.5" />
                                            Secret enregistré{serveur.m365SecretUpdatedAt
                                                ? ` le ${new Date(serveur.m365SecretUpdatedAt).toLocaleDateString("fr-CH")}`
                                                : ""} — chiffré, jamais réaffiché
                                        </span>
                                    ) : (
                                        <span className="text-xs text-amber-700">Aucun secret enregistré : l&apos;intégration reste inactive.</span>
                                    )}
                                    {serveur.m365SecretConfigured && (
                                        <button
                                            type="button"
                                            onClick={() => sauverSecret("")}
                                            disabled={enregistrement}
                                            className="shrink-0 text-xs text-slate-500 underline underline-offset-2 hover:text-red-600"
                                        >
                                            Supprimer
                                        </button>
                                    )}
                                </div>

                                {/* Graph ne laisse pas lire l'expiration d'un secret sans une
                                    permission large sur toutes les inscriptions. On la demande
                                    donc à l'administrateur, pour prévenir un mois avant — le
                                    jour venu, sinon, les photos cessent de se rafraîchir sans
                                    autre symptôme. */}
                                <Label htmlFor="m365-expire" className="text-xs text-slate-600">Expiration du secret (facultatif)</Label>
                                <div className="flex flex-wrap items-center gap-3">
                                    <Input
                                        id="m365-expire"
                                        type="date"
                                        defaultValue={serveur.m365SecretExpiresAt ? serveur.m365SecretExpiresAt.slice(0, 10) : ""}
                                        onBlur={(e) => onChampSauve("m365SecretExpiresAt", e.target.value)}
                                        className="w-44 text-xs"
                                    />
                                    {secret.etat === "valide" && (
                                        <span className="text-xs text-slate-500">Valide encore {secret.joursRestants} jours</span>
                                    )}
                                    {secret.etat === "bientot" && (
                                        <span className="flex items-center gap-1 text-xs font-medium text-amber-700">
                                            <AlertTriangle className="h-3.5 w-3.5" />
                                            Expire dans {secret.joursRestants} jour{secret.joursRestants > 1 ? "s" : ""} — créez un nouveau secret dans Entra
                                        </span>
                                    )}
                                    {secret.etat === "expire" && (
                                        <span className="flex items-center gap-1 text-xs font-medium text-red-700">
                                            <XCircle className="h-3.5 w-3.5" />
                                            Secret expiré : les photos ne se rafraîchissent plus
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Le test se fait avec les identifiants ENREGISTRÉS, et dit lequel
                                des trois étages a cédé : le jeton, les permissions, les lectures. */}
                            <div className="space-y-2 border-t border-slate-200 pt-3">
                                <div className="flex flex-wrap items-center gap-3">
                                    <Button size="sm" variant="outline" onClick={tester} disabled={test === "encours" || !complet}>
                                        {test === "encours"
                                            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Test en cours…</>
                                            : "Tester la connexion"}
                                    </Button>
                                    {verdict && (verdict.ok ? (
                                        <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                                            <CheckCircle2 className="h-4 w-4" />
                                            Connexion établie — utilisateurs, titres et photos lisibles
                                        </span>
                                    ) : (
                                        <span className="text-xs text-red-700">{verdict.reason || "Échec de la connexion"}</span>
                                    ))}
                                </div>

                                {verdict?.accordes !== undefined && (
                                    <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs">
                                        {ROLES_GRAPH_REQUIS.map((role) => {
                                            const accorde = verdict.accordes?.includes(role);
                                            return (
                                                <li key={role} className={cn("flex items-center gap-2", accorde ? "text-emerald-700" : "text-red-700")}>
                                                    {accorde ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                                                    <span className="font-mono">{role}</span>
                                                    <span className="text-slate-500">— {LIBELLE_ROLE[role]}</span>
                                                </li>
                                            );
                                        })}
                                        {verdict.sonde && (
                                            <li className="pt-1 text-slate-600">
                                                Lecture réelle : utilisateurs {verdict.sonde.utilisateurs === "ok" ? "✓" : "✗"}
                                                {" · "}titre de poste {verdict.sonde.titre ? "✓" : "✗"}
                                                {" · "}photo {verdict.sonde.photo === "ok" ? "✓" : verdict.sonde.photo === "aucune" ? "✓ (cet utilisateur n'en a pas)" : "✗"}
                                            </li>
                                        )}
                                    </ul>
                                )}
                            </div>
                        </>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Fermer</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
