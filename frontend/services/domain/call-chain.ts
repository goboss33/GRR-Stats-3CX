import type { CallChainSegment } from "./call.types";

/**
 * Chaîne d'appel — nettoyage des jambes JUMELLES d'un routage.
 *
 * 3CX peut tenter deux fois la même destination en parallèle. Observé le
 * 7 septembre 2026 sur le répondeur numérique 998 « GRR Horaires Fermé » : deux
 * jambes `route_to` nées à 0,7 ms d'intervalle depuis le même segment de file,
 * la seconde annulée `cancelled / completed_elsewhere` à l'instant exact où la
 * première décroche — le mécanisme des sonneries fantômes d'un « Sonne tous »,
 * appliqué à une destination unique. Pour l'appelant, une seule tentative a
 * existé : la chronologie n'en montre qu'une.
 *
 * Critère volontairement étroit : même segment d'origine, même destination
 * (numéro ET type), naissances à moins de deux secondes, et la jambe écartée
 * est une tentative ANNULÉE — jamais une jambe décrochée, jamais une jambe
 * sans jumelle survivante. Les sonneries d'agents (`polling`) ne sont pas
 * concernées : chaque agent est une destination distincte, et la frise les
 * regroupe déjà sous leur file.
 */
const TWIN_WINDOW_MS = 2_000;

function isCancelledElsewhere(seg: CallChainSegment): boolean {
    return seg.terminationReason === "cancelled" && seg.terminationReasonDetails === "completed_elsewhere";
}

function startMs(seg: CallChainSegment): number {
    const t = new Date(seg.startedAt).getTime();
    return Number.isNaN(t) ? 0 : t;
}

/** Retire les jambes jumelles annulées ; renvoie le tableau d'origine s'il n'y a rien à fusionner. */
export function mergeTwinLegs(segments: CallChainSegment[]): CallChainSegment[] {
    const dropped = new Set<string>();
    for (const seg of segments) {
        if (!seg.originatingCdrId || !isCancelledElsewhere(seg)) continue;
        if (seg.creationForwardReason === "polling") continue;
        const t = startMs(seg);
        const survivor = segments.find((other) =>
            other.id !== seg.id
            && !dropped.has(other.id)
            && !isCancelledElsewhere(other)
            && other.originatingCdrId === seg.originatingCdrId
            && other.destinationType === seg.destinationType
            && other.destinationNumber === seg.destinationNumber
            && Math.abs(startMs(other) - t) <= TWIN_WINDOW_MS,
        );
        if (survivor) dropped.add(seg.id);
    }
    return dropped.size === 0 ? segments : segments.filter((s) => !dropped.has(s.id));
}
