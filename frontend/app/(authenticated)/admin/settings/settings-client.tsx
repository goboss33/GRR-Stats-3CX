"use client";

import { useState } from "react";
import { Users, Phone, AlertCircle, KeyRound, Settings, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PersonalInfoTab } from "./tabs/personal-info-tab";
import { UsersTab } from "./tabs/users-tab";
import { QueuesTab } from "./tabs/queues-tab";
import { DiagnosticTab } from "./tabs/diagnostic-tab";
import { TenantTab } from "./tabs/tenant-tab";
import { BusinessRulesTab } from "./tabs/business-rules-tab";
import { ApiKeysTab } from "./tabs/api-keys-tab";

type TabId = "personal" | "users" | "queues" | "business-rules" | "api-keys" | "tenant" | "diagnostic";

// Rôles autorisés par onglet (cf. PRD droits d'accès §4.1).
// ⚠️ Ce filtrage est une commodité d'affichage : la sécurité réelle est assurée
// par les gardes serveur des routes API correspondantes.
const ALL_ROLES = ["ADMIN", "MODERATOR", "MANAGER", "AGENT"];

const tabs: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }>; roles: string[] }[] = [
    { id: "personal", label: "Informations personnelles", icon: Users, roles: ALL_ROLES },
    { id: "users", label: "Utilisateurs", icon: Users, roles: ["ADMIN"] },
    { id: "queues", label: "Files d'attente", icon: Phone, roles: ["ADMIN"] },
    { id: "business-rules", label: "Règles métier", icon: Settings, roles: ["ADMIN"] },
    { id: "api-keys", label: "Clés API", icon: KeyRound, roles: ["ADMIN", "MODERATOR"] },
    { id: "tenant", label: "Tenant", icon: Building2, roles: ["ADMIN"] },
    { id: "diagnostic", label: "Diagnostic", icon: AlertCircle, roles: ["ADMIN"] },
];

export default function SettingsPage({ userRole }: { userRole: string }) {
    const visibleTabs = tabs.filter((tab) => tab.roles.includes(userRole));
    const [activeTab, setActiveTab] = useState<TabId>("personal");

    const renderTabContent = () => {
        // Ceinture et bretelles : un onglet non autorisé n'affiche rien.
        if (!visibleTabs.some((tab) => tab.id === activeTab)) return null;

        switch (activeTab) {
            case "personal": return <PersonalInfoTab />;
            case "users": return <UsersTab />;
            case "queues": return <QueuesTab />;
            case "business-rules": return <BusinessRulesTab />;
            case "api-keys": return <ApiKeysTab />;
            case "tenant": return <TenantTab />;
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
                    {visibleTabs.map((tab) => {
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
