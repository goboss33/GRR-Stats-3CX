"use client";

import { LogOut } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

export function LogoutMenuItem({
    signOutAction,
}: {
    signOutAction: () => Promise<void>;
}) {
    return (
        <DropdownMenuItem
            className="flex items-center gap-2 text-red-600 cursor-pointer"
            onSelect={async (e) => {
                e.preventDefault();
                await signOutAction();
            }}
        >
            <LogOut className="h-4 w-4" />
            <span>Déconnexion</span>
        </DropdownMenuItem>
    );
}
