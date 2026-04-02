"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight } from "lucide-react";

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

export default function DiagnosticPage() {
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

            if (result.error) {
                throw new Error(result.error);
            }

            setData(result);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Erreur inconnue";
            setError(message);
            console.error("Diagnostic error:", err);
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
        <div className="p-8 max-w-[1400px] mx-auto space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">Diagnostic de Cohérence des Données</h1>
                <p className="text-slate-500 mt-2 text-lg">Compare call par call la logique Dashboard (SQL) vs Logs (TypeScript)</p>
            </div>

            {/* Controls */}
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
                            <Button
                                key={p.value}
                                variant={period === p.value ? "default" : "outline"}
                                onClick={() => setPeriod(p.value)}
                            >
                                {p.label}
                            </Button>
                        ))}
                    </div>

                    {period === "custom" && (
                        <div className="flex gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Début</label>
                                <input
                                    type="date"
                                    value={customStart}
                                    onChange={e => setCustomStart(e.target.value)}
                                    className="border rounded px-3 py-2"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Fin</label>
                                <input
                                    type="date"
                                    value={customEnd}
                                    onChange={e => setCustomEnd(e.target.value)}
                                    className="border rounded px-3 py-2"
                                />
                            </div>
                        </div>
                    )}

                    <Button onClick={runDiagnostic} disabled={loading} size="lg">
                        {loading ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyse en cours...</>
                        ) : (
                            "Lancer le diagnostic"
                        )}
                    </Button>
                </CardContent>
            </Card>

            {/* Error */}
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

            {/* Results */}
            {data && (
                <>
                    {/* Summary */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card className={data.summary.divergences === 0 ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"}>
                            <CardContent className="pt-6">
                                <div className="flex items-center gap-3">
                                    {data.summary.divergences === 0 ? (
                                        <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                                    ) : (
                                        <AlertCircle className="h-8 w-8 text-amber-600" />
                                    )}
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

                    {/* Comparison table */}
                    <div className="grid grid-cols-2 gap-4">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Dashboard (SQL)</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Répondus</span>
                                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700">{data.summary.dashboardAnswered}</Badge>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Manqués</span>
                                    <Badge variant="outline" className="bg-red-50 text-red-700">{data.summary.dashboardMissed}</Badge>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Messagerie</span>
                                    <Badge variant="outline" className="bg-purple-50 text-purple-700">{data.summary.dashboardVoicemail}</Badge>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Occupé</span>
                                    <Badge variant="outline" className="bg-amber-50 text-amber-700">{data.summary.dashboardBusy}</Badge>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Logs (TypeScript)</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Répondus</span>
                                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700">{data.summary.logsAnswered}</Badge>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Manqués</span>
                                    <Badge variant="outline" className="bg-red-50 text-red-700">{data.summary.logsMissed}</Badge>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Messagerie</span>
                                    <Badge variant="outline" className="bg-purple-50 text-purple-700">{data.summary.logsVoicemail}</Badge>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Occupé</span>
                                    <Badge variant="outline" className="bg-amber-50 text-amber-700">{data.summary.logsBusy}</Badge>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Divergences */}
                    {data.divergences.length > 0 && (
                        <Card className="border-amber-200">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <XCircle className="h-5 w-5 text-amber-600" />
                                    Appels divergents ({data.divergences.length})
                                </CardTitle>
                                <CardDescription>
                                    Ces appels ont un statut différent entre le Dashboard et les Logs
                                </CardDescription>
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
                                                <span className="text-sm text-slate-500">
                                                    {new Date(div.startedAt).toLocaleString('fr-FR')}
                                                </span>
                                                <span className="text-sm text-slate-400">{div.segmentCount} segment{div.segmentCount > 1 ? 's' : ''}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <Badge className={statusColor(div.dashboardStatus)}>
                                                    Dashboard: {div.dashboardStatus}
                                                </Badge>
                                                <span className="text-slate-400">→</span>
                                                <Badge className={statusColor(div.logsStatus)}>
                                                    Logs: {div.logsStatus}
                                                </Badge>
                                                {expandedCall === div.callHistoryId ? (
                                                    <ChevronDown className="h-4 w-4 text-slate-400" />
                                                ) : (
                                                    <ChevronRight className="h-4 w-4 text-slate-400" />
                                                )}
                                            </div>
                                        </button>

                                        {expandedCall === div.callHistoryId && (
                                            <div className="border-t p-4 space-y-4 bg-slate-50/50">
                                                {/* Key data */}
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                                                    <div>
                                                        <span className="text-slate-500">Dernier type:</span>
                                                        <p className="font-mono">{div.lastDestType}</p>
                                                    </div>
                                                    <div>
                                                        <span className="text-slate-500">Entity type:</span>
                                                        <p className="font-mono">{div.lastDestEntityType}</p>
                                                    </div>
                                                    <div>
                                                        <span className="text-slate-500">Durée dernier segment:</span>
                                                        <p className="font-mono">{div.lastDurationSeconds}s</p>
                                                    </div>
                                                    <div>
                                                        <span className="text-slate-500">Répondu par humain:</span>
                                                        <p className="font-mono">{div.humanAnsweredAt ? 'Oui' : 'Non'}</p>
                                                    </div>
                                                    <div>
                                                        <span className="text-slate-500">Last answered at:</span>
                                                        <p className="font-mono">{div.lastAnsweredAt ? new Date(div.lastAnsweredAt).toLocaleTimeString('fr-FR') : '—'}</p>
                                                    </div>
                                                    <div>
                                                        <span className="text-slate-500">Termination:</span>
                                                        <p className="font-mono">{div.terminationReasonDetails || '—'}</p>
                                                    </div>
                                                </div>

                                                {/* All segments */}
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
                                                    {div.allSegments.length > 1 && (
                                                        <p className="text-xs text-amber-600 mt-1">← Dernier segment (déterminant pour le statut)</p>
                                                    )}
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
