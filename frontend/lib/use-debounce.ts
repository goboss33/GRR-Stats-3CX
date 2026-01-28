import { useEffect, useState } from "react";

/**
 * Debounce a value by the specified delay
 * Returns the debounced value after the delay has passed without changes
 * Special case: if value becomes empty string, update immediately (for reset scenarios)
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
        // If the value is empty string, update immediately (reset case)
        if (value === "" || value === undefined || value === null) {
            setDebouncedValue(value);
            return;
        }

        const timer = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => {
            clearTimeout(timer);
        };
    }, [value, delay]);

    return debouncedValue;
}
