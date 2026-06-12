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
  ]),
  {
    // This self-hosted app serves its own images from /api/files — next/image
    // optimization adds nothing (no CDN, no remote loader) and would re-encode
    // already-optimized thumbnails.
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  {
    // server.js and the data-prep scripts are plain Node CommonJS by design.
    files: ["server.js", "scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
