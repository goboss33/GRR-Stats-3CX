"use client";

import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Un conteneur à défilement horizontal qu'on peut aussi faire glisser à la
 * souris, clic maintenu — comme une carte. Un simple clic reste un clic : ce
 * n'est qu'après quelques pixels de déplacement que le geste devient un
 * glissement, et le clic qui le termine est alors avalé pour ne pas ouvrir la
 * ligne sous le pointeur. Sans débordement horizontal, le composant ne fait
 * rien du tout : la sélection de texte reste celle du navigateur. Au doigt,
 * le défilement natif suffit déjà.
 */
const SEUIL_PX = 5;
const INTERACTIFS = "button, a, input, select, textarea, [role='checkbox'], [role='switch'], [role='combobox'], [contenteditable]";

export function ZoneDefilable({ className, children }: { className?: string; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    const geste = useRef<{ x: number; scroll: number; bouge: boolean } | null>(null);

    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        const el = ref.current;
        if (!el || e.button !== 0 || e.pointerType !== "mouse") return;
        if (el.scrollWidth <= el.clientWidth) return;
        if ((e.target as HTMLElement).closest(INTERACTIFS)) return;
        geste.current = { x: e.clientX, scroll: el.scrollLeft, bouge: false };

        const bouger = (ev: PointerEvent) => {
            const g = geste.current;
            if (!g) return;
            const dx = ev.clientX - g.x;
            if (!g.bouge && Math.abs(dx) < SEUIL_PX) return;
            if (!g.bouge) {
                g.bouge = true;
                el.classList.add("cursor-grabbing", "select-none");
            }
            el.scrollLeft = g.scroll - dx;
            ev.preventDefault();
        };
        const lacher = () => {
            window.removeEventListener("pointermove", bouger);
            window.removeEventListener("pointerup", lacher);
            window.removeEventListener("pointercancel", lacher);
            const g = geste.current;
            geste.current = null;
            el.classList.remove("cursor-grabbing", "select-none");
            if (g?.bouge) {
                // Le clic qui clôt un glissement n'est pas un clic : on l'avale
                // avant qu'il n'atteigne la ligne.
                const avaler = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
                el.addEventListener("click", avaler, { capture: true, once: true });
                window.setTimeout(() => el.removeEventListener("click", avaler, { capture: true }), 0);
            }
        };
        window.addEventListener("pointermove", bouger);
        window.addEventListener("pointerup", lacher);
        window.addEventListener("pointercancel", lacher);
    };

    return (
        <div ref={ref} onPointerDown={onPointerDown} className={cn("overflow-x-auto", className)}>
            {children}
        </div>
    );
}
