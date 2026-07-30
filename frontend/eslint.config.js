import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  { ignores: ['dist', 'wailsjs', 'ui-example', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // PRD: "Avoid `any`" — strong separation between UI and filesystem bridge.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // PLAN.md §1, rule 1: the Wails bindings are reachable from exactly one
      // place. This is both the v3 migration seam and the test seam.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/wailsjs/**', '@/../wailsjs/**'],
              message:
                'Import Wails bindings only inside src/services/bridge/impl/. Everything else must use the bridge API (@/services/bridge).',
            },
          ],
        },
      ],
    },
  },
  // The bridge implementations are the one place allowed to touch wailsjs.
  {
    files: ['src/services/bridge/impl/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      // Bridge methods are `async` even when they await nothing: the contract is
      // Promise-returning, and `async` is what turns a validation throw into a
      // rejection. A synchronous throw would bypass every `.catch()` in the app.
      '@typescript-eslint/require-await': 'off',
    },
  },
  // Vitest globals in test files.
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
)
