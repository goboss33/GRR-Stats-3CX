// ============================================
// JOURNAL DE COMPOSITION DES ÉQUIPES — le cerveau pur
//
// Compare les intervalles OUVERTS du journal avec un relevé instantané de la
// XAPI et décide des mouvements : fermer, ouvrir, prolonger. Aucune entrée-
// sortie ici — tout est testable à sec, la couche service applique.
//
// Doctrine des noms d'époque : un changement de titulaire sur le même poste
// (Nicole → Martine) FERME l'intervalle en cours et en OUVRE un nouveau. Le
// journal n'écrase jamais un nom : il date la passation.
// ============================================

/** Intervalle ouvert tel que lu dans le journal. */
export interface OpenInterval {
    id: string;
    queueNumber: string;
    extension: string;
    agentName: string;
}

/** Un membre vu dans le relevé instantané XAPI. */
export interface SnapshotMember {
    queueNumber: string;
    extension: string;
    agentName: string;
}

export interface JournalPlan {
    /** Intervalles à fermer : disparus du relevé, ou titulaire changé. */
    toClose: string[];
    /** Intervalles à ouvrir : nouveaux membres, ou nouveau titulaire. */
    toOpen: SnapshotMember[];
    /** Intervalles inchangés : simple prolongation (lastSeenAt). */
    toTouch: string[];
}

const keyOf = (m: { queueNumber: string; extension: string }) => `${m.queueNumber}|${m.extension}`;

/** Nettoie un relevé : espaces, doublons (file, poste), nom vide → poste. */
export function normalizeSnapshot(raw: SnapshotMember[]): SnapshotMember[] {
    const seen = new Map<string, SnapshotMember>();
    for (const m of raw) {
        const queueNumber = m.queueNumber.trim();
        const extension = m.extension.trim();
        if (!queueNumber || !extension) continue;
        // Piège 3CX connu : des noms parfois CHAÎNE VIDE, pas null.
        const agentName = m.agentName.trim() || extension;
        const key = keyOf({ queueNumber, extension });
        if (!seen.has(key)) seen.set(key, { queueNumber, extension, agentName });
    }
    return [...seen.values()];
}

export function planJournalChanges(open: OpenInterval[], snapshot: SnapshotMember[]): JournalPlan {
    const members = new Map(snapshot.map((m) => [keyOf(m), m]));
    const plan: JournalPlan = { toClose: [], toOpen: [], toTouch: [] };
    const matchedKeys = new Set<string>();

    for (const interval of open) {
        const key = keyOf(interval);
        const member = members.get(key);
        if (!member) {
            // Le poste n'est plus membre de cette file.
            plan.toClose.push(interval.id);
            continue;
        }
        matchedKeys.add(key);
        if (member.agentName !== interval.agentName) {
            // Même poste, autre titulaire : passation datée.
            plan.toClose.push(interval.id);
            plan.toOpen.push(member);
        } else {
            plan.toTouch.push(interval.id);
        }
    }

    for (const [key, member] of members) {
        if (!matchedKeys.has(key)) plan.toOpen.push(member);
    }

    // Un doublon d'intervalles ouverts pour la même paire (état corrompu par
    // un incident passé) produirait ici deux toTouch pour une seule clé — le
    // plan reste correct, la paire n'est simplement jamais dupliquée à
    // l'ouverture puisque matchedKeys la marque dès le premier passage.
    return plan;
}

// ============================================
// FRONTIÈRE DE BASCULE — à partir de quand le journal fait foi
//
// La règle « rosterSource: journalAuto » ne s'applique qu'aux fenêtres
// entièrement postérieures au PREMIER MOIS CALENDAIRE COMPLET couvert par le
// journal (fuseau du tenant). Un journal né le 25 août ne gouverne que
// septembre et au-delà : août reste un mois de l'ancien régime, entier et
// cohérent avec lui-même — jamais un mois hybride.
// ============================================

/** Clé de date locale yyyymmdd d'un instant, dans le fuseau donné. */
export function localDateKey(instant: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(instant);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return get("year") * 10000 + get("month") * 100 + get("day");
}

/** Premier jour (clé yyyymmdd) du premier mois ENTIÈREMENT couvert. */
export function journalCutoverKey(firstRunAt: Date, timeZone: string): number {
    const key = localDateKey(firstRunAt, timeZone);
    const year = Math.floor(key / 10000);
    const month = Math.floor((key % 10000) / 100);
    const day = key % 100;
    if (day === 1) return year * 10000 + month * 100 + 1;
    return month === 12 ? (year + 1) * 10000 + 100 + 1 : year * 10000 + (month + 1) * 100 + 1;
}

/** La fenêtre demandée est-elle entièrement sous le régime du journal ? */
export function windowReachesCutover(windowStart: Date, firstRunAt: Date, timeZone: string): boolean {
    return localDateKey(windowStart, timeZone) >= journalCutoverKey(firstRunAt, timeZone);
}
