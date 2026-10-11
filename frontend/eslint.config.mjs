import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import { fileURLToPath } from 'node:url'

export default tseslint.config({
  files: ['frontend/**/*.ts', 'frontend/**/*.tsx', 'scripts/**/*.{ts,mts}', 'tests/**/*.{ts,mts}'],
  extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
  languageOptions: {
    parserOptions: {
      project: './tsconfig.eslint.json',
      tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  linterOptions: {
    noInlineConfig: true,
    reportUnusedDisableDirectives: 'error',
  },
}, {
  files: ['frontend/src/App.tsx'],
  rules: {
    '@typescript-eslint/no-floating-promises': 'off',
    '@typescript-eslint/no-unnecessary-type-conversion': 'off',
    '@typescript-eslint/restrict-template-expressions': 'off',
  },
}, {
  files: ['frontend/eslint.config.mjs'],
  rules: js.configs.recommended.rules,
  languageOptions: { globals: { process: 'readonly', URL: 'readonly' } },
  linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
})
