import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/.wrangler/**",
      "**/.expo/**",
      "**/.expo-shared/**",
      "**/web-build/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: [
      "packages/*/src/**/*.{ts,tsx}",
      "packages/*/test/**/*.{ts,tsx}",
      "apps/*/e2e/**/*.{ts,tsx}",
      "apps/*/src/**/*.{ts,tsx}",
      "apps/*/test/**/*.{ts,tsx}",
      "apps/*/modules/**/*.{ts,tsx}",
      "apps/*/*.config.{ts,mts,cts}",
    ],
    languageOptions: {
      parserOptions: {
        projectService: {
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 32,
          allowDefaultProject: [
            "packages/*/test/*.ts",
            "packages/*/test/*/*.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["**/test/**/*.{ts,tsx}", "**/*.{test,spec}.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-misused-spread": "off",
      "@typescript-eslint/prefer-promise-reject-errors": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["apps/relay/src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/return-await": "off",
    },
  },
  {
    files: ["apps/android/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-spread": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["**/*.{config,test,spec}.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: globals.node,
    },
  },
);
