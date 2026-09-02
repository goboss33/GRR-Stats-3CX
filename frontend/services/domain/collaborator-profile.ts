/**
 * PROFIL D'UN COLLABORATEUR À L'ÉCRAN — la partie pure.
 *
 * Le tableau d'activité garde les NOMS D'ÉPOQUE : un poste réattribué produit
 * une ligne par titulaire. La photo et le titre doivent donc se résoudre par
 * POSTE + NOM, jamais par le poste seul — sinon les chiffres de juin de
 * Robert-Charrue (poste 139) porteraient le visage de Thaqi, qui tient le 139
 * aujourd'hui. Le nom ne sert ici qu'à CONFIRMER le titulaire : le lien vers
 * Microsoft 365 reste l'e-mail, porté par la ligne de journal.
 */

export interface LigneJournalCollaborateur {
    extension: string;
    displayName: string;
    email: string | null;
    jobTitle: string | null;
    firstSeenAt: Date;
    closedAt: Date | null;
}

export interface Periode {
    start: Date;
    end: Date;
}

/** Même nom, aux espaces et à la casse près — les deux sources sont le 3CX. */
export function normaliserNom(nom: string): string {
    return nom.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * La ligne de journal qui décrit CE titulaire de CE poste pour la période :
 * parmi les lignes du poste portant le même nom, celle qui recouvre la
 * période ; à défaut la plus récente (le journal ne remonte qu'au 2 septembre
 * 2026 — pour une période antérieure, la ligne en cours fait foi dès que le
 * nom concorde). Null si aucune ligne ne porte ce nom : quelqu'un d'autre
 * tient ce poste, on n'affiche rien plutôt que le mauvais visage.
 */
export function resoudreLigne(
    lignes: LigneJournalCollaborateur[],
    agent: { extension: string; name: string },
    periode: Periode,
): LigneJournalCollaborateur | null {
    const nom = normaliserNom(agent.name);
    const candidates = lignes.filter((l) => l.extension === agent.extension && normaliserNom(l.displayName) === nom);
    if (candidates.length === 0) return null;

    const recouvre = candidates.filter((l) => l.firstSeenAt <= periode.end && (l.closedAt === null || l.closedAt >= periode.start));
    const choix = recouvre.length > 0 ? recouvre : candidates;
    return choix.reduce((a, b) => (b.firstSeenAt > a.firstSeenAt ? b : a));
}

/**
 * Initiales pour l'avatar de repli : prénom puis nom.
 *
 * Le 3CX écrit « Nom, Prénom » ; sans virgule on prend le premier et le
 * dernier mot. Un seul mot donne une lettre ; rien d'exploitable donne « ? ».
 */
export function initiales(nom: string): string {
    const propre = nom.replace(/\([^)]*\)/g, " ").trim();
    let prenom: string | undefined;
    let famille: string | undefined;
    if (propre.includes(",")) {
        const [avant, apres] = propre.split(",").map((s) => s.trim());
        famille = avant; prenom = apres;
    } else {
        const mots = propre.split(/\s+/).filter(Boolean);
        prenom = mots[0]; famille = mots.length > 1 ? mots[mots.length - 1] : undefined;
    }
    const lettre = (s?: string) => {
        const m = (s ?? "").match(/\p{L}/u);
        return m ? m[0].toUpperCase() : "";
    };
    const out = lettre(prenom) + lettre(famille);
    return out || "?";
}
