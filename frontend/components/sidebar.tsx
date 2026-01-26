"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    LayoutDashboard,
    Settings,
    ChevronLeft,
    ChevronRight,
    Phone,
    FileText,
    Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface SidebarProps {
    userRole: string;
}

interface NavItem {
    label: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    roles: string[];
}

const navItems: NavItem[] = [
    {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        roles: ["ADMIN", "SUPERUSER", "USER"],
    },

    {
        label: "Logs d'appels",
        href: "/admin/logs",
        icon: FileText,
        roles: ["ADMIN"],
    },
    {
        label: "Files d'attente",
        href: "/admin/queues",
        icon: Users,
        roles: ["ADMIN"],
    },
    {
        label: "Paramètres",
        href: "/admin/settings",
        icon: Settings,
        roles: ["ADMIN"],
    },
];

export function Sidebar({ userRole }: SidebarProps) {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);

    const filteredItems = navItems.filter((item) =>
        item.roles.includes(userRole)
    );

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
                        const isActive =
                            pathname === item.href ||
                            (item.href !== "/dashboard" && pathname.startsWith(item.href));

                        const linkContent = (
                            <Link
                                href={item.href}
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

                {/* Collapse Button */}
                <div className="p-2 border-t border-slate-800">
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
