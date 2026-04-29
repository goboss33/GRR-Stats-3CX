"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, Settings, LogOut, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const roleLabels: Record<string, string> = {
    ADMIN: "Administrateur",
    SUPERUSER: "Manager",
    USER: "Utilisateur",
};

interface SidebarProfileMenuProps {
    user: {
        firstName: string | null | undefined;
        lastName: string | null | undefined;
    };
    userRole: string;
    collapsed: boolean;
    signOutAction: () => Promise<void>;
}

function getInitials(firstName: string | null | undefined, lastName: string | null | undefined): string {
    const f = (firstName || "").trim();
    const l = (lastName || "").trim();
    if (f && l) return `${f[0].toUpperCase()}${l[0].toUpperCase()}`;
    if (f) return f[0].toUpperCase();
    if (l) return l[0].toUpperCase();
    return "U";
}

function getFullName(firstName: string | null | undefined, lastName: string | null | undefined): string {
    const parts = [firstName, lastName].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : "Utilisateur";
}

export function SidebarProfileMenu({ user, userRole, collapsed, signOutAction }: SidebarProfileMenuProps) {
    const [open, setOpen] = useState(false);
    const [signingOut, setSigningOut] = useState(false);

    const handleSignOut = async () => {
        setSigningOut(true);
        await signOutAction();
    };

    const fullName = getFullName(user.firstName, user.lastName);
    const roleLabel = roleLabels[userRole] || userRole;

    return (
        <>
            {open && (
                <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            )}

            <button
                onClick={() => setOpen(!open)}
                className={cn(
                    "w-full flex items-center gap-3 p-3 hover:bg-slate-800 transition-colors rounded-lg",
                    collapsed && "justify-center px-2"
                )}
            >
                <Avatar className="h-8 w-8 flex-shrink-0">
                    <AvatarFallback className="bg-blue-600 text-white text-xs font-medium">
                        {getInitials(user.firstName, user.lastName)}
                    </AvatarFallback>
                </Avatar>
                {!collapsed && (
                    <div className="flex-1 min-w-0 text-left">
                        <p className="text-sm font-medium text-white truncate">{fullName}</p>
                        <p className="text-xs text-slate-400 truncate">{roleLabel}</p>
                    </div>
                )}
            </button>

            {open && (
                <div className={cn(
                    "fixed bottom-16 left-64 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden",
                    collapsed && "left-16"
                )}>
                    <div className="p-3 border-b border-slate-700">
                        <p className="text-sm font-medium text-white">{fullName}</p>
                        <p className="text-xs text-slate-400 truncate">{roleLabel}</p>
                    </div>
                    <div className="py-1">
                        <Link
                            href="/documentation"
                            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                            onClick={() => setOpen(false)}
                        >
                            <BookOpen className="h-4 w-4 flex-shrink-0" />
                            <span>Documentation</span>
                        </Link>
                        <Link
                            href="/admin/settings"
                            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
                            onClick={() => setOpen(false)}
                        >
                            <Settings className="h-4 w-4 flex-shrink-0" />
                            <span>Paramètres</span>
                        </Link>
                        <button
                            onClick={handleSignOut}
                            disabled={signingOut}
                            className={cn(
                                "flex items-center gap-2 px-3 py-2 text-sm transition-colors w-full",
                                signingOut
                                    ? "text-slate-500 cursor-wait"
                                    : "text-red-400 hover:bg-slate-700 hover:text-red-300"
                            )}
                        >
                            {signingOut ? (
                                <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                            ) : (
                                <LogOut className="h-4 w-4 flex-shrink-0" />
                            )}
                            <span>{signingOut ? "Déconnexion..." : "Déconnexion"}</span>
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
