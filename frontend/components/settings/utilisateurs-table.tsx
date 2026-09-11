"use client";

import { useEffect, useMemo, useState } from "react";
import { AtSign, CheckCircle2, Lock, Pencil, Search, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tip } from "@/components/ui/tooltip";
import { Attente, ZoneEnEchec } from "@/components/ui/etat-chargement";
import { AvatarCollaborateur } from "@/components/avatar-collaborateur";
import { QIcon } from "@/components/q-icon";
import { BadgeM365, LIBELLES_M365, LogoMicrosoft } from "@/components/badge-m365";
import { EnTeteTri, MenuFiltre, PucesDeFiltres, basculerDansSet } from "@/components/tableau-filtrable";
import { SelecteurColonnes } from "@/components/selecteur-colonnes";
import { ZoneDefilable } from "@/components/zone-defilable";
import { UserAccessDialog } from "@/components/user-access-dialog";
import { ModifierCompteDialog, NouveauCompteDialog } from "@/components/settings/compte-dialogs";
import { basculerTri, trierLignes, type DefinitionColonne, type TriTableau } from "@/services/domain/tri-tableau";
import type { CollaborateurRow, EtatPresence, PresenceCollaborateur, ResumeM365 } from "@/services/collaborators.service";
import { formatHeures, partsPresence, type PresenceState } from "@/services/domain/presence";
import {
    DROITS_PAR_DEFAUT_LIBELLES, LIBELLES_ROLE_COMPTE, ROLES_COMPTE, motifBlocage, type RoleCompte,
} from "@/services/domain/compte-collaborateur";
import {
    CATALOGUE_COLONNES, CLE_MEMO_COLONNES, FILTRES_DES_VUES, LIBELLES_VUE,
    colonnesParDefaut, lireColonnesMemorisees, vueDepuisFiltres, type CleColonne, type Vue,
} from "@/services/domain/utilisateurs-tableau";
import { cn } from "@/lib/utils";

/**
 * L'ÉCRAN « UTILISATEURS » — une ligne par personne (septembre 2026).
 *
 * Deux anciens écrans réunis : les comptes de l'application, et l'annuaire
 * des postes 3CX du journal. Une ligne par personne, rapprochée par e-mail :
 * un poste sans compte, un compte sans poste, ou les deux ensemble. Trois
 * vues rapides règlent les filtres — « Comptes » à l'ouverture, « À
 * préparer » pour une campagne, « Tous » pour l'annuaire entier. Les
 * colonnes se choisissent, et le choix reste dans le navigateur.
 *
 * Bâti sur la charpente du registre des files (en-têtes triables, menus à
 * cocher avec comptes, puces) : les tableaux de l'application se lisent
 * pareil. Cliquer une ligne ouvre le dialogue d'accès, qui porte aussi la
 * fiche 3CX ; les actions vivent à droite.
 */

type Colonne = "nom" | "poste" | "email" | "equipes" | "etat" | "depuis" | "compte" | "presence" | "presenceFile" | "perimetre" | "cree";

/** Où en est le compte de l'application pour cette ligne. */
type EtatCompte = "existant" | "a-preparer" | "non-preparable";
const LIBELLES_ETAT_COMPTE: Record<EtatCompte, string> = {
    existant: "Compte existant",
    "a-preparer": "À préparer",
    "non-preparable": "Non préparable (sans e-mail ou non rapproché)",
};
const situation = (c: CollaborateurRow) => ({ email: c.email, matchState: c.matchState, compteExistant: c.compte !== null });
const etatCompte = (c: CollaborateurRow): EtatCompte =>
    c.compte ? "existant" : motifBlocage(situation(c)) ? "non-preparable" : "a-preparer";
const LIBELLES_ROLE: Record<string, string> = { ADMIN: "Administrateur", MODERATOR: "Modérateur", MANAGER: "Manager", AGENT: "Collaborateur" };
/** Les états Microsoft 365 de l'annuaire, plus celui d'un compte sans poste. */
const ETAT_COMPTE_SEUL = "compte-seul";
const LIBELLES_ETAT: Record<string, string> = { ...LIBELLES_M365, [ETAT_COMPTE_SEUL]: "Compte seul, sans poste 3CX" };

const COLONNES: Record<Colonne, DefinitionColonne<CollaborateurRow>> = {
    nom: { type: "texte", valeur: (c) => c.displayName },
    poste: { type: "texte", valeur: (c) => c.extension || null },
    email: { type: "texte", valeur: (c) => c.email },
    equipes: { type: "nombre", valeur: (c) => c.equipes.length },
    // L'ordre des états est celui de l'urgence : ce qui se corrige d'abord.
    etat: { type: "nombre", valeur: (c) => ({ "compte-desactive": 0, "inconnu-m365": 1, "sans-email": 2, "m365-inactif": 3, "ok": 4 }[c.matchState] ?? 5) },
    depuis: { type: "date", valeur: (c) => c.depuis },
    // Comptes existants d'abord, puis ceux à préparer, puis les impossibles.
    compte: { type: "nombre", valeur: (c) => ({ existant: 2, "a-preparer": 1, "non-preparable": 0 }[etatCompte(c)]) },
    // Part de temps disponible ; sans relevé, en queue de tri.
    presence: { type: "nombre", valeur: (c) => (c.presence?.recent ? partsPresence(c.presence.recent)?.available ?? -1 : -1) },
    presenceFile: { type: "nombre", valeur: (c) => (c.equipes.length > 0 && c.presence?.recent ? partsPresence(c.presence.recent)?.queue ?? -1 : -1) },
    perimetre: { type: "nombre", valeur: (c) => c.compte?.perimetre ?? -1 },

    cree: { type: "date", valeur: (c) => c.compte?.createdAt ?? null },
};

/** Quelle clé de tri derrière chaque colonne du catalogue ; « actions » ne se trie pas. */
const TRI_DE: Partial<Record<CleColonne, Colonne>> = {
    collaborateur: "nom", poste: "poste", equipes: "equipes", compte: "compte", presence: "presence",
    email: "email", m365: "etat", files: "presenceFile", perimetre: "perimetre", cree: "cree", depuis: "depuis",
};

/**
 * Grammaire des états de présence — les couleurs du client 3CX. Le BLEU est
 * celui des profils personnalisés : le PBX ne dit pas ce qu'ils font, et ceux
 * d'ici veulent dire « joignable autrement » (« En séance · sonne 5 s »).
 * Ils ne comptent pas dans la disponibilité, qui reste stricte.
 */
const ETATS_PRESENCE: Record<PresenceState, { libelle: string; pastille: string; barre: string }> = {
    available: { libelle: "Disponible", pastille: "bg-emerald-500", barre: "bg-emerald-500" },
    custom: { libelle: "Profil personnalisé", pastille: "bg-blue-500", barre: "bg-blue-500" },
    absent: { libelle: "Absent", pastille: "bg-amber-400", barre: "bg-amber-400" },
    dnd: { libelle: "Ne pas déranger", pastille: "bg-red-500", barre: "bg-red-500" },
    offline: { libelle: "Hors ligne (téléphone non enregistré)", pastille: "bg-slate-300", barre: "bg-slate-300" },
};

const TRI_PAR_DEFAUT: TriTableau<Colonne> = { colonne: "nom", sens: "asc" };
const EN_EQUIPE = "en-equipe";
const HORS_EQUIPE = "hors-equipe";
const dateCourte = (iso: string) => new Date(iso).toLocaleDateString("fr-CH");

type Donnees = { lignes: CollaborateurRow[]; resume: ResumeM365; presence: EtatPresence; comptes: number };
type Modale = { type: "acces" | "preparation" | "modifier"; ligne: CollaborateurRow };

export function UtilisateursTable({
    serverId,
    filtreEtatInitial,
}: {
    serverId: string;
    /** États M365 à précocher à l'ouverture (le lien « voir les collaborateurs » du Journal) : ouvre l'annuaire entier. */
    filtreEtatInitial?: string[] | null;
}) {
    const [donnees, setDonnees] = useState<Donnees | "chargement" | "échec">("chargement");
    const [moi, setMoi] = useState<{ id: string; role: string } | null>(null);
    const [search, setSearch] = useState("");
    const [tri, setTri] = useState(TRI_PAR_DEFAUT);
    // À l'ouverture : la vue « Comptes » — sauf quand le Journal envoie ici
    // voir des postes non rapprochés, où c'est l'annuaire entier qu'il faut.
    const [filtreEtat, setFiltreEtat] = useState<Set<string>>(new Set(filtreEtatInitial ?? []));
    const [filtreEquipe, setFiltreEquipe] = useState<Set<string>>(new Set(filtreEtatInitial ? [EN_EQUIPE] : FILTRES_DES_VUES.comptes.equipe));
    const [filtreDomaine, setFiltreDomaine] = useState<Set<string>>(new Set());
    const [filtreCompte, setFiltreCompte] = useState<Set<string>>(new Set(filtreEtatInitial ? [] : FILTRES_DES_VUES.comptes.compte));
    const [colonnes, setColonnes] = useState<Set<CleColonne>>(colonnesParDefaut);
    /**
     * UNE SEULE modale à la fois, et donc un seul voile : deux états séparés
     * laissaient deux dialogues s'ouvrir sur le même clic, et leurs voiles se
     * cumulaient (constaté le 11 sept. 2026).
     */
    const [modale, setModale] = useState<Modale | null>(null);
    const [creation, setCreation] = useState(false);

    const charger = () => {
        setDonnees("chargement");
        fetch(`/api/admin/xapi-journal?server=${encodeURIComponent(serverId)}&view=collaborateurs`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((d) => setDonnees({
                lignes: d.lignes as CollaborateurRow[],
                resume: d.resume as ResumeM365,
                presence: (d.presence as EtatPresence | undefined) ?? { enabled: false, jours: 30, sampledAt: null },
                comptes: (d.comptes as number | undefined) ?? 0,
            }))
            .catch(() => setDonnees("échec"));
    };
    useEffect(charger, [serverId]);
    useEffect(() => {
        fetch("/api/profile").then((r) => r.json()).then((d) => { if (d.user) setMoi({ id: d.user.id, role: d.user.role || "AGENT" }); }).catch(() => {});
    }, []);

    // Le choix des colonnes vit dans le navigateur : relu après le premier
    // rendu (jamais pendant, l'hydratation divergerait), écrit à chaque bascule.
    useEffect(() => {
        try { setColonnes(lireColonnesMemorisees(localStorage.getItem(CLE_MEMO_COLONNES))); } catch { /* navigateur sans stockage : le défaut */ }
    }, []);
    const basculerColonne = (cle: CleColonne) => setColonnes((prev) => {
        const s = new Set(prev);
        if (s.has(cle)) s.delete(cle); else s.add(cle);
        try { localStorage.setItem(CLE_MEMO_COLONNES, JSON.stringify([...s])); } catch { /* idem */ }
        return s;
    });

    const lignes = useMemo(() => (typeof donnees === "object" ? donnees.lignes : []), [donnees]);
    const presenceActive = typeof donnees === "object" && donnees.presence.enabled;
    const visible = (cle: CleColonne) => {
        const def = CATALOGUE_COLONNES.find((c) => c.cle === cle);
        if (def?.presence && !presenceActive) return false;
        return colonnes.has(cle);
    };

    // Les vues rapides ne sont que des réglages de filtres ; la vue courante
    // se déduit des filtres, et disparaît dès qu'on les compose à la main.
    const vue = vueDepuisFiltres(filtreCompte, filtreEquipe);
    const appliquerVue = (v: Vue) => {
        setFiltreCompte(new Set(FILTRES_DES_VUES[v].compte));
        setFiltreEquipe(new Set(FILTRES_DES_VUES[v].equipe));
    };
    const comptesVues: Record<Vue, number> = useMemo(() => ({
        comptes: lignes.filter((c) => c.compte).length,
        "a-preparer": lignes.filter((c) => etatCompte(c) === "a-preparer" && c.equipes.length > 0).length,
        tous: lignes.length,
    }), [lignes]);

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
            compte: (c: CollaborateurRow) => filtreCompte.size === 0 || filtreCompte.has(etatCompte(c)),
        };
    }, [search, filtreEtat, filtreEquipe, filtreDomaine, filtreCompte]);

    const compter = (liste: CollaborateurRow[], cle: (c: CollaborateurRow) => string | null) => {
        const m = new Map<string, number>();
        for (const c of liste) { const k = cle(c); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
        return m;
    };
    const optionsEtat = useMemo(() => {
        const base = lignes.filter((c) => cribles.recherche(c) && cribles.equipe(c) && cribles.domaine(c) && cribles.compte(c));
        const comptes = compter(base, (c) => c.matchState);
        return (["ok", "sans-email", "inconnu-m365", "compte-desactive", "m365-inactif", ETAT_COMPTE_SEUL] as const)
            .map((e) => ({ valeur: e, libelle: LIBELLES_ETAT[e], compte: comptes.get(e) ?? 0 }));
    }, [lignes, cribles]);
    const optionsEquipe = useMemo(() => {
        const base = lignes.filter((c) => cribles.recherche(c) && cribles.etat(c) && cribles.domaine(c) && cribles.compte(c));
        return [
            { valeur: EN_EQUIPE, libelle: "Membre d'une équipe", compte: base.filter((c) => c.equipes.length > 0).length },
            { valeur: HORS_EQUIPE, libelle: "Hors équipe (salles, fax, postes libres…)", compte: base.filter((c) => c.equipes.length === 0).length },
        ];
    }, [lignes, cribles]);
    const optionsDomaine = useMemo(() => {
        const base = lignes.filter((c) => cribles.recherche(c) && cribles.etat(c) && cribles.equipe(c) && cribles.compte(c));
        return [...compter(base, (c) => c.domaine).entries()]
            .map(([valeur, compte]) => ({ valeur, libelle: valeur, compte }))
            .sort((a, b) => b.compte - a.compte || a.libelle.localeCompare(b.libelle, "fr"));
    }, [lignes, cribles]);
    const optionsCompte = useMemo(() => {
        const base = lignes.filter((c) => cribles.recherche(c) && cribles.etat(c) && cribles.equipe(c) && cribles.domaine(c));
        const comptes = compter(base, (c) => etatCompte(c));
        return (["a-preparer", "existant", "non-preparable"] as const)
            .map((e) => ({ valeur: e, libelle: LIBELLES_ETAT_COMPTE[e], compte: comptes.get(e) ?? 0 }));
    }, [lignes, cribles]);

    const affichees = useMemo(() => trierLignes(
        lignes.filter((c) => cribles.recherche(c) && cribles.etat(c) && cribles.equipe(c) && cribles.domaine(c) && cribles.compte(c)),
        tri, COLONNES, (c) => c.displayName,
    ), [lignes, cribles, tri]);

    const puces = [
        ...[...filtreEtat].map((v) => ({ cle: `e:${v}`, libelle: LIBELLES_ETAT[v] ?? v, retirer: () => basculerDansSet(setFiltreEtat, v) })),
        ...[...filtreEquipe].map((v) => ({ cle: `q:${v}`, libelle: v === EN_EQUIPE ? "Membre d'une équipe" : "Hors équipe", retirer: () => basculerDansSet(setFiltreEquipe, v) })),
        ...[...filtreDomaine].map((v) => ({ cle: `d:${v}`, libelle: `@${v}`, retirer: () => basculerDansSet(setFiltreDomaine, v) })),
        ...[...filtreCompte].map((v) => ({ cle: `c:${v}`, libelle: LIBELLES_ETAT_COMPTE[v as EtatCompte] ?? v, retirer: () => basculerDansSet(setFiltreCompte, v) })),
    ];
    const toutEffacer = () => { setSearch(""); setFiltreEtat(new Set()); setFiltreEquipe(new Set()); setFiltreDomaine(new Set()); setFiltreCompte(new Set()); };

    const supprimer = async (c: CollaborateurRow) => {
        if (!c.compte) return;
        if (!confirm(`Supprimer le compte de ${c.displayName} ? Son périmètre et ses droits disparaissent avec lui.`)) return;
        try {
            const res = await fetch(`/api/admin/users?id=${encodeURIComponent(c.compte.id)}`, { method: "DELETE" });
            const data = await res.json();
            if (!res.ok) toast.error(data.error || "Erreur lors de la suppression");
            else { toast.success("Compte supprimé"); charger(); }
        } catch {
            toast.error("Erreur lors de la suppression");
        }
    };

    if (donnees === "chargement") return <div className="py-10"><Attente libelle="Lecture des utilisateurs…" /></div>;
    if (donnees === "échec") return <ZoneEnEchec message="La liste des utilisateurs n'a pas pu être lue." onReessayer={charger} />;
    const { resume, presence, comptes } = donnees;
    const colonnesAffichees = CATALOGUE_COLONNES.filter((c) => visible(c.cle));
    const choisissables = CATALOGUE_COLONNES.filter((c) => !c.fixe && (!c.presence || presenceActive));
    const enTete = (cle: CleColonne, libelle: string) => {
        const triCle = TRI_DE[cle];
        return triCle
            ? <EnTeteTri key={cle} colonne={triCle} libelle={libelle} tri={tri} onTrier={(c) => setTri((t) => basculerTri(t, c, COLONNES))} />
            : <th key={cle} className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-500">{libelle}</th>;
    };
    const libelleColonne = (c: (typeof CATALOGUE_COLONNES)[number]) =>
        c.presence ? `${c.libelle} (${presence.jours} j)` : c.libelle;

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
                <span><span className="font-semibold text-slate-900">{comptes}</span> comptes</span>
                <span>{resume.photos} photos</span>
                {presence.enabled && (
                    <span className={cn("flex items-center gap-1.5", presence.sampledAt ? "text-slate-600" : "text-amber-700")}>
                        <span className={cn("h-2 w-2 rounded-full", presence.sampledAt ? "bg-emerald-500" : "bg-amber-400")} />
                        {presence.sampledAt
                            ? `présence relevée il y a ${Math.max(0, Math.round((Date.now() - new Date(presence.sampledAt).getTime()) / 1000))} s`
                            : "présence : relevé arrêté ou en retard"}
                    </span>
                )}
            </div>

            <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                    {/* Les vues rapides : des filtres prêts, pas un autre écran. */}
                    <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-sm">
                        {(Object.keys(LIBELLES_VUE) as Vue[]).map((v) => (
                            <button
                                key={v}
                                type="button"
                                onClick={() => appliquerVue(v)}
                                aria-pressed={vue === v}
                                className={cn(
                                    "rounded-md px-3 py-1.5 font-medium transition-colors",
                                    vue === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
                                )}
                            >
                                {LIBELLES_VUE[v]} <span className="ml-1 text-xs font-normal tabular-nums text-slate-400">{comptesVues[v]}</span>
                            </button>
                        ))}
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                        <SelecteurColonnes
                            colonnes={choisissables.map((c) => ({ cle: c.cle, libelle: libelleColonne(c) }))}
                            visibles={colonnes}
                            onBasculer={basculerColonne}
                        />
                        <Button size="sm" className="h-9 gap-1.5" onClick={() => setCreation(true)}>
                            <UserPlus className="h-4 w-4" />
                            Nouveau compte
                        </Button>
                    </div>
                </div>
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
                    <MenuFiltre libelle="Compte" icone={UserPlus} options={optionsCompte} selection={filtreCompte} onBasculer={(v) => basculerDansSet(setFiltreCompte, v)} />
                    <MenuFiltre libelle="État M365" icone={ShieldCheck} options={optionsEtat} selection={filtreEtat} onBasculer={(v) => basculerDansSet(setFiltreEtat, v)} />
                    <MenuFiltre libelle="Équipe" icone={Users} options={optionsEquipe} selection={filtreEquipe} onBasculer={(v) => basculerDansSet(setFiltreEquipe, v)} />
                    <MenuFiltre libelle="Domaine" icone={AtSign} options={optionsDomaine} selection={filtreDomaine} onBasculer={(v) => basculerDansSet(setFiltreDomaine, v)} />
                </div>
                {(puces.length > 0 || search.trim()) && (
                    <PucesDeFiltres puces={puces} affichees={affichees.length} total={lignes.length} unite="ligne(s)" onToutEffacer={toutEffacer} />
                )}
            </div>

            <Card>
                <CardContent className="p-0">
                    <ZoneDefilable>
                        <table className="w-full text-sm">
                            <thead className="border-b bg-slate-50">
                                <tr>
                                    {colonnesAffichees.map((c) => enTete(c.cle, libelleColonne(c)))}
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {affichees.map((c) => (
                                    <tr
                                        key={c.cle}
                                        onClick={() => setModale((m) => m ?? { type: "acces", ligne: c })}
                                        className="cursor-pointer hover:bg-slate-50"
                                        title={c.compte ? "Accès, onboarding et fiche 3CX" : "Fiche 3CX"}
                                    >
                                        {colonnesAffichees.map((col) => {
                                            switch (col.cle) {
                                                case "collaborateur": return (
                                                    <td key={col.cle} className="px-4 py-2">
                                                        <div className="flex items-center gap-3">
                                                            <AvatarAvecPresence collaborateur={c} />
                                                            <div>
                                                                <p className="font-medium text-slate-900">{c.displayName}</p>
                                                                {c.jobTitle && <p className="text-xs text-slate-500">{c.jobTitle}</p>}
                                                            </div>
                                                        </div>
                                                    </td>
                                                );
                                                case "poste": return <td key={col.cle} className="px-4 py-2 font-mono text-xs text-slate-600">{c.extension || <span className="font-sans text-slate-400">—</span>}</td>;
                                                case "equipes": return <td key={col.cle} className="px-4 py-2"><Equipes equipes={c.equipes} /></td>;
                                                case "compte": return <td key={col.cle} className="px-4 py-2"><CelluleCompte collaborateur={c} /></td>;
                                                case "presence": return <td key={col.cle} className="px-4 py-2"><CellulePresence presence={c.presence} jours={presence.jours} /></td>;
                                                case "email": return <td key={col.cle} className="px-4 py-2 text-xs text-slate-600">{c.email ?? <span className="text-slate-400">—</span>}</td>;
                                                case "m365": return <td key={col.cle} className="px-4 py-2">{c.sansPoste ? <span className="text-xs text-slate-400">—</span> : <BadgeM365 etat={c.matchState} />}</td>;
                                                case "files": return <td key={col.cle} className="px-4 py-2"><CelluleFile collaborateur={c} jours={presence.jours} /></td>;
                                                case "perimetre": return <td key={col.cle} className="px-4 py-2 text-xs tabular-nums text-slate-600">{c.compte ? `${c.compte.perimetre} file${c.compte.perimetre > 1 ? "s" : ""}` : <span className="text-slate-400">—</span>}</td>;
                                                case "cree": return <td key={col.cle} className="px-4 py-2 text-xs text-slate-500">{c.compte ? dateCourte(c.compte.createdAt) : <span className="text-slate-400">—</span>}</td>;
                                                case "depuis": return <td key={col.cle} className="px-4 py-2 text-xs text-slate-500">{c.sansPoste ? <span className="text-slate-400">—</span> : dateCourte(c.depuis)}</td>;
                                                case "actions": return (
                                                    // Les boutons ne doivent pas ouvrir le dialogue de la ligne :
                                                    // on arrête le clic ici, dès le pointeur.
                                                    <td key={col.cle} className="px-4 py-2" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                                                        <CelluleActions
                                                            collaborateur={c}
                                                            moi={moi}
                                                            onAcces={() => setModale({ type: "acces", ligne: c })}
                                                            onModifier={() => setModale({ type: "modifier", ligne: c })}
                                                            onSupprimer={() => supprimer(c)}
                                                            onPreparer={() => setModale({ type: "preparation", ligne: c })}
                                                        />
                                                    </td>
                                                );
                                            }
                                        })}
                                    </tr>
                                ))}
                                {affichees.length === 0 && (
                                    <tr>
                                        <td colSpan={colonnesAffichees.length} className="py-8 text-center text-slate-500">
                                            Aucune ligne ne correspond à ces critères
                                            <button type="button" onClick={toutEffacer} className="ml-2 text-blue-600 underline underline-offset-2 hover:text-blue-800">
                                                Tout effacer
                                            </button>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </ZoneDefilable>
                </CardContent>
            </Card>

            <UserAccessDialog
                open={modale?.type === "acces"}
                onOpenChange={(o) => !o && setModale(null)}
                user={modale?.type === "acces" && modale.ligne.compte
                    ? { id: modale.ligne.compte.id, email: modale.ligne.compte.email, firstName: modale.ligne.compte.firstName, lastName: modale.ligne.compte.lastName, role: modale.ligne.compte.role }
                    : null}
                poste={modale?.type === "acces" && !modale.ligne.sansPoste
                    ? { serverId, extension: modale.ligne.extension, displayName: modale.ligne.displayName, jobTitle: modale.ligne.jobTitle, email: modale.ligne.email, matchState: modale.ligne.matchState, photoUrl: modale.ligne.photoUrl }
                    : null}
            />
            <PreparerCompteDialog
                serverId={serverId}
                collaborateur={modale?.type === "preparation" ? modale.ligne : null}
                onClose={(cree) => { setModale(null); if (cree) charger(); }}
            />
            <ModifierCompteDialog
                compte={modale?.type === "modifier" && modale.ligne.compte ? modale.ligne.compte : null}
                onClose={() => setModale(null)}
                roleCourant={moi?.role ?? "AGENT"}
                onModifie={charger}
            />
            <NouveauCompteDialog open={creation} onOpenChange={setCreation} roleCourant={moi?.role ?? "AGENT"} onCree={charger} />
        </div>
    );
}

/**
 * Le compte de l'application : sa nature, son mode de connexion, sa dernière
 * venue — ou ce qui l'attend. La date est celle de la dernière ACTIVITÉ, pas
 * de la dernière authentification : une session Microsoft vaut trente jours,
 * et « connecté le 18 août » pour quelqu'un venu ce matin ne disait rien
 * (retour du 11 sept. 2026). L'authentification reste dans l'infobulle.
 */
function CelluleCompte({ collaborateur: c }: { collaborateur: CollaborateurRow }) {
    if (c.compte) {
        const microsoft = c.compte.authProvider === "MICROSOFT";
        const activite = c.compte.lastSeenAt ?? c.compte.lastLoginAt;
        const detail = activite
            ? `Dernière activité le ${new Date(activite).toLocaleString("fr-CH", { dateStyle: "short", timeStyle: "short" })}`
              + (c.compte.lastLoginAt ? ` · dernière authentification le ${dateCourte(c.compte.lastLoginAt)}` : "")
            : "Ne s'est encore jamais connecté.";
        return (
            <div className="text-xs">
                <p className="flex items-center gap-1.5 font-medium text-slate-700">
                    {LIBELLES_ROLE[c.compte.role] ?? c.compte.role}
                    <Tip content={microsoft ? "Connexion Microsoft" : "Connexion par mot de passe"}>
                        <span className="inline-flex">{microsoft ? <LogoMicrosoft /> : <Lock className="h-3.5 w-3.5 text-slate-400" />}</span>
                    </Tip>
                </p>
                <Tip content={detail}>
                    <p className={cn(activite ? "text-slate-500" : "text-amber-700")}>
                        {activite ? `connecté le ${dateCourte(activite)}` : "jamais connecté"}
                    </p>
                </Tip>
            </div>
        );
    }
    const motif = motifBlocage(situation(c));
    if (motif) return <Tip content={motif}><span className="text-xs text-slate-400">—</span></Tip>;
    return <span className="text-xs text-slate-500">À préparer</span>;
}

/** Ce qu'on peut faire de cette ligne : les trois gestes d'un compte, ou sa préparation. */
function CelluleActions({ collaborateur: c, moi, onAcces, onModifier, onSupprimer, onPreparer }: {
    collaborateur: CollaborateurRow;
    moi: { id: string; role: string } | null;
    onAcces: () => void;
    onModifier: () => void;
    onSupprimer: () => void;
    onPreparer: () => void;
}) {
    if (c.compte) {
        const soi = moi?.id === c.compte.id;
        return (
            <div className="flex items-center justify-end gap-0.5">
                <Tip content="Accès, onboarding et fiche 3CX">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-blue-700" onClick={onAcces}><ShieldCheck className="h-4 w-4" /></Button>
                </Tip>
                <Tip content="Modifier le compte">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-slate-900" onClick={onModifier}><Pencil className="h-4 w-4" /></Button>
                </Tip>
                <Tip content={soi ? "On ne supprime pas son propre compte" : "Supprimer le compte"}>
                    <span className="inline-flex">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-50 hover:text-red-700" onClick={onSupprimer} disabled={soi}><Trash2 className="h-4 w-4" /></Button>
                    </span>
                </Tip>
            </div>
        );
    }
    if (motifBlocage(situation(c))) return <div className="text-right text-xs text-slate-400">—</div>;
    return (
        <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={onPreparer} className="h-8 gap-1.5 text-xs">
                <UserPlus className="h-3.5 w-3.5" />
                Préparer le compte
            </Button>
        </div>
    );
}

/**
 * L'avatar, avec la pastille de l'état au dernier relevé quand le tenant
 * échantillonne la présence — même code de couleurs que le client 3CX.
 */
function AvatarAvecPresence({ collaborateur: c }: { collaborateur: CollaborateurRow }) {
    const now = c.presence?.now ?? null;
    if (!now) return <AvatarCollaborateur name={c.displayName} photoUrl={c.photoUrl} />;
    const etat = ETATS_PRESENCE[now.state];
    // Le nom d'usage du profil quand la personne en a donné un (« En séance »),
    // le libellé générique sinon.
    const nom = now.state === "custom" && now.profileLabel ? now.profileLabel : etat.libelle;
    return (
        <Tip content={`${nom}${now.state === "offline" ? "" : now.queueLoggedIn ? " · connecté aux files" : " · déconnecté des files"} — au dernier relevé`}>
            <span className="relative inline-flex">
                <AvatarCollaborateur name={c.displayName} photoUrl={c.photoUrl} />
                <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white", etat.pastille)} />
            </span>
        </Tip>
    );
}

/**
 * Les parts de temps de bureau des derniers jours : une barre empilée et le
 * pourcentage DISPONIBLE au sens strict. Le détail (heures observées, horaires
 * appliqués, les cinq parts) vit dans l'infobulle — jamais une chronologie.
 * La connexion aux files a sa propre colonne, pour pouvoir trier dessus.
 */
function CellulePresence({ presence, jours }: { presence: PresenceCollaborateur | null; jours: number }) {
    const recent = presence?.recent ?? null;
    const parts = recent ? partsPresence(recent) : null;
    if (!recent || !parts) {
        return (
            <Tip content={`Aucune heure de bureau observée sur ${jours} jours.`}>
                <span className="text-xs text-slate-400">—</span>
            </Tip>
        );
    }
    const horaires = recent.hoursSource === "department" && recent.departement
        ? `horaires ${recent.departement}`
        : "horaires par défaut, le département n'en déclare pas";
    const detail = `Sur ${formatHeures(recent.sampledSeconds)} de bureau observées (${recent.days} jour${recent.days > 1 ? "s" : ""}, ${horaires}) : `
        + `disponible ${parts.available} % · profil personnalisé ${parts.custom} % · absent ${parts.absent} % · ne pas déranger ${parts.dnd} % · hors ligne ${parts.offline} %`;
    const segments: Array<[PresenceState, number]> = [["available", parts.available], ["custom", parts.custom], ["absent", parts.absent], ["dnd", parts.dnd], ["offline", parts.offline]];
    return (
        <Tip content={detail} align="start">
            <div className="flex items-center gap-2.5">
                <span className="flex h-2 w-28 shrink-0 gap-px overflow-hidden rounded-full">
                    {segments.map(([etat, part]) => part > 0 && (
                        <span key={etat} className={cn("h-full", ETATS_PRESENCE[etat].barre)} style={{ width: `${part}%` }} />
                    ))}
                </span>
                <span className="w-10 text-sm font-medium tabular-nums text-slate-900">{parts.available}&nbsp;%</span>
            </div>
        </Tip>
    );
}

/**
 * Teinte du Q : gris quand la personne n'est jamais connectée à ses files,
 * bleu 3CX quand elle l'est en permanence, et le mélange entre les deux.
 * L'intensité de la couleur EST la mesure — pas besoin d'une barre à côté.
 */
function couleurQ(part: number): string {
    const p = Math.min(100, Math.max(0, part)) / 100;
    const melange = (gris: number, bleu: number) => Math.round(gris + (bleu - gris) * p);
    return `rgb(${melange(148, 0)}, ${melange(163, 152)}, ${melange(184, 201)})`;
}

/**
 * La connexion aux files (l'icône Q du client 3CX), à part : c'est une
 * question différente de la disponibilité — on peut être disponible sans
 * être connecté à sa file, et l'inverse arrive tout autant.
 *
 * Un poste membre d'aucune équipe n'a rien à dire ici : ni Q, ni
 * pourcentage, un tiret. Le 3CX le déclare « connecté » comme les autres,
 * mais aucune file ne le sollicitera jamais — afficher 100 % serait un
 * chiffre juste qui ment.
 */
function CelluleFile({ collaborateur: c, jours }: { collaborateur: CollaborateurRow; jours: number }) {
    if (c.equipes.length === 0) return <span className="text-xs text-slate-400">—</span>;
    const recent = c.presence?.recent ?? null;
    const parts = recent ? partsPresence(recent) : null;
    if (!recent || !parts) {
        return (
            <Tip content={`Aucune heure de bureau observée sur ${jours} jours.`}>
                <span className="text-xs text-slate-400">—</span>
            </Tip>
        );
    }
    return (
        <Tip content={`Connecté aux files ${formatHeures(recent.queueSeconds)} sur ${formatHeures(recent.sampledSeconds)} de bureau observées.`} align="start">
            <div className="flex items-center gap-2">
                <span style={{ color: couleurQ(parts.queue) }}><QIcon className="h-4 w-4" /></span>
                <span className="w-10 text-sm tabular-nums text-slate-700">{parts.queue}&nbsp;%</span>
            </div>
        </Tip>
    );
}


/**
 * Préparer le compte : on choisit la nature, on lit ce que le compte aura,
 * on crée. À la première connexion Microsoft, la personne retrouve son
 * périmètre — sans appel, sans saisie, sans mot de passe.
 */
function PreparerCompteDialog({ serverId, collaborateur, onClose }: {
    serverId: string;
    collaborateur: CollaborateurRow | null;
    /** `true` quand un compte a été créé : la liste est à relire. */
    onClose: (cree: boolean) => void;
}) {
    const [role, setRole] = useState<RoleCompte | null>(null);
    const [envoi, setEnvoi] = useState(false);
    const [erreur, setErreur] = useState<string | null>(null);
    const [resultat, setResultat] = useState<{ email: string; equipes: number; equipesInconnues: string[] } | null>(null);
    const extension = collaborateur?.extension ?? null;

    // Chaque ouverture repart de zéro : rien ne doit rester d'un compte à l'autre.
    useEffect(() => { setRole(null); setEnvoi(false); setErreur(null); setResultat(null); }, [extension]);

    const creer = async () => {
        if (!collaborateur || !role) return;
        setEnvoi(true);
        setErreur(null);
        try {
            const res = await fetch("/api/admin/collaborateurs/compte", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serverId, extension: collaborateur.extension, role }),
            });
            const data = await res.json();
            if (!res.ok) setErreur(data.error || "Création du compte impossible");
            else setResultat({ email: data.email, equipes: data.equipes, equipesInconnues: data.equipesInconnues ?? [] });
        } catch {
            setErreur("Création du compte impossible");
        } finally {
            setEnvoi(false);
        }
    };

    return (
        <Dialog open={collaborateur !== null} onOpenChange={(o) => !o && onClose(resultat !== null)}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-3">
                        {collaborateur && <AvatarCollaborateur name={collaborateur.displayName} photoUrl={collaborateur.photoUrl} className="h-10 w-10 text-sm" />}
                        <span>Préparer le compte de {collaborateur?.displayName}</span>
                    </DialogTitle>
                    <DialogDescription>
                        {collaborateur?.email} · à sa première connexion Microsoft, le compte est reconnu par cet e-mail et son périmètre l&apos;attend.
                    </DialogDescription>
                </DialogHeader>

                {resultat ? (
                    <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                        <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" /> Compte créé pour {resultat.email}</p>
                        <p>Périmètre : {resultat.equipes} équipe{resultat.equipes > 1 ? "s" : ""}{resultat.equipes === 0 ? " — il ne verra rien tant qu'on ne lui en donne pas" : ""}.</p>
                        {resultat.equipesInconnues.length > 0 && (
                            <p className="text-amber-800">
                                Non posées, absentes du registre des files : {resultat.equipesInconnues.join(", ")}.
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            {ROLES_COMPTE.map((r) => (
                                <button
                                    key={r}
                                    type="button"
                                    onClick={() => setRole(r)}
                                    className={cn(
                                        "rounded-lg border p-3 text-left transition-colors",
                                        role === r ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "border-slate-200 hover:bg-slate-50",
                                    )}
                                >
                                    <p className="text-sm font-medium text-slate-900">{LIBELLES_ROLE_COMPTE[r]}</p>
                                    <p className="mt-0.5 text-xs text-slate-500">
                                        {r === "MANAGER" ? "Lit les statistiques de ses équipes." : "Lit ses propres statistiques."}
                                    </p>
                                </button>
                            ))}
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Ce que le compte aura</p>
                            <ul className="space-y-0.5 text-xs text-slate-700">
                                {DROITS_PAR_DEFAUT_LIBELLES.map((l) => <li key={l}>{l}</li>)}
                            </ul>
                            {collaborateur && (
                                <p className="mt-2 text-xs text-slate-500">
                                    {collaborateur.equipes.length > 0
                                        ? `Ses équipes aujourd'hui : ${collaborateur.equipes.map((e) => e.queueName).join(", ")}.`
                                        : "Membre d'aucune équipe aujourd'hui : le compte naîtra sans périmètre."}
                                </p>
                            )}
                        </div>
                        {erreur && <p className="text-sm text-red-700">{erreur}</p>}
                    </div>
                )}

                <DialogFooter>
                    {resultat ? (
                        <Button onClick={() => onClose(true)}>Fermer</Button>
                    ) : (
                        <>
                            <Button variant="outline" onClick={() => onClose(false)} disabled={envoi}>Annuler</Button>
                            <Button onClick={creer} disabled={!role || envoi}>{envoi ? "Création…" : "Créer le compte"}</Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
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

