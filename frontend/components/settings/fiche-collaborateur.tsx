"use client";

import { useEffect, useState } from "react";
import { Attente } from "@/components/ui/etat-chargement";
import { cn } from "@/lib/utils";

/**
 * LA FICHE 3CX D'UN POSTE — ce que le journal des relevés sait de lui, daté :
 * ses noms et titres successifs, ses équipes. Contenu seul : il vit dans
 * l'onglet « Fiche 3CX » du dialogue d'accès d'un utilisateur.
 */

interface Fiche {
    postes: { displayName: string; email: string | null; jobTitle: string | null; matchState: string; firstSeenAt: string; lastSeenAt: string; closedAt: string | null }[];
    equipes: { queueNumber: string; queueName: string; firstSeenAt: string; lastSeenAt: string; closedAt: string | null }[];
}

const dateCourte = (iso: string) => new Date(iso).toLocaleDateString("fr-CH");

export function ContenuFiche({ serverId, extension }: { serverId: string; extension: string }) {
    const [fiche, setFiche] = useState<Fiche | "chargement" | "échec">("chargement");

    useEffect(() => {
        let annule = false;
        setFiche("chargement");
        fetch(`/api/admin/xapi-journal?server=${encodeURIComponent(serverId)}&collab=${encodeURIComponent(extension)}`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((d) => { if (!annule) setFiche(d.fiche as Fiche); })
            .catch(() => { if (!annule) setFiche("échec"); });
        return () => { annule = true; };
    }, [serverId, extension]);

    if (fiche === "chargement") return <div className="py-8"><Attente libelle="Lecture du journal…" /></div>;
    if (fiche === "échec") return <p className="py-4 text-sm text-red-700">La fiche n&apos;a pas pu être lue.</p>;

    const Aujourdhui = () => <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">aujourd&apos;hui</span>;
    return (
        <div className="space-y-5 py-2 text-sm">
            <section>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Ce poste, au fil des relevés</p>
                <table className="w-full text-xs">
                    <thead><tr className="text-left text-slate-500"><th className="py-1">Nom</th><th className="py-1">Titre</th><th className="py-1">E-mail</th><th className="py-1">Du</th><th className="py-1">Au</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                        {fiche.postes.map((p, i) => (
                            <tr key={i} className={cn(p.closedAt && "text-slate-500")}>
                                <td className="py-1.5">{p.displayName}</td>
                                <td className="py-1.5">{p.jobTitle ?? "—"}</td>
                                <td className="py-1.5">{p.email ?? "—"}</td>
                                <td className="py-1.5 tabular-nums">{dateCourte(p.firstSeenAt)}</td>
                                <td className="py-1.5 tabular-nums">{p.closedAt ? dateCourte(p.closedAt) : <Aujourdhui />}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>
            <section>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Ses équipes</p>
                {fiche.equipes.length === 0 ? (
                    <p className="text-xs text-slate-500">Membre d&apos;aucune équipe.</p>
                ) : (
                    <table className="w-full text-xs">
                        <thead><tr className="text-left text-slate-500"><th className="py-1">Équipe</th><th className="py-1">Membre depuis</th><th className="py-1">Jusqu&apos;au</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                            {fiche.equipes.map((e, i) => (
                                <tr key={i} className={cn(e.closedAt && "text-slate-500")}>
                                    <td className="py-1.5">{e.queueName} <span className="font-mono text-slate-400">{e.queueNumber}</span></td>
                                    <td className="py-1.5 tabular-nums">{dateCourte(e.firstSeenAt)}</td>
                                    <td className="py-1.5 tabular-nums">{e.closedAt ? dateCourte(e.closedAt) : <Aujourdhui />}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>
        </div>
    );
}
