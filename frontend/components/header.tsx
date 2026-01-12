import { auth, signOut } from "@/lib/auth";
import { LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Role badge colors
const roleBadgeColors: Record<string, string> = {
    ADMIN: "bg-red-500/20 text-red-400 border-red-500/30",
    SUPERUSER: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    USER: "bg-green-500/20 text-green-400 border-green-500/30",
};

// Role labels
const roleLabels: Record<string, string> = {
    ADMIN: "Administrateur",
    SUPERUSER: "Manager",
    USER: "Utilisateur",
};

export async function Header() {
    // Using auth() for server-side session access (NextAuth v5)
    const session = await auth();
    const user = session?.user;

    const getInitials = (name: string | null | undefined) => {
        if (!name) return "U";
        return name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);
    };

    return (
        <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-6">
            <div>
                <h1 className="text-lg font-semibold text-slate-900">
                    Tableau de bord
                </h1>
                <p className="text-sm text-slate-500">
                    Bienvenue, {user?.name || "Utilisateur"}
                </p>
            </div>

            <div className="flex items-center gap-4">
                {/* Role Badge */}
                {user?.role && (
                    <span
                        className={`px-3 py-1 text-xs font-medium rounded-full border ${roleBadgeColors[user.role] || roleBadgeColors.USER
                            }`}
                    >
                        {roleLabels[user.role] || user.role}
                    </span>
                )}

                {/* User Dropdown */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            className="relative h-10 w-10 rounded-full"
                        >
                            <Avatar className="h-10 w-10">
                                <AvatarFallback className="bg-blue-100 text-blue-600 font-medium">
                                    {getInitials(user?.name)}
                                </AvatarFallback>
                            </Avatar>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56" align="end">
                        <DropdownMenuLabel className="font-normal">
                            <div className="flex flex-col space-y-1">
                                <p className="text-sm font-medium leading-none">
                                    {user?.name || "Utilisateur"}
                                </p>
                                <p className="text-xs leading-none text-muted-foreground">
                                    {user?.email}
                                </p>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                            <div className="flex items-center gap-2 text-slate-600">
                                <User className="h-4 w-4" />
                                <span>Mon profil</span>
                            </div>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <form
                            action={async () => {
                                "use server";
                                await signOut({ redirectTo: "/login" });
                            }}
                        >
                            <DropdownMenuItem asChild>
                                <button
                                    type="submit"
                                    className="w-full flex items-center gap-2 text-red-600 cursor-pointer"
                                >
                                    <LogOut className="h-4 w-4" />
                                    <span>Déconnexion</span>
                                </button>
                            </DropdownMenuItem>
                        </form>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    );
}
