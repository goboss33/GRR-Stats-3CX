"use client";

import { AlertTriangle, Check, type LucideIcon } from "lucide-react";

import type { LossVerdict } from "@/services/domain/team-totals";

/**
 * Habillage du verdict de perte pour la GRILLE des cartes d'aperçu : là on
 * scanne des symboles, la coche verte explicite confirme d'un coup d'œil que
 * l'équipe respecte la consigne des 30 % — le triangle sert à l'approche
 * comme au dépassement, seule la couleur dit la gravité.
 *
 * Sur l'écran détail, le verdict vit dans l'étiquette rouge du donut
 * (triangle SVG devant le pourcentage de perte, en alerte seulement) — voir
 * team-overview.
 */
export const LOSS_ICON: Record<LossVerdict, { wrap: string; icon: string; Icon: LucideIcon; label: string }> = {
    ok: { wrap: "bg-emerald-100", icon: "text-emerald-600", Icon: Check, label: "objectif tenu" },
    warning: { wrap: "bg-amber-100", icon: "text-amber-600", Icon: AlertTriangle, label: "proche du seuil" },
    over: { wrap: "bg-red-100", icon: "text-red-600", Icon: AlertTriangle, label: "seuil dépassé" },
};
