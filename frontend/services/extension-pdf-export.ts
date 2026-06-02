import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import type { ExtensionStatisticsResponse } from "@/types/extension-stats.types";
import { formatDuration } from "@/services/domain/call-aggregation";

/**
 * Generates a professional PDF report for extension statistics.
 *
 * Layout:
 * - Header with title and period
 * - Summary KPI cards
 * - Detailed table with all extensions
 * - Footer with page numbers
 */
export function generateExtensionStatsPDF(data: ExtensionStatisticsResponse): void {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 14;
    let y = margin;

    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Statistiques par Extension", margin, y);
    y += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const startLabel = format(new Date(data.period.start), "dd MMMM yyyy", { locale: fr });
    const endLabel = format(new Date(data.period.end), "dd MMMM yyyy", { locale: fr });
    doc.text("Periode : " + startLabel + " - " + endLabel, margin, y);
    y += 5;
    doc.text("Nombre d'extensions : " + data.extensions.length, margin, y);
    y += 5;
    doc.text("Genere le : " + format(new Date(), "dd MMMM yyyy a HH:mm", { locale: fr }), margin, y);
    y += 10;

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Synthese globale", margin, y);
    y += 6;

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");

    const kpis = [
        { label: "Total appels", value: data.totals.totalCalls.toString() },
        { label: "Appels entrants", value: data.totals.totalInbound.toString() },
        { label: "Appels sortants", value: data.totals.totalOutbound.toString() },
        { label: "Repondus", value: data.totals.totalAnswered.toString() },
        { label: "Manques", value: data.totals.totalMissed.toString() },
        { label: "Taux de reponse", value: data.totals.overallAnswerRate + "%" },
        { label: "Duree totale", value: formatDuration(data.totals.totalDurationSeconds) },
        { label: "Duree moyenne", value: formatDuration(data.totals.averageDurationSeconds) },
    ];

    const kpiColWidth = (pageWidth - margin * 2) / 4;
    kpis.forEach((kpi, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const x = margin + col * kpiColWidth;
        const kpiY = y + row * 12;

        doc.setFillColor(241, 245, 249);
        doc.roundedRect(x, kpiY, kpiColWidth - 4, 10, 2, 2, "F");

        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(kpi.label, x + 3, kpiY + 3.5);

        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42);
        doc.setFont("helvetica", "bold");
        doc.text(kpi.value, x + 3, kpiY + 7.5);
        doc.setFont("helvetica", "normal");
    });

    y += Math.ceil(kpis.length / 4) * 12 + 8;

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text("Details par extension", margin, y);
    y += 4;

    autoTable(doc, {
        startY: y,
        head: [[
            "Extension",
            "Total",
            "Entrants",
            "Sortants",
            "Repondus",
            "Manques",
            "Voicemail",
            "Occupe",
            "Taux rep.",
            "Duree totale",
            "Duree moy.",
            "Duree max",
        ]],
        body: data.extensions.map((ext) => [
            ext.extension,
            ext.totalCalls.toString(),
            ext.inbound.total.toString(),
            ext.outbound.total.toString(),
            ext.inbound.answered.toString(),
            ext.inbound.missed.toString(),
            ext.inbound.voicemail.toString(),
            ext.inbound.busy.toString(),
            ext.inbound.answerRate + "%",
            ext.duration.totalFormatted,
            ext.duration.averageFormatted,
            ext.duration.maxFormatted,
        ]),
        foot: [[
            "TOTAL",
            data.totals.totalCalls.toString(),
            data.totals.totalInbound.toString(),
            data.totals.totalOutbound.toString(),
            data.totals.totalAnswered.toString(),
            data.totals.totalMissed.toString(),
            "",
            "",
            data.totals.overallAnswerRate + "%",
            formatDuration(data.totals.totalDurationSeconds),
            formatDuration(data.totals.averageDurationSeconds),
            "",
        ]],
        margin: { left: margin, right: margin },
        styles: {
            fontSize: 8,
            cellPadding: 3,
            lineColor: [226, 232, 240],
            lineWidth: 0.5,
        },
        headStyles: {
            fillColor: [30, 64, 175],
            textColor: [255, 255, 255],
            fontStyle: "bold",
            fontSize: 7.5,
        },
        footStyles: {
            fillColor: [241, 245, 249],
            textColor: [15, 23, 42],
            fontStyle: "bold",
            fontSize: 8,
        },
        alternateRowStyles: {
            fillColor: [248, 250, 252],
        },
        columnStyles: {
            0: { fontStyle: "bold", cellWidth: 22 },
            1: { halign: "center" },
            2: { halign: "center" },
            3: { halign: "center" },
            4: { halign: "center", textColor: [5, 150, 105] },
            5: { halign: "center", textColor: [220, 38, 38] },
            6: { halign: "center" },
            7: { halign: "center" },
            8: { halign: "center", fontStyle: "bold" },
            9: { halign: "right" },
            10: { halign: "right" },
            11: { halign: "right" },
        },
    });

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        const footerY = doc.internal.pageSize.getHeight() - 10;
        doc.text(
            "Call Center Analytics - Page " + i + "/" + pageCount,
            pageWidth / 2,
            footerY,
            { align: "center" }
        );
    }

    const fileName = "stats-extensions_" + format(new Date(), "yyyy-MM-dd") + ".pdf";
    doc.save(fileName);
}
