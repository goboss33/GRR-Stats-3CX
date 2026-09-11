"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ETAPES, placerInfobulle, type Visite } from "@/services/domain/visite-guidee";

/**
 * VISITE GUIDÉE — le moteur (septembre 2026).
 *
 * Une visite par écran, jouée à sa première ouverture. Chaque étape désigne
 * un élément de la page par son ancre `data-visite="…"` : le reste de
 * l'écran disparaît sous un voile foncé, l'élément reste tel qu'il est, et
 * une infobulle l'explique avec « Suivant » et « Passer la visite ».
 *
 * Les pages chargent leurs données après coup : une ancre absente est
 * attendue quelques secondes, puis l'étape est sautée. Une visite dont
 * aucune étape n'a pu être montrée (écran vide, périmètre absent) n'est PAS
 * marquée vue : elle se jouera la prochaine fois. Terminer et passer, en
 * revanche, valent tous deux « vue » — on ne relance jamais quelqu'un qui a
 * dit non.
 */

const MARGE_CIBLE = 6;
const LARGEUR_INFOBULLE = 340;
const ATTENTE_ANCRE_MS = 200;
const ESSAIS_ANCRE_MAX = 30;
/** Le voile : foncé et presque opaque, pour ne laisser voir que l'élément visé. */
const VOILE = "rgba(15, 23, 42, 0.9)";

function ancreDe(nom: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-visite="${nom}"]`);
}

export function VisiteGuidee({ visite }: { visite: Visite }) {
    const etapes = ETAPES[visite];
    const [actif, setActif] = useState(false);
    const [index, setIndex] = useState(0);
    const [cible, setCible] = useState<HTMLElement | null>(null);
    const [rect, setRect] = useState<DOMRect | null>(null);
    const [boite, setBoite] = useState({ width: LARGEUR_INFOBULLE, height: 160 });
    const [fenetre, setFenetre] = useState({ width: 1280, height: 800 });
    const montrees = useRef(0);
    const infobulleRef = useRef<HTMLDivElement>(null);

    // Faut-il la jouer ? Une réponse en doute vaut non : l'écran d'abord.
    useEffect(() => {
        let annule = false;
        fetch(`/api/onboarding?visite=${visite}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!annule && d?.pending) { montrees.current = 0; setIndex(0); setActif(true); } })
            .catch(() => {});
        return () => { annule = true; };
    }, [visite]);

    const clore = useCallback(() => {
        setActif(false);
        setCible(null);
        setRect(null);
        if (montrees.current > 0) {
            void fetch("/api/onboarding", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ visite }),
            }).catch(() => {});
        }
    }, [visite]);

    // L'ancre de l'étape courante : attendue, puis montrée — ou sautée.
    useEffect(() => {
        if (!actif) return;
        if (index >= etapes.length) { clore(); return; }
        let annule = false;
        let essais = 0;
        setCible(null);
        setRect(null);
        const chercher = () => {
            if (annule) return;
            const el = ancreDe(etapes[index].ancre);
            if (el) {
                montrees.current += 1;
                el.scrollIntoView({ block: "center", behavior: "smooth" });
                // Le temps du défilement : mesurer trop tôt viserait à côté.
                window.setTimeout(() => { if (!annule) { setCible(el); setRect(el.getBoundingClientRect()); } }, 380);
                return;
            }
            if (++essais >= ESSAIS_ANCRE_MAX) { setIndex((i) => i + 1); return; }
            window.setTimeout(chercher, ATTENTE_ANCRE_MS);
        };
        chercher();
        return () => { annule = true; };
    }, [actif, index, etapes, clore]);

    // La cible bouge avec la page : on la suit au défilement et au redimensionnement.
    useEffect(() => {
        if (!cible) return;
        const mesurer = () => {
            setRect(cible.getBoundingClientRect());
            setFenetre({ width: window.innerWidth, height: window.innerHeight });
        };
        mesurer();
        window.addEventListener("scroll", mesurer, true);
        window.addEventListener("resize", mesurer);
        return () => {
            window.removeEventListener("scroll", mesurer, true);
            window.removeEventListener("resize", mesurer);
        };
    }, [cible]);

    // La taille réelle de l'infobulle, pour la placer sans déborder.
    useLayoutEffect(() => {
        const el = infobulleRef.current;
        if (el) setBoite({ width: el.offsetWidth, height: el.offsetHeight });
    }, [index, rect]);

    // Clavier : Échap passe, Entrée et → avancent.
    useEffect(() => {
        if (!actif) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.preventDefault(); clore(); }
            else if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); setIndex((i) => i + 1); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [actif, clore]);

    if (!actif || !rect || index >= etapes.length) return null;
    const etape = etapes[index];
    const derniere = index === etapes.length - 1;
    const place = placerInfobulle(
        { top: rect.top - MARGE_CIBLE, left: rect.left - MARGE_CIBLE, width: rect.width + 2 * MARGE_CIBLE, height: rect.height + 2 * MARGE_CIBLE },
        fenetre,
        boite,
    );

    return createPortal(
        <div role="dialog" aria-modal="true" aria-label={`Visite guidée, étape ${index + 1} sur ${etapes.length}`}>
            {/* Ce qui capte les clics : rien d'autre que la visite ne répond. */}
            <div className="fixed inset-0 z-[70]" />
            {/* Le trou : l'ombre portée fait le voile, l'élément visé reste intact. */}
            <div
                className="pointer-events-none fixed z-[71] rounded-xl"
                style={{
                    top: rect.top - MARGE_CIBLE, left: rect.left - MARGE_CIBLE,
                    width: rect.width + 2 * MARGE_CIBLE, height: rect.height + 2 * MARGE_CIBLE,
                    boxShadow: `0 0 0 9999px ${VOILE}`,
                }}
            />
            <div
                ref={infobulleRef}
                className="fixed z-[72] rounded-xl bg-slate-900 p-4 text-slate-50 shadow-2xl"
                style={{ top: place.top, left: place.left, width: LARGEUR_INFOBULLE, maxWidth: "calc(100vw - 24px)" }}
            >
                <span
                    aria-hidden
                    className="absolute h-3.5 w-3.5 rotate-45 bg-slate-900"
                    style={place.position === "bas" ? { top: -7, left: place.fleche - 7 } : { bottom: -7, left: place.fleche - 7 }}
                />
                <p className="text-sm font-semibold">{etape.titre}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-300">{etape.texte}</p>
                <div className="mt-3 flex items-center justify-between">
                    <span className="text-[11px] tabular-nums text-slate-400">{index + 1} / {etapes.length}</span>
                    <span className="flex gap-2">
                        <button
                            type="button"
                            onClick={clore}
                            className="rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:border-slate-400 hover:text-white"
                        >
                            Passer la visite
                        </button>
                        <button
                            type="button"
                            autoFocus
                            onClick={() => setIndex((i) => i + 1)}
                            className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500"
                        >
                            {derniere ? "Terminer" : "Suivant"}
                        </button>
                    </span>
                </div>
            </div>
        </div>,
        document.body,
    );
}
