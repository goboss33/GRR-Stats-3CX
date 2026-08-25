// Mesure du RÉSIDUEL d'incohérence « somme des jours vs mois » pour une file
// et un mois : bucketise la fenêtre MOIS par jour (l'ancre de la courbe et de
// la heatmap) puis compare chaque jour au KPI recalculé sur la fenêtre du
// jour seul — aux règles VIVANTES, roster du journal compris quand la règle
// et la couverture s'y prêtent. Lecture seule.
//
// Usage : npx tsx scripts/diag-coherence-fenetres.ts [file=904] [aaaa-mm=2026-07]
//
// Interprétation : delta « direct » = défaut de roster (résolu par la règle
// journalAuto sur les périodes couvertes) ; delta « file » = résiduel
// structurel (minuit, déduplication inter-jours) — celui qui déciderait de
// rouvrir la piste « le mois comme unité de vérité ».
import { getPrismaCdr } from "@/lib/prisma-cdr";
import { getClassificationRules } from "@/lib/classification-rules";
import { getServerTimezone } from "@/lib/servers";
import { buildTeamCTEChain } from "@/services/domain/call-classification";
import { resolveRosterForRules } from "@/services/xapi-journal.service";

const QUEUE = process.argv[2] ?? "904";
const MONTH = process.argv[3] ?? "2026-07";

const UNION = `
    SELECT cdr_started_at AS started_at, 'file'::text AS bloc FROM queue_calls
    UNION ALL
    SELECT started_at, 'direct'::text AS bloc FROM direct_calls`;

async function main() {
    const prisma = getPrismaCdr("gerofinance");
    const rules = await getClassificationRules();
    const timezone = await getServerTimezone("gerofinance");
    const [y, m] = MONTH.split("-").map(Number);
    // Bornes du mois local (approximation Europe/Zurich : UTC+2 l'été suffit
    // pour un diagnostic ; l'application, elle, reçoit les bornes du client).
    const monthStart = new Date(Date.UTC(y, m - 1, 1) - 2 * 3600 * 1000);
    const monthEnd = new Date(Date.UTC(y, m, 1) - 2 * 3600 * 1000 - 1);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

    const monthRoster = await resolveRosterForRules(rules, "gerofinance", QUEUE, monthStart, monthEnd);
    const chainFor = (roster: typeof monthRoster) =>
        buildTeamCTEChain(rules, { queueExpr: "$1", startExpr: "$2", endExpr: "$3", origin: "external", rosterMembers: roster });

    type Row = { jour: string; bloc: string; n: number };
    const buckets = await prisma.$queryRawUnsafe<Row[]>(
        `WITH ${chainFor(monthRoster)}
         SELECT to_char(t.started_at AT TIME ZONE '${timezone}', 'YYYY-MM-DD') AS jour, t.bloc, COUNT(*)::int AS n
         FROM (${UNION}) t GROUP BY 1, 2`,
        QUEUE, monthStart, monthEnd,
    );
    const monthMap = new Map<string, { file: number; direct: number }>();
    for (const r of buckets) {
        const e = monthMap.get(r.jour) ?? { file: 0, direct: 0 };
        e[r.bloc === "file" ? "file" : "direct"] += r.n;
        monthMap.set(r.jour, e);
    }

    console.log(`\nFile ${QUEUE} — ${MONTH} — roster ${monthRoster ? "JOURNAL" : "activité"} (règle ${rules.rosterSource})\n`);
    let dFile = 0, dDirect = 0, joursEcart = 0;
    for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${MONTH}-${String(d).padStart(2, "0")}`;
        const start = new Date(Date.UTC(y, m - 1, d) - 2 * 3600 * 1000);
        const end = new Date(Date.UTC(y, m - 1, d + 1) - 2 * 3600 * 1000 - 1);
        const dayRoster = await resolveRosterForRules(rules, "gerofinance", QUEUE, start, end);
        const kpi = await prisma.$queryRawUnsafe<{ file: number; direct: number }[]>(
            `WITH ${chainFor(dayRoster)}
             SELECT (SELECT COUNT(*) FROM queue_calls)::int AS file,
                    (SELECT COUNT(*) FROM direct_calls)::int AS direct`,
            QUEUE, start, end,
        );
        const mois = monthMap.get(iso) ?? { file: 0, direct: 0 };
        const ef = mois.file - kpi[0].file;
        const ed = mois.direct - kpi[0].direct;
        if (ef !== 0 || ed !== 0) {
            joursEcart++;
            console.log(`  ${iso}  mois=${mois.file}+${mois.direct}  jour=${kpi[0].file}+${kpi[0].direct}  delta file=${ef} direct=${ed}`);
        }
        dFile += Math.abs(ef); dDirect += Math.abs(ed);
    }
    console.log(`\n  Résiduel : ${joursEcart} jour(s) en écart — |Δfile|=${dFile}, |Δdirect|=${dDirect}`);
    console.log(dDirect > 0 && !monthRoster
        ? "  (Δdirect = défaut de roster : attendu tant que la période n'est pas sous le régime du journal)"
        : dFile + dDirect === 0
            ? "  Cohérence parfaite sur ce mois."
            : "  Δ résiduel structurel : matière pour la piste « le mois comme unité de vérité ».");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
