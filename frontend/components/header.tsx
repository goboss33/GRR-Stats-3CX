"use client";

import { usePathname } from "next/navigation";
import { DateRangePicker } from "@/components/date-range-picker";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
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

/**
 * Grise un contrôle de contexte inapplicable, sans le cacher.
 *
 * Le pointer-events-none vit sur un conteneur INTÉRIEUR : le wrapper survolé
 * reste sensible à la souris, condition pour que l'infobulle s'ouvre (l'ancien
 * title sur l'élément insensible ne pouvait jamais s'afficher).
 */
function ContextControl({ applies, title, children }: {
    applies: boolean; title: string; children: React.ReactNode;
}) {
    if (applies) return <>{children}</>;
    return (
        <Tip content={title}>
            <div className="opacity-40" aria-disabled="true">
                <div className="pointer-events-none">{children}</div>
            </div>
        </Tip>
    );
}

/**
 * Sélecteur de période, unique pour toute l'application. Il ne détient rien :
 * il écrit l'URL, et chaque écran relit.
 */
function HeaderPeriodPicker() {
    const { startDate, endDate, setPeriod } = useUrlPeriod();
    return (
        // Le sélecteur cède du terrain APRÈS la recherche (shrink-[0.5]),
        // jusqu'à 200px — le texte tronqué garde la période lisible.
        <DateRangePicker
            dateRange={{ startDate, endDate }}
            onDateRangeChange={setPeriod}
            displayFormat="short"
            className="w-[280px] min-w-[200px] shrink-[0.5] max-[999px]:order-6"
            triggerClassName="w-full"
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
        // Le span intermédiaire garde l'infobulle vivante quand le bouton est
        // désactivé (un élément disabled n'émet pas d'événements de survol).
        <Tip content={refresh ? "Actualiser les données" : "Sans effet sur cet écran"}>
            <span className="inline-flex max-[999px]:order-3">
                <Button
                    variant="outline"
                    size="icon"
                    onClick={() => refresh?.()}
                    disabled={!refresh || refreshing}
                    className="bg-white shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-40"
                >
                    <RefreshCw className={`h-4 w-4 text-slate-600 ${refreshing ? "animate-spin" : ""}`} />
                </Button>
            </span>
        </Tip>
    );
}

export function Header({ userName }: { userName: string }) {
    const pathname = usePathname();
    const title = getPageTitle(pathname);

    // Adaptation séquentielle à la largeur de la fenêtre (de la plus douce à
    // la plus radicale) : 1) bloc titre masqué < 1400px ; 2) la recherche se
    // compresse jusqu'à 200px ; 3) le sélecteur de dates la suit jusqu'à
    // 200px ; 4) le toggle passe en icônes (1000–1129px) ; 5) sous 1000px,
    // deux lignes : toggle (texte) + actualiser au-dessus, recherche et dates
    // en dessous (classes order-/flex-wrap max-[999px]).
    return (
        <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-6 max-[999px]:h-auto max-[999px]:py-2">
            {/* Premier sacrifice quand la place manque : tout le bloc titre +
                bienvenue disparaît sous 1400px de fenêtre (la page courante
                reste identifiable via la sidebar). Quand il est visible, le
                bloc ne se compresse pas : c'est la recherche, à droite, qui
                absorbe le rétrécissement. */}
            <div className="hidden shrink-0 min-[1400px]:block">
                <h1 className="text-lg font-semibold text-slate-900 whitespace-nowrap">
                    {title}
                </h1>
                <p className="text-sm text-slate-500">
                    Bienvenue, {userName}
                </p>
            </div>

            {/* min-w-0 est vital ici AUSSI : ce groupe est un item flex du
                header ; sans lui, min-width:auto l'empêche de passer sous la
                largeur intrinsèque de son contenu — la recherche et les dates
                ne recevraient jamais d'espace négatif à absorber et le bouton
                de fin (actualiser) déborderait hors écran. */}
            <div className="flex items-center gap-4 min-w-0 max-[999px]:w-full max-[999px]:flex-wrap">
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
                {/* Saut de ligne forcé en mode 2 lignes : cet item pleine
                    largeur pousse la recherche et les dates sur la seconde
                    ligne (order : toggle 1, actualiser 3, puis recherche 5 et
                    dates 6). */}
                <div aria-hidden className="hidden h-0 basis-full max-[999px]:order-4 max-[999px]:block" />
            </div>
        </header>
    );
}
