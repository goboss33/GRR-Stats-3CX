"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Plug, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * RÉGLAGES DE LA SURCOUCHE XAPI.
 *
 * Ils vivaient dépliés dans la fiche du tenant, où trois champs et deux
 * boutons noyaient les réglages qu'on consulte vraiment (fuseau, seuils). Ils
 * passent derrière une roue dentée : la fiche ne montre plus que l'état, on
 * ouvre pour configurer.
 *
 * Deux interrupteurs, et ils ne disent pas la même chose :
 *
 *   - la SURCOUCHE ouvre la liaison au PBX. Éteinte, tout vient des appels.
 *   - l'ANNUAIRE décide seulement d'où viennent les NOMS et DÉPARTEMENTS.
 *
 * Le second est subordonné au premier, jamais l'inverse.
 */

export interface ReglagesXapi {
    id: string;
    name: string;
    xapiEnabled: boolean;
    xapiDirectoryEnabled: boolean;
    xapiBaseUrl: string;
    xapiClientId: string;
    xapiKeyConfigured: boolean;
    xapiKeyUpdatedAt: string | null;
}

export function XapiSettingsModal({
    serveur,
    open,
    onOpenChange,
    onChampSauve,
    onInterrupteur,
    onCleSauvee,
}: {
    serveur: ReglagesXapi | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Enregistre l'adresse ou l'ID client (à la sortie du champ). */
    onChampSauve: (champ: "xapiBaseUrl" | "xapiClientId", valeur: string) => Promise<void>;
    onInterrupteur: (champ: "xapiEnabled" | "xapiDirectoryEnabled", valeur: boolean) => Promise<void>;
    /** Une chaîne vide supprime la clé enregistrée. */
    onCleSauvee: (cle: string) => Promise<void>;
}) {
    const [brouillonCle, setBrouillonCle] = useState("");
    const [enregistrement, setEnregistrement] = useState(false);
    const [test, setTest] = useState<"encours" | null>(null);
    const [verdict, setVerdict] = useState<{ ok: boolean; reason?: string; role?: string | null } | null>(null);

    if (!serveur) return null;

    const testerLaConnexion = async () => {
        setTest("encours");
        setVerdict(null);
        try {
            const res = await fetch("/api/admin/tenants/xapi-test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serverId: serveur.id }),
            });
            const data = await res.json();
            setVerdict(res.ok ? { ok: data.ok, reason: data.reason, role: data.role } : { ok: false, reason: data.error || "Échec du test" });
        } catch {
            setVerdict({ ok: false, reason: "Le test n'a pas abouti" });
        } finally {
            setTest(null);
        }
    };

    const sauverLaCle = async (cle: string) => {
        setEnregistrement(true);
        try {
            await onCleSauvee(cle);
            setBrouillonCle("");
        } finally {
            setEnregistrement(false);
        }
    };

    const configurationComplete = serveur.xapiKeyConfigured && !!serveur.xapiBaseUrl && !!serveur.xapiClientId;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Plug className="h-4 w-4 text-slate-500" />
                        Surcouche XAPI — {serveur.name}
                    </DialogTitle>
                    <DialogDescription>
                        Interrogation directe du 3CX, en plus de l&apos;historique des appels.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* L'interrupteur maître, en tête : tout le reste en dépend. */}
                    <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 p-3">
                        <div>
                            <Label htmlFor="xapi-maitre" className="text-sm font-medium text-slate-900">
                                Activer la surcouche
                            </Label>
                            <p className="mt-0.5 text-xs text-slate-500">
                                Éteinte, tout vient de l&apos;historique des appels — la clé est conservée.
                            </p>
                        </div>
                        <Switch
                            id="xapi-maitre"
                            checked={serveur.xapiEnabled}
                            onCheckedChange={(v) => onInterrupteur("xapiEnabled", v)}
                            className="mt-1 data-[state=checked]:bg-blue-600"
                        />
                    </div>

                    {serveur.xapiEnabled && (
                        <>
                            <div className="space-y-2">
                                <Label htmlFor="xapi-url" className="text-xs text-slate-600">Adresse du PBX</Label>
                                <Input
                                    id="xapi-url"
                                    type="url"
                                    inputMode="url"
                                    placeholder="https://exemple.3cx.ch:5001"
                                    defaultValue={serveur.xapiBaseUrl}
                                    onBlur={(e) => onChampSauve("xapiBaseUrl", e.target.value)}
                                    className="font-mono text-xs"
                                />

                                <Label htmlFor="xapi-client" className="text-xs text-slate-600">ID client</Label>
                                <Input
                                    id="xapi-client"
                                    placeholder="stats"
                                    autoComplete="off"
                                    defaultValue={serveur.xapiClientId}
                                    onBlur={(e) => onChampSauve("xapiClientId", e.target.value)}
                                    className="font-mono text-xs"
                                />

                                <Label htmlFor="xapi-cle" className="text-xs text-slate-600">Clé API</Label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        id="xapi-cle"
                                        type="password"
                                        autoComplete="off"
                                        placeholder={serveur.xapiKeyConfigured ? "•••••••• (remplacer)" : "Coller la clé XAPI"}
                                        value={brouillonCle}
                                        onChange={(e) => setBrouillonCle(e.target.value)}
                                        disabled={enregistrement}
                                        className="flex-1 font-mono text-xs"
                                    />
                                    <Button
                                        size="sm"
                                        onClick={() => sauverLaCle(brouillonCle)}
                                        disabled={enregistrement || !brouillonCle.trim()}
                                    >
                                        {enregistrement ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enregistrer"}
                                    </Button>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    {serveur.xapiKeyConfigured ? (
                                        <span className="flex items-center gap-1.5 text-xs text-emerald-700">
                                            <ShieldCheck className="h-3.5 w-3.5" />
                                            Clé enregistrée{serveur.xapiKeyUpdatedAt
                                                ? ` le ${new Date(serveur.xapiKeyUpdatedAt).toLocaleDateString("fr-CH")}`
                                                : ""} — chiffrée, jamais réaffichée
                                        </span>
                                    ) : (
                                        <span className="text-xs text-amber-700">
                                            Aucune clé enregistrée : la surcouche reste inactive.
                                        </span>
                                    )}
                                    {serveur.xapiKeyConfigured && (
                                        <button
                                            type="button"
                                            onClick={() => sauverLaCle("")}
                                            disabled={enregistrement}
                                            className="shrink-0 text-xs text-slate-500 underline underline-offset-2 hover:text-red-600"
                                        >
                                            Supprimer
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Le test se fait avec les identifiants ENREGISTRÉS : il valide
                                la configuration réelle, pas ce qui est à l'écran. */}
                            <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={testerLaConnexion}
                                    disabled={test === "encours" || !configurationComplete}
                                >
                                    {test === "encours"
                                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Test en cours…</>
                                        : "Tester la connexion"}
                                </Button>
                                {verdict && (verdict.ok ? (
                                    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                                        <CheckCircle2 className="h-4 w-4" />
                                        Connexion établie{verdict.role ? ` (rôle : ${verdict.role})` : ""}
                                    </span>
                                ) : (
                                    <span className="text-xs text-red-700">{verdict.reason || "Échec de la connexion"}</span>
                                ))}
                            </div>

                            {/* Le second interrupteur, à part et après le test : il ne
                                sert à rien tant que la liaison n'est pas établie. */}
                            <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                                <div>
                                    <Label htmlFor="xapi-annuaire" className="text-sm font-medium text-slate-900">
                                        Noms et départements depuis le 3CX
                                    </Label>
                                    <p className="mt-0.5 text-xs text-slate-500">
                                        Toute l&apos;application affiche alors les libellés déclarés par le PBX,
                                        et retombe sur ceux des appels pour les files qu&apos;il ne connaît plus.
                                        L&apos;écran « Registre (CDR) » garde ceux des appels : c&apos;est là qu&apos;on lit l&apos;écart.
                                    </p>
                                </div>
                                <Switch
                                    id="xapi-annuaire"
                                    checked={serveur.xapiDirectoryEnabled}
                                    onCheckedChange={(v) => onInterrupteur("xapiDirectoryEnabled", v)}
                                    disabled={!configurationComplete}
                                    className="mt-1 data-[state=checked]:bg-blue-600"
                                />
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
