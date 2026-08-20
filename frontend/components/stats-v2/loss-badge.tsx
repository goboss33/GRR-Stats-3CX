"use client";

import { AlertTriangle, AlertCircle, Check, type LucideIcon } from "lucide-react";

import type { LossVerdict } from "@/services/domain/team-totals";

/**
 * Habillage du verdict de perte — partagé pour que l'alerte ait le même
 * visage partout.
 *
 * Deux registres selon le contexte :
 * - LOSS_BADGE (chip avec libellé) pour l'écran détail : muet quand
 *   l'objectif est tenu, l'absence de pastille EST le signal positif.
 * - LOSS_ICON (symbole rond sans texte) pour la GRILLE des cartes : là on
 *   scanne des symboles, la coche verte explicite confirme d'un coup d'œil
 *   que l'équipe respecte la consigne — le triangle sert à l'approche comme
 *   au dépassement, seule la couleur dit la gravité.
 */
export const LOSS_BADGE: Record<LossVerdict, { badge: string; Icon: LucideIcon; label: string } | null> = {
    ok: null,
    warning: { badge: "bg-amber-50 border-amber-200 text-amber-700", Icon: AlertTriangle, label: "proche du seuil" },
    over: { badge: "bg-red-50 border-red-200 text-red-700", Icon: AlertCircle, label: "seuil dépassé" },
};

export const LOSS_ICON: Record<LossVerdict, { wrap: string; icon: string; Icon: LucideIcon; label: string }> = {
    ok: { wrap: "bg-emerald-100", icon: "text-emerald-600", Icon: Check, label: "objectif tenu" },
    warning: { wrap: "bg-amber-100", icon: "text-amber-600", Icon: AlertTriangle, label: "proche du seuil" },
    over: { wrap: "bg-red-100", icon: "text-red-600", Icon: AlertTriangle, label: "seuil dépassé" },
};
