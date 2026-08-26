"use client";

import { useState } from "react";
import { Users, Phone, KeyRound, Settings, Building2, Bell, BookOpenCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { PersonalInfoTab } from "./tabs/personal-info-tab";
import { UsersTab } from "./tabs/users-tab";
import { QueuesTab } from "./tabs/queues-tab";
import { TenantTab } from "./tabs/tenant-tab";
import { BusinessRulesTab } from "./tabs/business-rules-tab";
import { ApiKeysTab } from "./tabs/api-keys-tab";
import { AlertsTab } from "./tabs/alerts-tab";
import { XapiJournalTab } from "./tabs/xapi-journal-tab";

type SectionId = "personal" | "users" | "queues" | "business-rules" | "alerts" | "api-keys" | "tenant" | "xapi-journal";

// Rôles autorisés par section (cf. PRD droits d'accès §4.1).
// ⚠️ Ce filtrage est une commodité d'affichage : la sécurité réelle est assurée
// par les gardes serveur des routes API correspondantes.
const ALL_ROLES = ["ADMIN", "MODERATOR", "MANAGER", "AGENT"];

const sections: { id: SectionId; label: string; icon: React.ComponentType<{ className?: string }>; roles: string[] }[] = [
    { id: "personal", label: "Informations personnelles", icon: Users, roles: ALL_ROLES },
    { id: "users", label: "Utilisateurs", icon: Users, roles: ["ADMIN"] },
    { id: "queues", label: "Files d'attente", icon: Phone, roles: ["ADMIN"] },
    { id: "business-rules", label: "Règles métier", icon: Settings, roles: ["ADMIN"] },
    { id: "alerts", label: "Alertes", icon: Bell, roles: ["ADMIN"] },
    { id: "api-keys", label: "Clés API", icon: KeyRound, roles: ["ADMIN", "MODERATOR"] },
    { id: "tenant", label: "Tenant", icon: Building2, roles: ["ADMIN"] },
    { id: "xapi-journal", label: "Journal des équipes (XAPI)", icon: BookOpenCheck, roles: ["ADMIN"] },
];

export default function SettingsPage({ userRole }: { userRole: string }) {
    const visibleSections = sections.filter((section) => section.roles.includes(userRole));
    const [activeSection, setActiveSection] = useState<SectionId>("personal");

    const renderSection = () => {
        // Ceinture et bretelles : une section non autorisée n'affiche rien.
        if (!visibleSections.some((section) => section.id === activeSection)) return null;

        switch (activeSection) {
            case "personal": return <PersonalInfoTab />;
            case "users": return <UsersTab />;
            case "queues": return <QueuesTab />;
            case "business-rules": return <BusinessRulesTab />;
            case "alerts": return <AlertsTab />;
            case "api-keys": return <ApiKeysTab />;
            case "tenant": return <TenantTab />;
            case "xapi-journal": return <XapiJournalTab />;
        }
    };

    return (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            {/* MENU LATÉRAL SECONDAIRE — remplace la rangée d'onglets : les
                intitulés sont longs et nombreux, ils débordaient en scroll
                horizontal. En colonne, ils se lisent d'un coup d'œil.
                Panneau clair : la barre principale de l'app est sombre, ce
                second niveau ne doit pas lui faire concurrence.
                Sur petit écran il redevient une rangée défilante — une pile
                de huit entrées repousserait le contenu hors de vue. */}
            <nav aria-label="Sections des réglages" className="lg:sticky lg:top-0 lg:w-64 lg:flex-shrink-0">
                <ul className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 lg:flex-col lg:gap-0.5 lg:overflow-visible">
                    {visibleSections.map((section) => {
                        const Icon = section.icon;
                        const active = activeSection === section.id;
                        return (
                            <li key={section.id} className="lg:w-full">
                                <button
                                    onClick={() => setActiveSection(section.id)}
                                    aria-current={active ? "page" : undefined}
                                    className={cn(
                                        "flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors lg:whitespace-normal",
                                        active
                                            ? "bg-blue-50 font-medium text-blue-700"
                                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                                    )}
                                >
                                    <Icon className={cn("h-4 w-4 flex-shrink-0", active ? "text-blue-600" : "text-slate-400")} />
                                    {section.label}
                                </button>
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
