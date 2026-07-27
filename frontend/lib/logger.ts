/**
 * Logger applicatif minimal.
 *
 * `debug` et `info` sont **muets en production** pour éviter le bruit dans les
 * logs serveur ; `warn` et `error` sont toujours émis. Centralise les appels
 * `console.*` afin de pouvoir, à terme, brancher un transport structuré.
 */
type LogLevel = "debug" | "info" | "warn" | "error";

const isProduction = process.env.NODE_ENV === "production";

function enabled(level: LogLevel): boolean {
    if (level === "debug" || level === "info") return !isProduction;
    return true;
}

export const logger = {
    debug: (...args: unknown[]) => {
        if (enabled("debug")) console.debug(...args);
    },
    info: (...args: unknown[]) => {
        if (enabled("info")) console.info(...args);
    },
    warn: (...args: unknown[]) => {
        if (enabled("warn")) console.warn(...args);
    },
    error: (...args: unknown[]) => {
        if (enabled("error")) console.error(...args);
    },
};
