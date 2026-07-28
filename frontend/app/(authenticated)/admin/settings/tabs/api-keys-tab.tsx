"use client";

import { toast } from "sonner";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, KeyRound, Copy, Pencil, UserX } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface ApiKeyInfo {
    id: string;
    name: string;
    description: string | null;
    quotaPerMinute: number;
    isActive: boolean;
    createdBy: string | null;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
    revokedBy: string | null;
    keyPrefix: string | null;
}

export function ApiKeysTab() {
    const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [createLoading, setCreateLoading] = useState(false);
    const [createName, setCreateName] = useState("");
    const [createDescription, setCreateDescription] = useState("");
    const [createQuota, setCreateQuota] = useState(100);
    const [newKey, setNewKey] = useState<{ key: string; name: string } | null>(null);
    const [editingKey, setEditingKey] = useState<ApiKeyInfo | null>(null);
    const [editForm, setEditForm] = useState({ name: "", description: "", quotaPerMinute: 100, isActive: true });
    const [editLoading, setEditLoading] = useState(false);
    const [revokingId, setRevokingId] = useState<string | null>(null);
    // Adaptateur : route les appels setMessage(...) existants vers les toasts.
    const setMessage = (m: { type: "success" | "error"; text: string } | null) => {
        if (!m) return;
        if (m.type === "success") toast.success(m.text);
        else toast.error(m.text);
    };

    const loadKeys = () => {
        fetch("/api/admin/api-keys")
            .then((res) => res.json())
            .then((data) => {
                setKeys(data.keys || []);
                setIsLoading(false);
            })
            .catch(() => setIsLoading(false));
    };

    useEffect(() => {
        loadKeys();
    }, []);

    const handleCreate = async () => {
        if (!createName.trim()) return;
        setCreateLoading(true);
        setMessage(null);
        try {
            const res = await fetch("/api/admin/api-keys", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: createName, description: createDescription, quotaPerMinute: createQuota }),
            });
            const data = await res.json();
            if (!res.ok) {
                setMessage({ type: "error", text: data.error || "Erreur lors de la création" });
            } else {
                setNewKey({ key: data.plainKey, name: data.key.name });
                setCreateName("");
                setCreateDescription("");
                setCreateQuota(100);
                setShowCreateDialog(false);
                loadKeys();
            }
        } catch {
            setMessage({ type: "error", text: "Erreur lors de la création" });
        } finally {
            setCreateLoading(false);
        }
    };

    const handleEdit = async () => {
        if (!editingKey) return;
        setEditLoading(true);
        try {
            const res = await fetch("/api/admin/api-keys", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: editingKey.id, ...editForm }),
            });
            const data = await res.json();
            if (!res.ok) {
                setMessage({ type: "error", text: data.error || "Erreur lors de la modification" });
            } else {
                setMessage({ type: "success", text: "Clé modifiée avec succès" });
                setEditingKey(null);
                loadKeys();
            }
        } catch {
            setMessage({ type: "error", text: "Erreur lors de la modification" });
        } finally {
            setEditLoading(false);
        }
    };

    const handleRevoke = async (id: string) => {
        if (!confirm("Révoquer cette clé API ? Elle ne pourra plus être utilisée.")) return;
        setRevokingId(id);
        try {
            const res = await fetch(`/api/admin/api-keys?id=${id}`, { method: "DELETE" });
            const data = await res.json();
            if (!res.ok) {
                setMessage({ type: "error", text: data.error || "Erreur lors de la révocation" });
            } else {
                setMessage({ type: "success", text: "Clé révoquée avec succès" });
                loadKeys();
            }
        } catch {
            setMessage({ type: "error", text: "Erreur lors de la révocation" });
        } finally {
            setRevokingId(null);
        }
    };

    const openEdit = (key: ApiKeyInfo) => {
        setEditingKey(key);
        setEditForm({ name: key.name, description: key.description || "", quotaPerMinute: key.quotaPerMinute, isActive: key.isActive });
    };

    const copyToClipboard = async (text: string) => {
        await navigator.clipboard.writeText(text);
        setMessage({ type: "success", text: "Clé copiée dans le presse-papiers" });
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                <span className="ml-2 text-slate-500">Chargement des clés API...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6">

            {/* New key display */}
            {newKey && (
                <Card className="border-emerald-200 bg-emerald-50/50">
                    <CardContent className="pt-6 space-y-4">
                        <div className="flex items-center gap-3">
                            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                            <div>
                                <h3 className="font-semibold text-emerald-800">Clé API créée avec succès</h3>
                                <p className="text-sm text-emerald-600">Copiez cette clé maintenant. Elle ne sera plus affichée par la suite.</p>
                            </div>
                        </div>
                        <div className="bg-white border border-emerald-200 rounded-lg p-4">
                            <p className="text-xs text-slate-500 mb-1">Clé pour <strong>{newKey.name}</strong></p>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 text-sm font-mono bg-slate-50 px-3 py-2 rounded border text-slate-800 break-all">{newKey.key}</code>
                                <Button size="sm" onClick={() => copyToClipboard(newKey.key)}>
                                    <Copy className="h-4 w-4 mr-1" /> Copier
                                </Button>
                            </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setNewKey(null)}>
                            J'ai copié ma clé
                        </Button>
                    </CardContent>
                </Card>
            )}

            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-slate-900">Clés API</h2>
                    <p className="text-sm text-slate-500">{keys.length} clé(s) générée(s)</p>
                </div>
                <Button onClick={() => setShowCreateDialog(true)}>
                    <KeyRound className="h-4 w-4 mr-2" /> Générer une clé
                </Button>
            </div>

            <Card>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 border-b">
                                <tr>
                                    <th className="text-left py-3 px-4 font-medium text-slate-600">Nom</th>
                                    <th className="text-left py-3 px-4 font-medium text-slate-600">Préfixe</th>
                                    <th className="text-left py-3 px-4 font-medium text-slate-600">Quota/min</th>
                                    <th className="text-left py-3 px-4 font-medium text-slate-600">Statut</th>
                                    <th className="text-left py-3 px-4 font-medium text-slate-600">Dernière utilisation</th>
                                    <th className="text-left py-3 px-4 font-medium text-slate-600">Créée le</th>
                                    <th className="text-right py-3 px-4 font-medium text-slate-600">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {keys.map((key) => (
                                    <tr key={key.id} className={cn("hover:bg-slate-50", !key.isActive && "opacity-60")}>
                                        <td className="py-3 px-4">
                                            <div>
                                                <p className="font-medium">{key.name}</p>
                                                {key.description && <p className="text-xs text-slate-500 truncate max-w-xs">{key.description}</p>}
                                            </div>
                                        </td>
                                        <td className="py-3 px-4">
                                            <code className="text-xs font-mono bg-slate-100 px-2 py-1 rounded">{key.keyPrefix || "—"}</code>
                                        </td>
                                        <td className="py-3 px-4 text-slate-600">{key.quotaPerMinute}</td>
                                        <td className="py-3 px-4">
                                            {key.revokedAt ? (
                                                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">Révoquée</Badge>
                                            ) : key.isActive ? (
                                                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">Active</Badge>
                                            ) : (
                                                <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 text-xs">Inactive</Badge>
                                            )}
                                        </td>
                                        <td className="py-3 px-4 text-slate-500 text-xs">
                                            {key.lastUsedAt ? formatDistanceToNow(new Date(key.lastUsedAt), { addSuffix: true, locale: fr }) : "Jamais"}
                                        </td>
                                        <td className="py-3 px-4 text-slate-500 text-xs">{new Date(key.createdAt).toLocaleDateString("fr-FR")}</td>
                                        <td className="py-3 px-4">
                                            <div className="flex items-center justify-end gap-1">
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(key)}>
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                {key.isActive && (
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleRevoke(key.id)} disabled={revokingId === key.id}>
                                                        {revokingId === key.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX className="h-4 w-4" />}
                                                    </Button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {keys.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="py-8 text-center text-slate-500">
                                            Aucune clé API générée
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Create Dialog */}
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Générer une clé API</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Nom <span className="text-red-500">*</span></Label>
                            <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Ex: Application CRM" />
                        </div>
                        <div className="space-y-2">
                            <Label>Description</Label>
                            <Input value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} placeholder="Usage prévu de cette clé" />
                        </div>
                        <div className="space-y-2">
                            <Label>Quota (requêtes/minute)</Label>
                            <Input type="number" min={1} max={1000} value={createQuota} onChange={(e) => setCreateQuota(Math.max(1, Math.min(1000, parseInt(e.target.value) || 1)))} />
                            <p className="text-xs text-slate-500">Nombre maximum de requêtes autorisées par minute</p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Annuler</Button>
                        <Button onClick={handleCreate} disabled={createLoading || !createName.trim()}>
                            {createLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Création...</> : "Générer"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Edit Dialog */}
            <Dialog open={!!editingKey} onOpenChange={(open) => !open && setEditingKey(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Modifier la clé API</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>Nom</Label>
                            <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Description</Label>
                            <Input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Quota (requêtes/minute)</Label>
                            <Input type="number" min={1} max={1000} value={editForm.quotaPerMinute} onChange={(e) => setEditForm({ ...editForm, quotaPerMinute: Math.max(1, Math.min(1000, parseInt(e.target.value) || 1)) })} />
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="keyActive"
                                checked={editForm.isActive}
                                onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                                className="rounded border-slate-300"
                            />
                            <Label htmlFor="keyActive">Clé active</Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingKey(null)}>Annuler</Button>
                        <Button onClick={handleEdit} disabled={editLoading}>
                            {editLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sauvegarde...</> : "Enregistrer"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
