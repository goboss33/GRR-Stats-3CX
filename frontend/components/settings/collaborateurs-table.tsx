"use client";

import { useEffect, useMemo, useState } from "react";
import { AtSign, Search, ShieldCheck, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tip } from "@/components/ui/tooltip";
import { Attente, ZoneEnEchec } from "@/components/ui/etat-chargement";
import { AvatarCollaborateur } from "@/components/avatar-collaborateur";
import { BadgeM365, LIBELLES_M365, LogoMicrosoft } from "@/components/badge-m365";
import { EnTeteTri, MenuFiltre, PucesDeFiltres, basculerDansSet } from "@/components/tableau-filtrable";
import { basculerTri, trierLignes, type DefinitionColonne, type TriTableau } from "@/services/domain/tri-tableau";
import type { CollaborateurRow, ResumeM365 } from "@/services/collaborators.service";
import { cn } from "@/lib/utils";

/**
 * L'ONGLET « COLLABORATEURS » DU JOURNAL — une ligne par poste du 3CX.
 *
 * Bâti sur la charpente du registre des files (en-têtes triables, menus à
 * cocher avec comptes, puces) : les deux tableaux se lisent pareil.
 *
 * Il s'ouvre filtré sur les membres d'une équipe : les 270 postes hors équipe
 * — salles, fax, boîtes vocales, postes libres — n'auront jamais de profil
 * Microsoft, et les compter d'emblée ferait passer l'intégration pour à
 * moitié cassée. Ils restent à un clic.
 */

type Colonne = "nom" | "poste" | "email" | "equipes" | "etat" | "depuis";

const COLONNES: Record<Colonne, DefinitionColonne<CollaborateurRow>> = {
    nom: { type: "texte", valeur: (c) => c.displayName },
    poste: { type: "texte", valeur: (c) => c.extension },
    email: { type: "texte", valeur: (c) => c.email },
    equipes: { type: "nombre", valeur: (c) => c.equipes.length },
    // L'ordre des états est celui de l'urgence : ce qui se corrige d'abord.
    etat: { type: "nombre", valeur: (c) => ({ "compte-desactive": 0, "inconnu-m365": 1, "sans-email": 2, "m365-inactif": 3, "ok": 4 }[c.matchState] ?? 5) },
    depuis: { type: "date", valeur: (c) => c.depuis },
};

const TRI_PAR_DEFAUT: TriTableau<Colonne> = { colonne: "nom", sens: "asc" };
const EN_EQUIPE = "en-equipe";
const HORS_EQUIPE = "hors-equipe";
const dateCourte = (iso: string) => new Date(iso).toLocaleDateString("fr-CH");

export function CollaborateursTable({
    serverId,
    filtreEtatInitial,
}: {
    serverId: string;
    /** États à précocher à l'ouverture (le lien « Voir les non rapprochés » du relevé). */
    filtreEtatInitial?: string[] | null;
}) {
    const [donnees, setDonnees] = useState<{ lignes: CollaborateurRow[]; resume: ResumeM365 } | "chargement" | "échec">("chargement");
    const [search, setSearch] = useState("");
    const [tri, setTri] = useState(TRI_PAR_DEFAUT);
    const [filtreEtat, setFiltreEtat] = useState<Set<string>>(new Set(filtreEtatInitial ?? []));
    const [filtreEquipe, setFiltreEquipe] = useState<Set<string>>(new Set([EN_EQUIPE]));
    const [filtreDomaine, setFiltreDomaine] = useState<Set<string>>(new Set());
    const [fiche, setFiche] = useState<CollaborateurRow | null>(null);

    const charger = () => {
        setDonnees("chargement");
        fetch(`/api/admin/xapi-journal?server=${encodeURIComponent(serverId)}&view=collaborateurs`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((d) => setDonnees({ lignes: d.lignes as CollaborateurRow[], resume: d.resume as ResumeM365 }))
            .catch(() => setDonnees("échec"));
    };
    useEffect(charger, [serverId]);

    const lignes = useMemo(() => (typeof donnees === "object" ? donnees.lignes : []), [donnees]);

    // Les cribles, séparés : chaque menu applique tous les autres sauf le sien
    // pour établir ses comptes (cf. MenuFiltre).
    const cribles = useMemo(() => {
        const term = search.trim().toLowerCase();
        return {
            recherche: (c: CollaborateurRow) =>
                !term ||
                c.displayName.toLowerCase().includes(term) ||
                c.extension.includes(term) ||
                (c.email ?? "").toLowerCase().includes(term) ||
                (c.jobTitle ?? "").toLowerCase().includes(term) ||
                c.equipes.some((e) => e.queueName.toLowerCase().includes(term) || e.queueNumber.includes(term)),
            etat: (c: CollaborateurRow) => filtreEtat.size === 0 || filtreEtat.has(c.matchState),
            equipe: (c: CollaborateurRow) =>
                filtreEquipe.size === 0 || filtreEquipe.has(c.equipes.length > 0 ? EN_EQUIPE : HORS_EQUIPE),
            domaine: (c: CollaborateurRow) => filtreDomaine.size === 0 || (!!c.domaine && filtreDomaine.has(c.domaine)),
        };
    }, [search, filtreEtat, filtreEquipe, filtreDomaine]);

    const compter = (liste: CollaborateurRow[], cle: (c: CollaborateurRow) => string | null) => {
        const m = new Map<string, number>();
        for (const c of liste) { const k = cle(c); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
        return m;
    };
    const optionsEtat = useMemo(() => {
        const base = lignes.filter((c) => cribles.recherche(c) && cribles.equipe(c) && cribles.domaine(c));
        const comptes = compter(base, (c) => c.matchState);
        return (["ok", "sans-email", "inconnu-m365", "compte-desactive", "m365-inactif"] as const)
            .map((e) => ({ valeur: e, libelle: LIBELLES_M365[e], compte: comptes.get(e) ?? 0 }));
    }, [lignes, cribles]);
    const optionsEquipe = useMemo(() => {
        const base = lignes.filter((c) => cribles.recherche(c) && cribles.etat(c) && cribles.domaine(c));
        return [
            { valeur: EN_EQUIPE, libelle: "Membre d'une équipe", compte: base.filter((c) => c.equipes.length > 0).length },
            { valeur: HORS_EQUIPE, libelle: "Hors équipe (salles, fax, postes libres…)", compte: base.filter((c) => c.equipes.length === 0).length },
        ];
    }, [lignes, cribles]);
    const optionsDomaine = useMemo(() => {
        const base = lignes.filter((c) => cribles.recherche(c) && cribles.etat(c) && cribles.equipe(c));
        return [...compter(base, (c) => c.domaine).entries()]
            .map(([valeur, compte]) => ({ valeur, libelle: valeur, compte }))
            .sort((a, b) => b.compte - a.compte || a.libelle.localeCompare(b.libelle, "fr"));
    }, [lignes, cribles]);

    const affichees = useMemo(() => trierLignes(
        lignes.filter((c) => cribles.recherche(c) && cribles.etat(c) && cribles.equipe(c) && cribles.domaine(c)),
        tri, COLONNES, (c) => c.displayName,
    ), [lignes, cribles, tri]);

    const puces = [
        ...[...filtreEtat].map((v) => ({ cle: `e:${v}`, libelle: LIBELLES_M365[v as keyof typeof LIBELLES_M365] ?? v, retirer: () => basculerDansSet(setFiltreEtat, v) })),
        ...[...filtreEquipe].map((v) => ({ cle: `q:${v}`, libelle: v === EN_EQUIPE ? "Membre d'une équipe" : "Hors équipe", retirer: () => basculerDansSet(setFiltreEquipe, v) })),
        ...[...filtreDomaine].map((v) => ({ cle: `d:${v}`, libelle: `@${v}`, retirer: () => basculerDansSet(setFiltreDomaine, v) })),
    ];
    const toutEffacer = () => { setSearch(""); setFiltreEtat(new Set()); setFiltreEquipe(new Set()); setFiltreDomaine(new Set()); };

    if (donnees === "chargement") return <div className="py-10"><Attente libelle="Lecture des collaborateurs…" /></div>;
    if (donnees === "échec") return <ZoneEnEchec message="La liste des collaborateurs n'a pas pu être lue." onReessayer={charger} />;
    const { resume } = donnees;

    return (
        <div className="space-y-4">
            {/* Le chiffre honnête d'abord : parmi ceux qui comptent pour les statistiques. */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-slate-600">
                <span className="flex items-center gap-1.5">
                    <LogoMicrosoft />
                    <span className="font-semibold text-slate-900">{resume.enEquipeRapproches}</span>
                    {" "}rapprochés sur {resume.enEquipe} collaborateurs en équipe
                </span>
                <span>{resume.total} postes au 3CX</span>
                <span>{resume.photos} photos</span>
            </div>

            <div className="space-y-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Rechercher par nom, poste, e-mail, titre ou équipe…"
                            className="pl-9"
                        />
                    </div>
                    <MenuFiltre libelle="État M365" icone={ShieldCheck} options={optionsEtat} selection={filtreEtat} onBasculer={(v) => basculerDansSet(setFiltreEtat, v)} />
                    <MenuFiltre libelle="Équipe" icone={Users} options={optionsEquipe} selection={filtreEquipe} onBasculer={(v) => basculerDansSet(setFiltreEquipe, v)} />
                    <MenuFiltre libelle="Domaine" icone={AtSign} options={optionsDomaine} selection={filtreDomaine} onBasculer={(v) => basculerDansSet(setFiltreDomaine, v)} />
                </div>
                {(puces.length > 0 || search.trim()) && (
                    <PucesDeFiltres puces={puces} affichees={affichees.length} total={lignes.length} unite="collaborateur(s)" onToutEffacer={toutEffacer} />
                )}
            </div>

            <Card>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-slate-50">
                                <tr>
                                    <EnTeteTri colonne="nom" libelle="Collaborateur" tri={tri} onTrier={(c) => setTri((t) => basculerTri(t, c, COLONNES))} />
                                    <EnTeteTri colonne="poste" libelle="Poste" tri={tri} onTrier={(c) => setTri((t) => basculerTri(t, c, COLONNES))} />
                                    <EnTeteTri colonne="email" libelle="E-mail" tri={tri} onTrier={(c) => setTri((t) => basculerTri(t, c, COLONNES))} />
                                    <EnTeteTri colonne="equipes" libelle="Équipes" tri={tri} onTrier={(c) => setTri((t) => basculerTri(t, c, COLONNES))} />
                                    <EnTeteTri colonne="etat" libelle="Microsoft 365" tri={tri} onTrier={(c) => setTri((t) => basculerTri(t, c, COLONNES))} />
                                    <EnTeteTri colonne="depuis" libelle="Depuis" tri={tri} onTrier={(c) => setTri((t) => basculerTri(t, c, COLONNES))} />
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {affichees.map((c) => (
                                    <tr
                                        key={c.extension}
                                        onClick={() => setFiche(c)}
                                        className="cursor-pointer hover:bg-slate-50"
                                        title="Voir la fiche (postes, titres et équipes datés)"
                                    >
                                        <td className="px-4 py-2">
                                            <div className="flex items-center gap-3">
                                                <AvatarCollaborateur name={c.displayName} photoUrl={c.photoUrl} />
                                                <div>
                                                    <p className="font-medium text-slate-900">{c.displayName}</p>
                                                    {c.jobTitle && <p className="text-xs text-slate-500">{c.jobTitle}</p>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-2 font-mono text-xs text-slate-600">{c.extension}</td>
                                        <td className="px-4 py-2 text-xs text-slate-600">{c.email ?? <span className="text-slate-400">—</span>}</td>
                                        <td className="px-4 py-2">
                                            <Equipes equipes={c.equipes} />
                                        </td>
                                        <td className="px-4 py-2"><BadgeM365 etat={c.matchState} /></td>
                                        <td className="px-4 py-2 text-xs text-slate-500">{dateCourte(c.depuis)}</td>
                                    </tr>
                                ))}
                                {affichees.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="py-8 text-center text-slate-500">
                                            Aucun collaborateur ne correspond à ces critères
                                            <button type="button" onClick={toutEffacer} className="ml-2 text-blue-600 underline underline-offset-2 hover:text-blue-800">
                                                Tout effacer
                                            </button>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            <FicheCollaborateur serverId={serverId} collaborateur={fiche} onClose={() => setFiche(null)} />
        </div>
    );
}

/** Les équipes d'un collaborateur : trois noms au plus, le reste dans l'infobulle. */
function Equipes({ equipes }: { equipes: CollaborateurRow["equipes"] }) {
    if (equipes.length === 0) return <span className="text-xs text-slate-400">—</span>;
    const visibles = equipes.slice(0, 3);
    const reste = equipes.length - visibles.length;
    return (
        <Tip content={equipes.map((e) => `${e.queueName} (${e.queueNumber})`).join(" · ")}>
            <div className="flex flex-wrap items-center gap-1">
                {visibles.map((e) => (
                    <span key={e.queueNumber} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-700">
                        {e.queueName}
                    </span>
                ))}
                {reste > 0 && <span className="text-[11px] text-slate-500">+{reste}</span>}
            </div>
        </Tip>
    );
}

interface Fiche {
    postes: { displayName: string; email: string | null; jobTitle: string | null; matchState: string; firstSeenAt: string; lastSeenAt: string; closedAt: string | null }[];
    equipes: { queueNumber: string; queueName: string; firstSeenAt: string; lastSeenAt: string; closedAt: string | null }[];
}

/** La fiche : ce que le journal sait de ce poste, daté. */
function FicheCollaborateur({ serverId, collaborateur, onClose }: {
    serverId: string;
    collaborateur: CollaborateurRow | null;
    onClose: () => void;
}) {
    const [fiche, setFiche] = useState<Fiche | "chargement" | "échec">("chargement");
    const extension = collaborateur?.extension ?? null;

    useEffect(() => {
        if (!extension) return;
        setFiche("chargement");
        fetch(`/api/admin/xapi-journal?server=${encodeURIComponent(serverId)}&collab=${encodeURIComponent(extension)}`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((d) => setFiche(d.fiche as Fiche))
            .catch(() => setFiche("échec"));
    }, [serverId, extension]);

    return (
        <Dialog open={collaborateur !== null} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                {/* L'en-tête vient de la ligne cliquée : la fiche s'annonce avant d'avoir chargé. */}
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-3">
                        {collaborateur && <AvatarCollaborateur name={collaborateur.displayName} photoUrl={collaborateur.photoUrl} className="h-12 w-12 text-sm" />}
                        <span>
                            {collaborateur?.displayName}
                            <span className="ml-2 rounded border bg-slate-50 px-1.5 py-0.5 font-mono text-sm font-normal text-slate-600">{collaborateur?.extension}</span>
                        </span>
                    </DialogTitle>
                    <DialogDescription asChild>
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            {collaborateur?.jobTitle && <span>{collaborateur.jobTitle}</span>}
                            {collaborateur?.email && <span className="text-slate-500">{collaborateur.email}</span>}
                            {collaborateur && <BadgeM365 etat={collaborateur.matchState} />}
                        </div>
                    </DialogDescription>
                </DialogHeader>

                {fiche === "chargement" ? (
                    <div className="py-8"><Attente libelle="Lecture du journal…" /></div>
                ) : fiche === "échec" ? (
                    <p className="text-sm text-red-700">La fiche n&apos;a pas pu être lue.</p>
                ) : (
                    <div className="space-y-5 text-sm">
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
                                            <td className="py-1.5 tabular-nums">{p.closedAt ? dateCourte(p.closedAt) : <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">aujourd&apos;hui</span>}</td>
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
                                                <td className="py-1.5 tabular-nums">{e.closedAt ? dateCourte(e.closedAt) : <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">aujourd&apos;hui</span>}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </section>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
