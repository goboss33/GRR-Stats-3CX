"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { withPeriod } from "@/lib/url-state";
import {
    LayoutDashboard,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    Phone,
    FileText,
    BarChart3,
    Users,
    Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { SidebarProfileMenu } from "@/components/sidebar-profile-menu";

interface SidebarProps {
    userRole: string;
    user: {
        firstName: string | null | undefined;
        lastName: string | null | undefined;
    };
    authProvider: string;
    profilePicture?: string | null;
    signOutAction: () => Promise<void>;
}

interface NavSubItem {
    label: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
}

interface NavItem {
    label: string;
    href?: string;
    icon: React.ComponentType<{ className?: string }>;
    roles: string[];
    children?: NavSubItem[];
}

const navItems: NavItem[] = [
    {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        roles: ["ADMIN", "MODERATOR", "MANAGER"],
    },
    {
        label: "Logs d'appels",
        href: "/admin/logs",
        icon: FileText,
        roles: ["ADMIN", "MODERATOR", "MANAGER"],
    },
    {
        label: "Statistiques",
        icon: BarChart3,
        roles: ["ADMIN", "MODERATOR", "MANAGER"],
        children: [
            {
                label: "File d'attente",
                href: "/statistics-v2",
                icon: Users,
            },
            {
                label: "Extension / DDI",
                href: "/statistics-extension",
                icon: Hash,
            },
        ],
    },
];

export function Sidebar({ userRole, user, authProvider, profilePicture, signOutAction }: SidebarProps) {
    const pathname = usePathname();
    // La période voyage dans l'URL : les liens de navigation la transportent,
    // sans quoi passer des statistiques aux journaux repartirait sur le mois en
    // cours — au moment même où l'on veut garder le contexte.
    const searchParams = useSearchParams();
    const [collapsed, setCollapsed] = useState(false);
    const [expandedMenus, setExpandedMenus] = useState<string[]>(() => {
        const initial: string[] = [];
        navItems.forEach((item) => {
            if (item.children?.some((child) => pathname === child.href || pathname.startsWith(child.href))) {
                initial.push(item.label);
            }
        });
        return initial;
    });

    const filteredItems = navItems.filter((item) =>
        item.roles.includes(userRole)
    );

    const toggleMenu = (label: string) => {
        setExpandedMenus((prev) =>
            prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
        );
    };

    const isParentActive = (item: NavItem) => {
        if (item.href) {
            return pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
        }
        if (item.children) {
            return item.children.some(
                (child) => pathname === child.href || pathname.startsWith(child.href)
            );
        }
        return false;
    };

    const isMenuExpanded = (label: string) => expandedMenus.includes(label);

    return (
        <TooltipProvider delayDuration={0}>
            <aside
                className={cn(
                    "flex flex-col h-screen bg-slate-900 border-r border-slate-800 transition-all duration-300",
                    collapsed ? "w-16" : "w-64"
                )}
            >
                {/* Logo */}
                <div className="h-16 flex items-center px-4 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Phone className="h-5 w-5 text-white" />
                        </div>
                        {!collapsed && (
                            <span className="font-semibold text-white text-sm whitespace-nowrap">
                                Call Center Analytics
                            </span>
                        )}
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
                    {filteredItems.map((item) => {
                        const parentActive = isParentActive(item);
                        const menuExpanded = isMenuExpanded(item.label);

                        if (item.children) {
                            const parentContent = (
                                <button
                                    onClick={() => {
                                        if (collapsed) {
                                            setCollapsed(false);
                                            if (!menuExpanded) toggleMenu(item.label);
                                        } else {
                                            toggleMenu(item.label);
                                        }
                                    }}
                                    className={cn(
                                        "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 w-full text-left",
                                        parentActive
                                            ? "text-white bg-slate-800"
                                            : "text-slate-400 hover:text-white hover:bg-slate-800"
                                    )}
                                >
                                    <item.icon className="h-5 w-5 flex-shrink-0" />
                                    {!collapsed && (
                                        <>
                                            <span className="text-sm font-medium flex-1">{item.label}</span>
                                            <ChevronDown
                                                className={cn(
                                                    "h-4 w-4 transition-transform duration-200",
                                                    menuExpanded && "rotate-180"
                                                )}
                                            />
                                        </>
                                    )}
                                </button>
                            );

                            if (collapsed) {
                                return (
                                    <Tooltip key={item.label}>
                                        <TooltipTrigger asChild>{parentContent}</TooltipTrigger>
                                        <TooltipContent side="right" className="bg-slate-800 text-white border-slate-700">
                                            <div className="space-y-1">
                                                <p className="font-semibold text-xs text-slate-400 mb-2">{item.label}</p>
                                                {item.children.map((child) => {
                                                    const childActive = pathname === child.href || pathname.startsWith(child.href);
                                                    return (
                                                        <Link
                                                            key={child.href}
                                                            href={withPeriod(child.href, searchParams)}
                                                            className={cn(
                                                                "flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors",
                                                                childActive
                                                                    ? "bg-blue-600 text-white"
                                                                    : "text-slate-300 hover:text-white hover:bg-slate-700"
                                                            )}
                                                        >
                                                            <child.icon className="h-3 w-3" />
                                                            {child.label}
                                                        </Link>
                                                    );
                                                })}
                                            </div>
                                        </TooltipContent>
                                    </Tooltip>
                                );
                            }

                            return (
                                <div key={item.label}>
                                    {parentContent}
                                    {menuExpanded && (
                                        <div className="ml-4 mt-1 space-y-1 border-l border-slate-700 pl-3">
                                            {item.children.map((child) => {
                                                const childActive = pathname === child.href || pathname.startsWith(child.href);
                                                return (
                                                    <Link
                                                        key={child.href}
                                                        href={withPeriod(child.href, searchParams)}
                                                        className={cn(
                                                            "flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200",
                                                            childActive
                                                                ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30"
                                                                : "text-slate-400 hover:text-white hover:bg-slate-800"
                                                        )}
                                                    >
                                                        <child.icon className="h-4 w-4 flex-shrink-0" />
                                                        <span className="text-sm">{child.label}</span>
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        }

                        const isActive = item.href
                            ? pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
                            : false;

                        const linkContent = (
                            <Link
                                href={withPeriod(item.href!, searchParams)}
                                className={cn(
                                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                                    isActive
                                        ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30"
                                        : "text-slate-400 hover:text-white hover:bg-slate-800"
                                )}
                            >
                                <item.icon className="h-5 w-5 flex-shrink-0" />
                                {!collapsed && (
                                    <span className="text-sm font-medium">{item.label}</span>
                                )}
                            </Link>
                        );

                        if (collapsed) {
                            return (
                                <Tooltip key={item.href}>
                                    <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                                    <TooltipContent side="right" className="bg-slate-800 text-white border-slate-700">
                                        {item.label}
                                    </TooltipContent>
                                </Tooltip>
                            );
                        }

                        return <div key={item.href}>{linkContent}</div>;
                    })}
                </nav>

                {/* Profile Menu */}
                <div className="p-2 border-t border-slate-800">
                    <SidebarProfileMenu
                        user={user}
                        userRole={userRole}
                        authProvider={authProvider}
                        profilePicture={profilePicture}
                        collapsed={collapsed}
                        signOutAction={signOutAction}
                    />
                </div>

                {/* Collapse Button */}
                <div className="px-2 pb-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setCollapsed(!collapsed)}
                        className="w-full h-10 text-slate-400 hover:text-white hover:bg-slate-800"
                    >
                        {collapsed ? (
                            <ChevronRight className="h-5 w-5" />
                        ) : (
                            <ChevronLeft className="h-5 w-5" />
                        )}
                    </Button>
                </div>
            </aside>
        </TooltipProvider>
    );
}
