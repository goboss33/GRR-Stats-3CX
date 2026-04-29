"use client";

import { usePathname } from "next/navigation";

const roleBadgeColors: Record<string, string> = {
    ADMIN: "bg-red-500/20 text-red-400 border-red-500/30",
    SUPERUSER: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    USER: "bg-green-500/20 text-green-400 border-green-500/30",
};

const roleLabels: Record<string, string> = {
    ADMIN: "Administrateur",
    SUPERUSER: "Manager",
    USER: "Utilisateur",
};

const pageTitleMap: Record<string, string> = {
    "/dashboard": "Tableau de bord",
    "/admin/logs": "Logs d'appels",
    "/admin/settings": "Paramètres",
    "/documentation": "Documentation",
    "/statistics": "Statistiques",
};

function getPageTitle(pathname: string): string {
    const exact = pageTitleMap[pathname];
    if (exact) return exact;
    if (pathname.startsWith("/admin/logs")) return "Logs d'appels";
    if (pathname.startsWith("/admin/settings")) return "Paramètres";
    if (pathname.startsWith("/documentation")) return "Documentation";
    if (pathname.startsWith("/statistics")) return "Statistiques";
    return "Tableau de bord";
}

export function Header({ userRole, userName }: { userRole: string; userName: string }) {
    const pathname = usePathname();
    const title = getPageTitle(pathname);

    return (
        <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-6">
            <div>
                <h1 className="text-lg font-semibold text-slate-900">
                    {title}
                </h1>
                <p className="text-sm text-slate-500">
                    Bienvenue, {userName}
                </p>
            </div>

            <div className="flex items-center gap-4">
                {userRole && (
                    <span
                        className={`px-3 py-1 text-xs font-medium rounded-full border ${roleBadgeColors[userRole] || roleBadgeColors.USER
                            }`}
                    >
                        {roleLabels[userRole] || userRole}
                    </span>
                )}
            </div>
        </header>
    );
}
