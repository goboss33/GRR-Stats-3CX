/**
 * ColumnFilterDateRange
 * 
 * A wrapper around the shared DateRangePicker component,
 * configured for use in column header filters.
 * 
 * This ensures DRY - the core logic lives in DateRangePicker.
 */
"use client";

import { DateRangePicker, type DateRange } from "@/components/date-range-picker";

interface ColumnFilterDateRangeProps {
    dateRange: DateRange;
    onDateRangeChange: (range: DateRange) => void;
    className?: string;
}

export function ColumnFilterDateRange({
    dateRange,
    onDateRangeChange,
    className,
}: ColumnFilterDateRangeProps) {
    return (
        <DateRangePicker
            dateRange={dateRange}
            onDateRangeChange={onDateRangeChange}
            className={className}
            size="compact"
            displayFormat="short"
        />
    );
}
