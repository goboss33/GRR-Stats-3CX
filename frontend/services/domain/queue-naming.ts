// ============================================
// CONVENTION DE NOMMAGE DES FILES 3CX
//
// Les files suivent (presque) la forme : [ENTITÉ] [RÉGION] [SERVICE...]
//   « RC BULLE Gérance »            -> RC / BULLE / Gérance
//   « GRR GENEVE Gérance (Bureau 513) » -> GRR / GENEVE / Gérance (Bureau 513)
//
// ⚠️ Ces étiquettes ne définissent JAMAIS les droits à elles seules : elles ne
// servent qu'à PRÉ-REMPLIR le registre, qu'un ADMIN valide. Les droits reposent
// sur le numéro de file (cf. PRD droits d'accès §3.1 : une file a déjà changé de
// région lors d'un renommage).
//
// La région est reconnue via une liste blanche plutôt que « le 2e mot », car ce
// 2e mot est souvent autre chose (« GRR Direction », « BS Ventes »…).
// ============================================

/** Régions connues (observées dans les données réelles), en forme canonique. */
export const KNOWN_REGIONS = [
    "BULLE",
    "COPPET",
    "CRANS-MONTANA",
    "FRIBOURG",
    "GENEVE",
    "LAUSANNE",
    "LUTRY",
    "MONTREUX",
    "MORGES",
    "NEUCHATEL",
    "NYON",
    "PULLY",
    "SION",
    "VEVEY",
    "YVERDON",
    "ZERMATT",
    "ZURICH",
] as const;

export type KnownRegion = (typeof KNOWN_REGIONS)[number];

export interface QueueTags {
    entity: string | null;
    region: string | null;
    service: string | null;
}

/** Majuscules sans accents : « Genève » et « GENEVE » deviennent identiques. */
export function normalizeRegion(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .trim()
        .toUpperCase();
}

const REGION_SET = new Set<string>(KNOWN_REGIONS);

/**
 * Propose des étiquettes à partir du nom d'une file.
 * Retourne `region: null` quand aucune région connue n'est reconnue — l'ADMIN
 * classera manuellement plutôt que de deviner (mieux vaut vide que faux).
 */
export function parseQueueName(name: string | null | undefined): QueueTags {
    const trimmed = (name ?? "").trim();
    if (!trimmed) return { entity: null, region: null, service: null };

    const tokens = trimmed.split(/\s+/);
    const regionIndex = tokens.findIndex((t) => REGION_SET.has(normalizeRegion(t)));

    if (regionIndex === -1) {
        // Pas de région reconnue : on ne propose qu'une entité si un service suit.
        return {
            entity: tokens.length > 1 ? tokens[0] : null,
            region: null,
            service: tokens.length > 1 ? tokens.slice(1).join(" ") : trimmed,
        };
    }

    const entity = tokens.slice(0, regionIndex).join(" ");
    const service = tokens.slice(regionIndex + 1).join(" ");

    return {
        entity: entity || null,
        region: normalizeRegion(tokens[regionIndex]),
        service: service || null,
    };
}
