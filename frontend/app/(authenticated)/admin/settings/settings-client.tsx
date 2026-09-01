"use client";

import { useState } from "react";
import { Users, Phone, KeyRound, Settings, Building2, Bell, BookOpenCheck, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { PersonalInfoTab } from "./tabs/personal-info-tab";
import { UsersTab } from "./tabs/users-tab";
import { QueuesTab } from "./tabs/queues-tab";
import { TenantTab } from "./tabs/tenant-tab";
import { BusinessRulesTab } from "./tabs/business-rules-tab";
import { ApiKeysTab } from "./tabs/api-keys-tab";
import { AlertsTab } from "./tabs/alerts-tab";
import { XapiJournalTab } from "./tabs/xapi-journal-tab";

type SectionId =
    | "personal" | "users"
    | "queues-registre" | "queues-journal"
    | "business-rules" | "alerts" | "api-keys" | "tenant";

// Rôles autorisés par section (cf. PRD droits d'accès §4.1).
// ⚠️ Ce filtrage est une commodité d'affichage : la sécurité réelle est assurée
// par les gardes serveur des routes API correspondantes.
const ALL_ROLES = ["ADMIN", "MODERATOR", "MANAGER", "AGENT"];

type Icone = React.ComponentType<{ className?: string }>;

/**
 * Le menu accepte DEUX niveaux. Un parent n'est pas cliquable : il nomme un
 * sujet, ses enfants sont les écrans. Les files d'attente étaient dispersées
 * entre deux entrées éloignées (« Files d'attente » et « Journal des équipes »)
 * alors qu'elles parlent du même objet vu par deux sources — les réunir rend
 * cette dualité lisible au lieu de la cacher.
 */
type Entree =
    | { id: SectionId; label: string; icon: Icone; roles: string[] }
    | { label: string; icon: Icone; roles: string[]; enfants: { id: SectionId; label: string; icon: Icone }[] };

const sections: Entree[] = [
    { id: "personal", label: "Informations personnelles", icon: Users, roles: ALL_ROLES },
    { id: "users", label: "Utilisateurs", icon: Users, roles: ["ADMIN"] },
    {
        label: "Files d'attente", icon: Phone, roles: ["ADMIN"],
        enfants: [
            { id: "queues-registre", label: "Registre (CDR)", icon: Database },
            { id: "queues-journal", label: "Journal (XAPI)", icon: BookOpenCheck },
        ],
    },
    { id: "business-rules", label: "Règles métier", icon: Settings, roles: ["ADMIN"] },
    { id: "alerts", label: "Alertes", icon: Bell, roles: ["ADMIN"] },
    { id: "api-keys", label: "Clés API", icon: KeyRound, roles: ["ADMIN", "MODERATOR"] },
    { id: "tenant", label: "Tenant", icon: Building2, roles: ["ADMIN"] },
];

export default function SettingsPage({ userRole }: { userRole: string }) {
    const visibles = sections.filter((s) => s.roles.includes(userRole));
    const idsAutorises = new Set<SectionId>(
        visibles.flatMap((s) => ("enfants" in s ? s.enfants.map((e) => e.id) : [s.id])),
    );
    const [activeSection, setActiveSection] = useState<SectionId>("personal");

    const renderSection = () => {
        // Ceinture et bretelles : une section non autorisée n'affiche rien.
        if (!idsAutorises.has(activeSection)) return null;

        switch (activeSection) {
            case "personal": return <PersonalInfoTab />;
            case "users": return <UsersTab />;
            case "queues-registre": return <QueuesTab />;
            case "queues-journal": return <XapiJournalTab />;
            case "business-rules": return <BusinessRulesTab />;
            case "alerts": return <AlertsTab />;
            case "api-keys": return <ApiKeysTab />;
            case "tenant": return <TenantTab />;
        }
    };

    const bouton = (id: SectionId, label: string, Icon: Icone, enfant: boolean) => {
        const active = activeSection === id;
        return (
            <button
                onClick={() => setActiveSection(id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                    "flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors lg:whitespace-normal",
                    active
                        ? "bg-blue-50 font-medium text-blue-700"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                )}
            >
                <Icon className={cn(
                    "flex-shrink-0",
                    enfant ? "h-3.5 w-3.5" : "h-4 w-4",
                    active ? "text-blue-600" : "text-slate-400",
                )} />
                {label}
            </button>
        );
    };

    return (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            {/* MENU LATÉRAL SECONDAIRE — remplace la rangée d'onglets : les
                intitulés sont longs et nombreux, ils débordaient en scroll
                horizontal. En colonne, ils se lisent d'un coup d'œil.
                Panneau clair : la barre principale de l'app est sombre, ce
                second niveau ne doit pas lui faire concurrence.
                Sur petit écran il redevient une rangée défilante — une pile
                d'entrées repousserait le contenu hors de vue. */}
            <nav aria-label="Sections des réglages" className="lg:sticky lg:top-0 lg:w-64 lg:flex-shrink-0">
                <ul className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 lg:flex-col lg:gap-0.5 lg:overflow-visible">
                    {visibles.map((section) => {
                        if (!("enfants" in section)) {
                            return (
                                <li key={section.id} className="lg:w-full">
                                    {bouton(section.id, section.label, section.icon, false)}
                                </li>
                            );
                        }
                        const Icon = section.icon;
                        return (
                            <li key={section.label} className="lg:w-full">
                                {/* Intitulé de groupe : il nomme, il ne navigue pas.
                                    Sous lg, les enfants s'alignent à la suite — un
                                    parent inerte dans une rangée défilante n'aurait
                                    aucun sens, il devient alors un simple séparateur. */}
                                <p className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-900">
                                    <Icon className="h-4 w-4 flex-shrink-0 text-slate-400" />
                                    {section.label}
                                </p>
                                <ul className="flex gap-1 lg:ml-3 lg:flex-col lg:gap-0.5 lg:border-l lg:border-slate-200 lg:pl-2">
                                    {section.enfants.map((enfant) => (
                                        <li key={enfant.id} className="lg:w-full">
                                            {bouton(enfant.id, enfant.label, enfant.icon, true)}
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            {/* min-w-0 : sans lui, un tableau large de section élargirait la
                colonne au-delà de la fenêtre au lieu de défiler chez lui. */}
            <div className="min-w-0 flex-1">
                {renderSection()}
            </div>
        </div>
    );
}
