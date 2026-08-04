import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    test: {
        environment: "node",
        include: ["services/**/*.test.ts", "lib/**/*.test.ts"],
    },
    resolve: {
        // Miroir des path aliases du tsconfig : "@/*" et les clients Prisma
        // générés (sortie personnalisée dans node_modules/.prisma).
        alias: {
            "@prisma/auth-client": path.join(dir, "node_modules/.prisma/auth-client"),
            "@prisma/cdr-client": path.join(dir, "node_modules/.prisma/cdr-client"),
            "@": dir,
        },
    },
});
