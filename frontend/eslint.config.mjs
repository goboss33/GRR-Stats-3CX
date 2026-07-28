import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));

// FlatCompat traduit les configs "extends" historiques (eslint-config-next)
// vers le format plat, standard depuis ESLint 9.
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
    {
        ignores: [
            "node_modules/**",
            ".next/**",
            "out/**",
            "build/**",
            "next-env.d.ts",
        ],
    },
    ...compat.extends("next/core-web-vitals", "next/typescript"),
    {
        rules: {
            // Apostrophes françaises : bruit pur sur une UI en français.
            "react/no-unescaped-entities": "off",
            "@typescript-eslint/no-empty-object-type": "off",
            // Dette connue, suivie (cf. EPIC E) — visible sans bloquer le build.
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": "warn",
        },
    },
];

export default eslintConfig;
