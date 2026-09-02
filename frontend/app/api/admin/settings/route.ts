import { NextRequest, NextResponse } from "next/server";
import { prismaAuth } from "@/lib/prisma-auth";
import { requireApiRole } from "@/lib/auth-guard";
import { logger } from "@/lib/logger";
import { invalidateClassificationRules } from "@/lib/classification-rules";

/** Champs de règles de classement exposés, avec leurs valeurs admises. */
const RULE_FIELDS = {
    ruleMultiPassage: ["best", "last", "each"],
    ruleOverflow: ["neutral", "lost", "answered"],
    ruleDirectAndQueue: ["firstContact", "queueWins", "both"],
    ruleVoicemail: ["separate", "lost", "answered", "excluded"],
    ruleOutOfScopeFinalStatus: ["name", "anonymize", "hide"],
    ruleCallGrain: ["leg", "merged"],
    ruleAnsweredThenTransferred: ["overflow", "answered"],
    ruleAgentCredit: ["lastAnswer", "each"],
    ruleHandedOffInPerformance: ["success", "neutral"],
    ruleShortAbandonDisposition: ["lost", "excluded"],
    ruleShortAbandonClock: ["passage", "team"],
    ruleUnansweredDirectOverflow: ["lost", "overflow"],
} as const;

type RuleField = keyof typeof RULE_FIELDS;

/** Projection commune aux deux verbes, pour qu'ils ne divergent pas. */
function projectSettings(settings: Record<string, unknown>) {
    return {
        minSignificantDurationSec: settings.minSignificantDurationSec,
        perimeterEnforcementEnabled: settings.perimeterEnforcementEnabled,
        hideArchivedQueues: settings.hideArchivedQueues,
        ruleMultiPassage: settings.ruleMultiPassage,
        ruleOverflow: settings.ruleOverflow,
        ruleShortAbandonSec: settings.ruleShortAbandonSec,
        ruleDirectAndQueue: settings.ruleDirectAndQueue,
        ruleVoicemail: settings.ruleVoicemail,
        ruleOutOfScopeFinalStatus: settings.ruleOutOfScopeFinalStatus,
        ruleMinAnswerSec: settings.ruleMinAnswerSec,
        ruleCallGrain: settings.ruleCallGrain,
        ruleAnsweredThenTransferred: settings.ruleAnsweredThenTransferred,
        ruleAgentCredit: settings.ruleAgentCredit,
        ruleHandedOffInPerformance: settings.ruleHandedOffInPerformance,
        ruleShortAbandonDisposition: settings.ruleShortAbandonDisposition,
        ruleShortAbandonClock: settings.ruleShortAbandonClock,
        ruleUnansweredDirectOverflow: settings.ruleUnansweredDirectOverflow,
    };
}

// Règles métier = configuration applicative -> réservé à l'ADMIN (cf. PRD droits d'accès §4).

export async function GET() {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        let settings = await prismaAuth.appSettings.findUnique({
            where: { id: "global" },
        });

        if (!settings) {
            settings = await prismaAuth.appSettings.create({
                data: { id: "global" },
            });
        }

        return NextResponse.json(projectSettings(settings));
    } catch (error) {
        logger.error("Error fetching app settings:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    const guard = await requireApiRole(["ADMIN"]);
    if (!guard.ok) return guard.response;

    try {
        const body = await request.json();
        const { minSignificantDurationSec, perimeterEnforcementEnabled } = body;

        if (minSignificantDurationSec !== undefined &&
            (typeof minSignificantDurationSec !== "number" || minSignificantDurationSec < 0 || minSignificantDurationSec > 60)) {
            return NextResponse.json({ error: "Invalid minSignificantDurationSec. Must be between 0 and 60." }, { status: 400 });
        }

        // Règles de classement : toute valeur hors du domaine est refusée plutôt
        // que corrigée silencieusement — une règle mal enregistrée fausserait les
        // chiffres sans que personne ne s'en aperçoive.
        const ruleData: Record<string, string> = {};
        for (const [field, allowed] of Object.entries(RULE_FIELDS) as [RuleField, readonly string[]][]) {
            const value = body[field];
            if (value === undefined) continue;
            if (typeof value !== "string" || !allowed.includes(value)) {
                return NextResponse.json(
                    { error: `Valeur invalide pour ${field}. Attendu : ${allowed.join(", ")}.` },
                    { status: 400 },
                );
            }
            ruleData[field] = value;
        }

        // `null` est légitime : il désactive la règle des abandons courts.
        const minAnswer = body.ruleMinAnswerSec;
        if (minAnswer !== undefined
            && (typeof minAnswer !== "number" || minAnswer < 0 || minAnswer > 60)) {
            return NextResponse.json(
                { error: "ruleMinAnswerSec doit être un nombre entre 0 et 60." },
                { status: 400 },
            );
        }

        const shortAbandon = body.ruleShortAbandonSec;
        if (shortAbandon !== undefined && shortAbandon !== null
            && (typeof shortAbandon !== "number" || shortAbandon < 0 || shortAbandon > 300)) {
            return NextResponse.json(
                { error: "ruleShortAbandonSec doit être un nombre entre 0 et 300, ou null." },
                { status: 400 },
            );
        }

        const data = {
            ...(minSignificantDurationSec !== undefined ? { minSignificantDurationSec } : {}),
            ...(perimeterEnforcementEnabled !== undefined
                ? { perimeterEnforcementEnabled: Boolean(perimeterEnforcementEnabled) }
                : {}),
            ...ruleData,
            ...(shortAbandon !== undefined ? { ruleShortAbandonSec: shortAbandon } : {}),
            ...(minAnswer !== undefined ? { ruleMinAnswerSec: minAnswer } : {}),
            ...(body.hideArchivedQueues !== undefined
                ? { hideArchivedQueues: Boolean(body.hideArchivedQueues) }
                : {}),
        };

        const settings = await prismaAuth.appSettings.upsert({
            where: { id: "global" },
            update: data,
            create: { id: "global", ...data },
        });

        // Sans cela, l'auteur du changement attendrait la fin du cache avant de
        // voir son effet, et croirait l'enregistrement sans effet.
        invalidateClassificationRules();

        return NextResponse.json(projectSettings(settings));
    } catch (error) {
        logger.error("Error updating app settings:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
