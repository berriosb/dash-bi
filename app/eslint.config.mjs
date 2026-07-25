import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const customRules = require('./.eslint-rules/no-raw-db-queries.cjs');

export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'drizzle/**',
      'src/generated/**',
      'worker/**',
      'scripts/postgres/**',
      '*.config.{js,mjs,ts}',
      'eslint.config.mjs',
    ],
  },
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        React: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      'dash-bi': customRules,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      'dash-bi/no-raw-db-queries': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-undef': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-redeclare': 'off',
      'jsx-a11y/click-events-have-key-events': 'warn',
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/heading-has-content': 'warn',
      '@typescript-eslint/consistent-type-imports': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react/prop-types': 'off',
      'react/display-name': 'off',
    },
  },
  {
    files: ['src/app/api/**/*.ts'],
    rules: {
      'dash-bi/no-raw-db-queries': 'error',
    },
  },
  {
    files: ['scripts/**/*.ts', 'tests/**/*.ts', '*.config.{js,mjs,ts}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'jsx-a11y/heading-has-content': 'off',
    },
  },
  {
    files: ['src/app/api/auth/[...all]/route.ts', 'src/lib/auth/**/*'],
    rules: {
      'no-redeclare': 'off',
    },
  },
];