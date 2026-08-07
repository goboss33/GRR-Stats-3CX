"use client";

// Config statiques et helpers de rendu partagés par LogsTable et LogRow.
// Aucun état ici : purement présentation.

import * as React from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
    ArrowDownLeft,
    ArrowUpRight,
    ArrowLeftRight,
    Shuffle,
    Phone,
    PhoneOff,
    Voicemail,
    PhoneCall,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    Users,
    HelpCircle,
} from "lucide-react";
import type { CallProvenance, CallSens, CallStatus, SortField, LogsSort, JourneyStep } from "@/types/logs.types";
import type { PassageOutcome } from "@/services/domain/call-classification";

// Provenance : le vocabulaire du toggle du header, mot pour mot — un
// utilisateur qui filtre « Externe » voit des lignes badgées « Externe ».
export const provenanceConfig: Record<CallProvenance, { label: string; className: string }> = {
    external: { label: "Externe", className: "bg-indigo-100 text-indigo-700" },
    internal: { label: "Interne", className: "bg-slate-100 text-slate-700" },
};

// Sens de circulation. « Intra » (poste → poste ou système interne) plutôt
// qu'« Interne », déjà pris par la provenance. Le pont n'est pas un sens :
// c'est la pastille viaBridge, affichée à côté de la provenance.
export const sensConfig: Record<CallSens, { icon: typeof ArrowDownLeft; label: string; className: string }> = {
    inbound: { icon: ArrowDownLeft, label: "Entrant", className: "bg-emerald-100 text-emerald-700" },
    outbound: { icon: ArrowUpRight, label: "Sortant", className: "bg-blue-100 text-blue-700" },
    intra: { icon: ArrowLeftRight, label: "Intra", className: "bg-slate-100 text-slate-700" },
};

// Trois statuts finaux : Répondu, Perdu, Messagerie. « Occupé » rejoint
// « Perdu » — c'est un appel qu'on n'a pas pris. L'étiquette exacte dépend du
// sens de l'appel (cf. finalStatusLabel) : « Perdu » n'a de sens qu'en entrant.
export const statusConfig: Record<CallStatus, { icon: typeof Phone; className: string }> = {
    answered: { icon: Phone, className: "bg-emerald-100 text-emerald-700" },
    voicemail: { icon: Voicemail, className: "bg-indigo-100 text-indigo-700" },
    missed: { icon: PhoneOff, className: "bg-red-100 text-red-700" },
    busy: { icon: PhoneCall, className: "bg-red-100 text-red-700" },
};

/**
 * Statuts « dans la file », issus du socle de classement. Distincts du statut
 * final volontairement : un appel peut être perdu pour une file et répondu par
 * l'entreprise, et c'est justement ce que la vue file donne à voir.
 */
export const queueOutcomeConfig: Record<PassageOutcome, { label: string; className: string }> = {
    answered: { label: "Répondu", className: "bg-emerald-100 text-emerald-700" },
    // Transféré = décroché ici puis servi ailleurs (le transfert accompli) —
    // compté dans la vignette Répondus, d'où le vert clair (même grammaire que
    // le donut : teinte claire = transféré) ; Débordé = parti SANS décroché
    // ici, seul occupant de la vignette orange « Débordements ».
    handed_off: { label: "Transféré", className: "bg-emerald-50 text-emerald-600" },
    overflow: { label: "Débordé", className: "bg-amber-100 text-amber-700" },
    // Messagerie et abandons courts existent dans le socle — ils restent
    // configurables et pilotent le calcul — mais les vignettes ne les nomment
    // jamais : elles les rangent dans « Perdus ». Les logs emploient donc le
    // même vocabulaire, sans quoi un manager verrait des statuts dont aucune
    // statistique ne parle. Le parcours reste là pour distinguer les cas.
    voicemail: { label: "Perdu", className: "bg-red-100 text-red-700" },
    short_abandon: { label: "Perdu", className: "bg-red-100 text-red-700" },
    abandoned: { label: "Perdu", className: "bg-red-100 text-red-700" },
};

// Journey step icon & style config — dynamic based on result
export function getJourneyStepStyle(step: JourneyStep): { icon: React.ReactNode; className: string } {
    const iconClass = "w-4 h-4";
    switch (step.type) {
        case 'direct':
            switch (step.result) {
                case 'answered': return { icon: <Phone className={iconClass} />, className: 'text-emerald-600' };
                case 'busy':
                case 'not_answered':
                default: return { icon: <Phone className={iconClass} />, className: 'text-red-600' };
            }
        case 'queue':
            switch (step.result) {
                case 'answered': return { icon: <Users className={iconClass} />, className: 'text-emerald-600' };
                case 'overflow': return { icon: <Users className={iconClass} />, className: 'text-amber-500' };
                case 'abandoned':
                case 'not_answered':
                default: return { icon: <Users className={iconClass} />, className: 'text-red-600' };
            }
        case 'voicemail':
            return { icon: <Voicemail className={iconClass} />, className: 'text-purple-600' };
        default:
            return { icon: <HelpCircle className={iconClass} />, className: 'text-slate-400' };
    }
}

export function formatDateTime(isoString: string): string {
    if (!isoString) return "-";
    try {
        const date = new Date(isoString);
        return format(date, "dd/MM/yyyy", { locale: fr });
    } catch {
        return "-";
    }
}

export function formatTime(isoString: string): string {
    if (!isoString) return "-";
    try {
        const date = new Date(isoString);
        return format(date, "HH:mm:ss", { locale: fr });
    } catch {
        return "-";
    }
}

// Get color for segment count badge
export function getSegmentBadgeColor(count: number): string {
    if (count === 1) return "bg-emerald-100 text-emerald-700";
    if (count <= 3) return "bg-yellow-100 text-yellow-700";
    if (count <= 5) return "bg-orange-100 text-orange-700";
    return "bg-red-100 text-red-700";
}

// Get color for wait time
export function getWaitTimeColor(seconds: number): string {
    if (seconds < 15) return "text-emerald-600";
    if (seconds < 30) return "text-yellow-600";
    if (seconds < 60) return "text-orange-600";
    return "text-red-600";
}

// Sortable header component
export function SortableHeader({
    label,
    field,
    currentSort,
    onSort,
}: {
    label: string;
    field: SortField;
    currentSort?: LogsSort;
    onSort: (field: SortField) => void;
}) {
    const isActive = currentSort?.field === field;
    const direction = isActive ? currentSort.direction : undefined;

    return (
        <button
            onClick={() => onSort(field)}
            className="flex items-center gap-1 hover:text-slate-900 transition-colors text-left w-full"
        >
            <span className="truncate">{label}</span>
            {isActive ? (
                direction === "asc" ? (
                    <ArrowUp className="h-3 w-3 text-primary flex-shrink-0" />
                ) : (
                    <ArrowDown className="h-3 w-3 text-primary flex-shrink-0" />
                )
            ) : (
                <ArrowUpDown className="h-3 w-3 text-slate-400 flex-shrink-0" />
            )}
        </button>
    );
}
