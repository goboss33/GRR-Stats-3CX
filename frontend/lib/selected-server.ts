import { ServerId } from "@/lib/prisma-cdr";

/**
 * Lit le tenant (serveur 3CX) sélectionné depuis le cookie `selectedServer`.
 *
 * À usage client uniquement (lecture de `document.cookie`). Retourne
 * "gerofinance" par défaut lorsque le cookie est absent ou en contexte SSR.
 */
export function getSelectedServer(): ServerId {
    if (typeof document === "undefined") return "gerofinance";
    const match = document.cookie.match(/selectedServer=([^;]+)/);
    return (match?.[1] as ServerId) || "gerofinance";
}
