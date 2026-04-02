import { NextRequest, NextResponse } from "next/server";
import { runDiagnostic } from "@/services/diagnostic.service";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { startDate, endDate } = body;

        if (!startDate || !endDate) {
            return NextResponse.json(
                { error: "startDate and endDate are required" },
                { status: 400 }
            );
        }

        console.log("[DIAGNOSTIC] Running diagnostic from", startDate, "to", endDate);
        const result = await runDiagnostic(new Date(startDate), new Date(endDate));
        console.log("[DIAGNOSTIC] Success:", result.summary.totalCalls, "calls,", result.summary.divergences, "divergences");
        return NextResponse.json(result);
    } catch (error) {
        console.error("[DIAGNOSTIC] API error:", error);
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : "";
        return NextResponse.json(
            { error: message, stack },
            { status: 500 }
        );
    }
}
