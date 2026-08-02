"use client";

import { usePathname } from "next/navigation";
import { DateRangePicker } from "@/components/date-range-picker";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OriginToggle } from "@/components/stats-v2/origin-toggle";
import { HeaderQueueSearch } from "@/components/header-queue-search";
import { useHeaderScope } from "@/components/header-scope";
import { useUrlPeriod, useUrlOrigin } from "@/lib/url-state";

const pageTitleMap: Record<string, string> = {
    "/dashboard": "Tableau de bord",
    "/admin/logs": "Logs d'appels",
    "/admin/settings": "Paramètres",
    "/documentation": "Documentation",
    "/statistics-v2": "Mes équipes",
    "/statistics-extension": "Extension / DDI",
};

function getPageTitle(pathname: string): string {
    const exact = pageTitleMap[pathname];
    if (exact) return exact;
    if (pathname.startsWith("/admin/logs")) return "Logs d'appels";
    if (pathname.startsWith("/admin/settings")) return "Paramètres";
    if (pathname.startsWith("/documentation")) return "Documentation";
    if (pathname.startsWith("/statistics-extension")) return "Extension / DDI";
    if (pathname.startsWith("/statistics")) return "Mes équipes";
    return "Tableau de bord";
}

/**
 * Applicabilité des contrôles de contexte, par écran.
 *
 * Un contrôle global ignoré en silence serait un mensonge visuel : sur les
 * écrans où le contexte ne s'applique pas, il reste VISIBLE mais grisé, avec
 * une infobulle qui le dit. (L'écran extension/DDI mélange les deux directions
 * par ligne : la provenance n'y filtrerait proprement que la moitié entrante.)
 */
function originApplies(pathname: string): boolean {
    return pathname.startsWith("/dashboard")
        || pathname.startsWith("/statistics-v2")
        || pathname.startsWith("/admin/logs");
}

function periodApplies(pathname: string): boolean {
    return originApplies(pathname) || pathname.startsWith("/statistics-extension");
}

/** Grise un contrôle de contexte inapplicable, sans le cacher. */
function ContextControl({ applies, title, children }: {
    applies: boolean; title: string; children: React.ReactNode;
}) {
    if (applies) return <>{children}</>;
    return (
        <div className="pointer-events-none opacity-40" title={title} aria-disabled="true">
            {children}
        </div>
    );
}

/**
 * Sélecteur de période, unique pour toute l'application. Il ne détient rien :
 * il écrit l'URL, et chaque écran relit.
 */
function HeaderPeriodPicker() {
    const { startDate, endDate, setPeriod } = useUrlPeriod();
    return (
        <DateRangePicker
            dateRange={{ startDate, endDate }}
            onDateRangeChange={setPeriod}
            displayFormat="short"
        />
    );
}

/**
 * Toggle de provenance, unique lui aussi : il écrit l'URL (`origin`), le
 * tableau de bord, les statistiques de groupe et les journaux relisent. Les
 * variantes pas encore préchargées par la page affichée sont grisées avec un
 * spinner (remontées via HeaderScopeProvider).
 */
function HeaderOriginToggle() {
    const { origin, setOrigin } = useUrlOrigin();
    const { loadedOrigins } = useHeaderScope();
    return (
        <OriginToggle
            value={origin}
            onChange={setOrigin}
            loadedOrigins={loadedOrigins ?? undefined}
        />
    );
}

/** Bouton « Actualiser » : relaie l'action déclarée par la page affichée. */
function HeaderRefreshButton() {
    const { refresh, refreshing } = useHeaderScope();
    return (
        <Button
            variant="outline"
            size="icon"
            onClick={() => refresh?.()}
            disabled={!refresh || refreshing}
            title={refresh ? "Actualiser les données" : "Sans effet sur cet écran"}
            className="bg-white shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-40"
        >
            <RefreshCw className={`h-4 w-4 text-slate-600 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
    );
}

export function Header({ userName }: { userName: string }) {
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
                <HeaderQueueSearch />
                <ContextControl
                    applies={originApplies(pathname)}
                    title="Sans effet sur cet écran"
                >
                    <HeaderOriginToggle />
                </ContextControl>
                <ContextControl
                    applies={periodApplies(pathname)}
                    title="Sans effet sur cet écran"
                >
                    <HeaderPeriodPicker />
                </ContextControl>

                <HeaderRefreshButton />
            </div>
        </header>
    );
}
