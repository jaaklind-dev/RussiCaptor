const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    files: ["**/*.cjs"],
    languageOptions: {
      // Node supplies this readonly CommonJS binding; keep no-undef enabled.
      globals: { __dirname: "readonly" },
    },
  },
  {
    files: ["supabase/functions/_shared/platformAdmin.ts"],
    settings: {
      // Deno's pinned npm: syntax is valid, but not a Node module identifier.
      // The resolver verifies the exact installed version; no rule is disabled.
      "import/resolver": {
        [require.resolve("./scripts/lib/eslint-deno-npm-resolver.cjs")]: {},
        node: {},
      },
    },
  },
  {
    ignores: ["dist/*"],
  },
]);
