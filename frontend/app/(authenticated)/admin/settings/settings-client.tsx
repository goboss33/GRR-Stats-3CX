"use client";

import { useState, useEffect } from "react";
import { Users, Phone, AlertCircle, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronRight, UserX, Save, KeyRound, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { QueueInfo } from "@/types/queues.types";
import { getQueueMembers } from "@/services/queues.service";
import { QueueSearchCombobox } from "@/components/queue-search-combobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type TabId = "personal" | "users" | "queues" | "diagnostic";

const tabs: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "personal", label: "Informations personnelles", icon: Users },
    { id: "users", label: "Utilisateurs", icon: Users },
    { id: "queues", label: "Files d'attente", icon: Phone },
    { id: "diagnostic", label: "Diagnostic", icon: AlertCircle },
];

// --- Diagnostic types ---
interface SegmentSummary {
    cdrId: string;
    destType: string | null;
    destEntityType: string | null;
    startedAt: string;
    endedAt: string | null;
    answeredAt: string | null;
    durationSeconds: number;
    terminationReasonDetails: string | null;
}

interface DivergenceDetail {
    callHistoryId: string;
    callHistoryIdShort: string;
    startedAt: string;
    segmentCount: number;
    dashboardStatus: string;
    logsStatus: string;
    lastDestType: string | null;
    lastDestEntityType: string | null;
    lastAnsweredAt: string | null;
    lastStartedAt: string | null;
    lastEndedAt: string | null;
    lastDurationSeconds: number;
    humanAnsweredAt: string | null;
    terminationReasonDetails: string | null;
    allSegments: SegmentSummary[];
}

interface DiagnosticData {
    period: { start: string; end: string };
    summary: {
        totalCalls: number;
        dashboardAnswered: number;
        logsAnswered: number;
        dashboardMissed: number;
        logsMissed: number;
        dashboardVoicemail: number;
        logsVoicemail: number;
        dashboardBusy: number;
        logsBusy: number;
        divergences: number;
        matchRate: string;
    };
    divergences: DivergenceDetail[];
}

type PeriodPreset = "today" | "yesterday" | "last7days" | "last30days" | "custom";

interface UserProfile {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    role: string;
    createdAt: string;
}

interface AppUser {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    createdAt: string;
}

// --- Tab Components ---

function PersonalInfoTab() {
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

    return (
        <div className="space-y-6 max-w-2xl">
            {message && (
                <div className={cn(
                    "p-4 rounded-lg border flex items-center gap-3",
                    message.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"
                )}>
                    {message.type === "success" ? <CheckCircle2 className="h-5 w-5 flex-shrink-0" /> : <XCircle className="h-5 w-5 flex-shrink-0" />}
                    <span className="text-sm font-medium">{message.text}</span>
                </div>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Profil</CardTitle>
                    <CardDescription>Vos informations personnelles</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="firstName">Prénom</Label>
                            <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Votre prénom" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="lastName">Nom</Label>
                            <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Votre nom" />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="votre@email.com" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="role">Rôle</Label>
                        <Input id="role" value={profile?.role === "ADMIN" ? "Administrateur" : profile?.role === "SUPERUSER" ? "Manager" : "Utilisateur"} disabled className="bg-slate-100" />
                    </div>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sauvegarde...</> : <><Save className="mr-2 h-4 w-4" /> Enregistrer</>}
                    </Button>
                </CardContent>
            </Card>

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
                        <Input id="new-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 4 caractères" />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function UsersTab() {
    const [users, setUsers] = useState<AppUser[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [editUser, setEditUser] = useState<AppUser | null>(null);
    const [editForm, setEditForm] = useState({ firstName: "", lastName: "", email: "", role: "" });
    const [editLoading, setEditLoading] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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
                if (data.user) setCurrentUserId(data.user.id);
            });
    }, []);

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
            {message && (
                <div className={cn(
                    "p-4 rounded-lg border flex items-center gap-3",
                    message.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"
                )}>
                    {message.type === "success" ? <CheckCircle2 className="h-5 w-5 flex-shrink-0" /> : <XCircle className="h-5 w-5 flex-shrink-0" />}
                    <span className="text-sm font-medium">{message.text}</span>
                    <button onClick={() => setMessage(null)} className="ml-auto text-sm underline">Fermer</button>
                </div>
            )}

            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-slate-900">Gestion des utilisateurs</h2>
                    <p className="text-sm text-slate-500">{users.length} utilisateur(s) enregistré(s)</p>
                </div>
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
                                    <th className="text-left py-3 px-4 font-medium text-slate-600">Créé le</th>
                                    <th className="text-right py-3 px-4 font-medium text-slate-600">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {users.map((user) => {
                                    const isSelf = user.id === currentUserId;
                                    return (
                                        <tr key={user.id} className="hover:bg-slate-50">
                                            <td className="py-3 px-4 font-medium">{getDisplayName(user)}</td>
                                            <td className="py-3 px-4 text-slate-500">{user.email}</td>
                                            <td className="py-3 px-4">
                                                <Badge
                                                    variant="outline"
                                                    className={cn(
                                                        user.role === "ADMIN" && "bg-red-50 text-red-700 border-red-200",
                                                        user.role === "SUPERUSER" && "bg-amber-50 text-amber-700 border-amber-200",
                                                        user.role === "USER" && "bg-green-50 text-green-700 border-green-200"
                                                    )}
                                                >
                                                    {user.role === "ADMIN" ? "Administrateur" : user.role === "SUPERUSER" ? "Manager" : "Utilisateur"}
                                                </Badge>
                                            </td>
                                            <td className="py-3 px-4 text-slate-500">{new Date(user.createdAt).toLocaleDateString("fr-FR")}</td>
                                            <td className="py-3 px-4">
                                                <div className="flex items-center justify-end gap-2">
                                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(user)}>
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    {!isSelf && (
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(user.id)} disabled={deleteLoading === user.id}>
                                                            {deleteLoading === user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                                        </Button>
                                                    )}
                                                    {isSelf && (
                                                        <span className="text-xs text-slate-400 italic">Vous</span>
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
                                    <SelectItem value="USER">Utilisateur</SelectItem>
                                    <SelectItem value="SUPERUSER">Manager</SelectItem>
                                    <SelectItem value="ADMIN">Administrateur</SelectItem>
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
        </div>
    );
}

function QueuesTab() {
    const [queues, setQueues] = useState<QueueInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");

    useEffect(() => {
        getQueueMembers()
            .then(setQueues)
            .finally(() => setIsLoading(false));
    }, []);

    const getAgentStatus = (lastSeenIso: string) => {
        const lastSeen = new Date(lastSeenIso);
        const daysSince = (new Date().getTime() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince < 7) return { color: "bg-emerald-500", label: "Actif", class: "text-emerald-700 bg-emerald-50 border-emerald-200" };
        if (daysSince < 30) return { color: "bg-amber-500", label: "Inactif < 30j", class: "text-amber-700 bg-amber-50 border-amber-200" };
        return { color: "bg-slate-400", label: "Inactif > 30j", class: "text-slate-500 bg-slate-50 border-slate-200" };
    };

    const filteredQueues = queues.filter(q =>
        q.queueName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        q.queueNumber.includes(searchTerm) ||
        q.members.some(m => m.agentName.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                <span className="ml-2 text-slate-500">Chargement des files d'attente...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-slate-900">Files d'attente</h2>
                    <p className="text-sm text-slate-500">{queues.length} file(s) détectée(s)</p>
                </div>
                <QueueSearchCombobox
                    queues={queues}
                    value={searchTerm}
                    onChange={setSearchTerm}
                    className="w-full md:w-96"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {filteredQueues.map((queue) => (
                    <Card key={queue.queueNumber} className="flex flex-col h-full border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                        <CardHeader className="pb-3 border-b bg-slate-50/50">
                            <div className="flex justify-between items-start gap-4">
                                <div className="space-y-1">
                                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                                        <span className="font-mono bg-white border px-1.5 py-0.5 rounded text-sm text-slate-600">
                                            {queue.queueNumber}
                                        </span>
                                        <span className="truncate" title={queue.queueName}>{queue.queueName}</span>
                                    </CardTitle>
                                    <Badge variant="secondary" className="bg-white border">
                                        {queue.memberCount} agent{queue.memberCount > 1 ? 's' : ''}
                                    </Badge>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="flex-1 p-0">
                            <div className="divide-y divide-slate-100">
                                {queue.members
                                    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
                                    .map((member) => {
                                        const status = getAgentStatus(member.lastSeenAt);
                                        return (
                                            <div key={member.agentExtension} className="p-3 hover:bg-slate-50 transition-colors flex items-center justify-between group">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-2 h-2 rounded-full ${status.color} flex-shrink-0`} title={status.label} />
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-slate-900 group-hover:text-blue-700 transition-colors truncate">
                                                            {member.agentName}
                                                        </p>
                                                        <p className="text-xs text-slate-500 font-mono">
                                                            Ext. {member.agentExtension} • Vu {formatDistanceToNow(new Date(member.lastSeenAt), { addSuffix: true, locale: fr })}
                                                        </p>
                                                    </div>
                                                </div>
                                                <Badge variant="outline" className={`ml-2 text-[10px] font-normal px-1.5 py-0 ${status.class}`}>
                                                    {member.attemptsCount} appels
                                                </Badge>
                                            </div>
                                        );
                                    })}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {filteredQueues.length === 0 && (
                <div className="text-center py-20 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                    <UserX className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-900">Aucune file trouvée</h3>
                    <p className="text-slate-500 mt-1">Essayez de modifier votre recherche</p>
                </div>
            )}
        </div>
    );
}

function DiagnosticTab() {
    const [period, setPeriod] = useState<PeriodPreset>("today");
    const [customStart, setCustomStart] = useState("");
    const [customEnd, setCustomEnd] = useState("");
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<DiagnosticData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [expandedCall, setExpandedCall] = useState<string | null>(null);

    const getDateRange = () => {
        const now = new Date();
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        let start: Date;
        switch (period) {
            case "today":
                start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
                break;
            case "yesterday":
                start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
                end.setTime(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59).getTime());
                break;
            case "last7days":
                start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0);
                break;
            case "last30days":
                start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0);
                break;
            case "custom":
                start = customStart ? new Date(customStart) : new Date(now.getFullYear(), now.getMonth(), 1);
                end.setTime(customEnd ? new Date(customEnd + "T23:59:59").getTime() : now.getTime());
                break;
        }
        return { start, end };
    };

    const runDiagnostic = async () => {
        setLoading(true);
        setData(null);
        setError(null);
        setExpandedCall(null);
        const { start, end } = getDateRange();
        try {
            const response = await fetch("/api/diagnostic", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ startDate: start.toISOString(), endDate: end.toISOString() }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API error ${response.status}: ${errorText}`);
            }
            const result = await response.json();
            if (result.error) throw new Error(result.error);
            setData(result);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Erreur inconnue";
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    const statusColor = (status: string) => {
        switch (status) {
            case "answered": return "bg-emerald-100 text-emerald-800 border-emerald-200";
            case "abandoned": return "bg-red-100 text-red-800 border-red-200";
            case "busy": return "bg-amber-100 text-amber-800 border-amber-200";
            case "voicemail": return "bg-purple-100 text-purple-800 border-purple-200";
            default: return "bg-gray-100 text-gray-800 border-gray-200";
        }
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Période d'analyse</CardTitle>
                    <CardDescription>Sélectionnez la plage de dates à analyser</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex gap-2 flex-wrap">
                        {([
                            { value: "today", label: "Aujourd'hui" },
                            { value: "yesterday", label: "Hier" },
                            { value: "last7days", label: "7 derniers jours" },
                            { value: "last30days", label: "30 derniers jours" },
                            { value: "custom", label: "Personnalisé" },
                        ] as const).map(p => (
                            <Button key={p.value} variant={period === p.value ? "default" : "outline"} onClick={() => setPeriod(p.value)}>
                                {p.label}
                            </Button>
                        ))}
                    </div>
                    {period === "custom" && (
                        <div className="flex gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Début</label>
                                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="border rounded px-3 py-2" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Fin</label>
                                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="border rounded px-3 py-2" />
                            </div>
                        </div>
                    )}
                    <Button onClick={runDiagnostic} disabled={loading} size="lg">
                        {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyse en cours...</> : "Lancer le diagnostic"}
                    </Button>
                </CardContent>
            </Card>

            {error && (
                <Card className="border-red-200 bg-red-50/50">
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-3">
                            <AlertCircle className="h-6 w-6 text-red-600 flex-shrink-0" />
                            <div>
                                <p className="font-medium text-red-800">Erreur lors du diagnostic</p>
                                <p className="text-sm text-red-600 mt-1 font-mono">{error}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {data && (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card className={data.summary.divergences === 0 ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"}>
                            <CardContent className="pt-6">
                                <div className="flex items-center gap-3">
                                    {data.summary.divergences === 0 ? <CheckCircle2 className="h-8 w-8 text-emerald-600" /> : <AlertCircle className="h-8 w-8 text-amber-600" />}
                                    <div>
                                        <p className="text-sm text-slate-500">Taux de correspondance</p>
                                        <p className="text-2xl font-bold">{data.summary.matchRate}</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-6">
                                <p className="text-sm text-slate-500">Total appels</p>
                                <p className="text-2xl font-bold">{data.summary.totalCalls.toLocaleString()}</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-6">
                                <p className="text-sm text-slate-500">Divergences</p>
                                <p className="text-2xl font-bold text-amber-600">{data.summary.divergences}</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="pt-6">
                                <p className="text-sm text-slate-500">Période</p>
                                <p className="text-sm font-mono">
                                    {new Date(data.period.start).toLocaleDateString('fr-FR')} → {new Date(data.period.end).toLocaleDateString('fr-FR')}
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <Card>
                            <CardHeader><CardTitle className="text-lg">Dashboard (SQL)</CardTitle></CardHeader>
                            <CardContent className="space-y-2">
                                <div className="flex justify-between"><span className="text-slate-500">Répondus</span><Badge variant="outline" className="bg-emerald-50 text-emerald-700">{data.summary.dashboardAnswered}</Badge></div>
                                <div className="flex justify-between"><span className="text-slate-500">Manqués</span><Badge variant="outline" className="bg-red-50 text-red-700">{data.summary.dashboardMissed}</Badge></div>
                                <div className="flex justify-between"><span className="text-slate-500">Messagerie</span><Badge variant="outline" className="bg-purple-50 text-purple-700">{data.summary.dashboardVoicemail}</Badge></div>
                                <div className="flex justify-between"><span className="text-slate-500">Occupé</span><Badge variant="outline" className="bg-amber-50 text-amber-700">{data.summary.dashboardBusy}</Badge></div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader><CardTitle className="text-lg">Logs (TypeScript)</CardTitle></CardHeader>
                            <CardContent className="space-y-2">
                                <div className="flex justify-between"><span className="text-slate-500">Répondus</span><Badge variant="outline" className="bg-emerald-50 text-emerald-700">{data.summary.logsAnswered}</Badge></div>
                                <div className="flex justify-between"><span className="text-slate-500">Manqués</span><Badge variant="outline" className="bg-red-50 text-red-700">{data.summary.logsMissed}</Badge></div>
                                <div className="flex justify-between"><span className="text-slate-500">Messagerie</span><Badge variant="outline" className="bg-purple-50 text-purple-700">{data.summary.logsVoicemail}</Badge></div>
                                <div className="flex justify-between"><span className="text-slate-500">Occupé</span><Badge variant="outline" className="bg-amber-50 text-amber-700">{data.summary.logsBusy}</Badge></div>
                            </CardContent>
                        </Card>
                    </div>

                    {data.divergences.length > 0 && (
                        <Card className="border-amber-200">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <XCircle className="h-5 w-5 text-amber-600" />
                                    Appels divergents ({data.divergences.length})
                                </CardTitle>
                                <CardDescription>Ces appels ont un statut différent entre le Dashboard et les Logs</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {data.divergences.map(div => (
                                    <div key={div.callHistoryId} className="border rounded-lg overflow-hidden">
                                        <button
                                            onClick={() => setExpandedCall(expandedCall === div.callHistoryId ? null : div.callHistoryId)}
                                            className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
                                        >
                                            <div className="flex items-center gap-4">
                                                <Badge variant="outline" className="font-mono">{div.callHistoryIdShort}</Badge>
                                                <span className="text-sm text-slate-500">{new Date(div.startedAt).toLocaleString('fr-FR')}</span>
                                                <span className="text-sm text-slate-400">{div.segmentCount} segment{div.segmentCount > 1 ? 's' : ''}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <Badge className={statusColor(div.dashboardStatus)}>Dashboard: {div.dashboardStatus}</Badge>
                                                <span className="text-slate-400">→</span>
                                                <Badge className={statusColor(div.logsStatus)}>Logs: {div.logsStatus}</Badge>
                                                {expandedCall === div.callHistoryId ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                                            </div>
                                        </button>
                                        {expandedCall === div.callHistoryId && (
                                            <div className="border-t p-4 space-y-4 bg-slate-50/50">
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                                                    <div><span className="text-slate-500">Dernier type:</span><p className="font-mono">{div.lastDestType}</p></div>
                                                    <div><span className="text-slate-500">Entity type:</span><p className="font-mono">{div.lastDestEntityType}</p></div>
                                                    <div><span className="text-slate-500">Durée dernier segment:</span><p className="font-mono">{div.lastDurationSeconds}s</p></div>
                                                    <div><span className="text-slate-500">Répondu par humain:</span><p className="font-mono">{div.humanAnsweredAt ? 'Oui' : 'Non'}</p></div>
                                                </div>
                                                <div>
                                                    <h4 className="font-medium text-sm text-slate-700 mb-2">Tous les segments ({div.allSegments.length})</h4>
                                                    <div className="overflow-x-auto">
                                                        <table className="w-full text-xs">
                                                            <thead>
                                                                <tr className="border-b">
                                                                    <th className="text-left py-1 px-2">#</th>
                                                                    <th className="text-left py-1 px-2">Type</th>
                                                                    <th className="text-left py-1 px-2">Début</th>
                                                                    <th className="text-left py-1 px-2">Fin</th>
                                                                    <th className="text-left py-1 px-2">Répondu</th>
                                                                    <th className="text-left py-1 px-2">Durée</th>
                                                                    <th className="text-left py-1 px-2">Termination</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {div.allSegments.map((seg, i) => (
                                                                    <tr key={seg.cdrId} className={`border-b ${i === div.allSegments.length - 1 ? 'bg-amber-50 font-medium' : ''}`}>
                                                                        <td className="py-1 px-2">{i + 1}</td>
                                                                        <td className="py-1 px-2 font-mono">{seg.destType}/{seg.destEntityType}</td>
                                                                        <td className="py-1 px-2 font-mono">{new Date(seg.startedAt).toLocaleTimeString('fr-FR')}</td>
                                                                        <td className="py-1 px-2 font-mono">{seg.endedAt ? new Date(seg.endedAt).toLocaleTimeString('fr-FR') : '—'}</td>
                                                                        <td className="py-1 px-2 font-mono">{seg.answeredAt ? new Date(seg.answeredAt).toLocaleTimeString('fr-FR') : '—'}</td>
                                                                        <td className="py-1 px-2 font-mono">{seg.durationSeconds}s</td>
                                                                        <td className="py-1 px-2 font-mono">{seg.terminationReasonDetails || '—'}</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    )}

                    {data.divergences.length === 0 && (
                        <Card className="border-emerald-200 bg-emerald-50/30">
                            <CardContent className="pt-6 text-center">
                                <CheckCircle2 className="h-12 w-12 text-emerald-600 mx-auto mb-3" />
                                <h3 className="text-lg font-medium text-emerald-800">Parfaite correspondance !</h3>
                                <p className="text-emerald-600 mt-1">Tous les {data.summary.totalCalls} appels ont le même statut entre le Dashboard et les Logs.</p>
                            </CardContent>
                        </Card>
                    )}
                </>
            )}
        </div>
    );
}

// --- Main Settings Page ---

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState<TabId>("personal");

    const renderTabContent = () => {
        switch (activeTab) {
            case "personal": return <PersonalInfoTab />;
            case "users": return <UsersTab />;
            case "queues": return <QueuesTab />;
            case "diagnostic": return <DiagnosticTab />;
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-slate-900">Paramètres</h1>
                <p className="text-slate-500">Configuration du système et gestion de votre compte</p>
            </div>

            {/* Tabs */}
            <div className="border-b border-slate-200">
                <nav className="flex gap-1 -mb-px overflow-x-auto">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors",
                                    activeTab === tab.id
                                        ? "border-blue-600 text-blue-600"
                                        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                                )}
                            >
                                <Icon className="h-4 w-4" />
                                {tab.label}
                            </button>
                        );
                    })}
                </nav>
            </div>

            {/* Tab Content */}
            {renderTabContent()}
        </div>
    );
}
