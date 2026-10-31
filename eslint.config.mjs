import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "convex/_generated/**",
  ]),
  {
    // Convex functions must be built from the wrappers in convex/lib/functions.ts
    // so authentication and roles are resolved in one place.
    files: ["convex/**/*.ts"],
    ignores: ["convex/lib/functions.ts", "convex/**/*.*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/_generated/server"],
              importNames: [
                "query",
                "mutation",
                "action",
                "internalQuery",
                "internalMutation",
                "internalAction",
                "httpAction",
              ],
              message: "Build Convex functions with the wrappers in convex/lib/functions.ts.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
