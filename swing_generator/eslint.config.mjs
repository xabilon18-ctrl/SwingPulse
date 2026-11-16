// Front-end lint: real bugs only, no style. Run from swing_generator/:
//   npx --yes -p eslint@9.39.1 -p @eslint/js@9.39.1 -p globals@16.5.0 eslint
// CI runs it in test.yml.
import js from '@eslint/js';
import globals from 'globals';

export default [
  // The Scriptable lock-screen widget: top-level await, Scriptable's globals.
  { files: ['ios-widget/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest', sourceType: 'module',
      globals: { args: 'readonly', config: 'readonly', Script: 'readonly', ListWidget: 'readonly', Font: 'readonly',
                 Color: 'readonly', Request: 'readonly', FileManager: 'readonly' },
    },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] } },
  { files: ['webapp/static/js/**/*.js', 'webapp/static/sw.js'],
    languageOptions: {
      ecmaVersion: 'latest', sourceType: 'script',
      // SPTrendContext: set on window by modules/trend-context.js.
      globals: { ...globals.browser, ...globals.serviceworker, module: 'readonly', SPTrendContext: 'readonly' },
    },
    rules: {
      ...js.configs.recommended.rules,
      // An empty catch is allowed only for storage / pointer-capture guards that
      // legitimately throw (private mode). Real failures go to reportFailure().
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Unused names FAIL (2026-11-16, user: "set it up"). As a warning they
      // never failed CI (test.yml runs eslint --quiet, which hides warnings),
      // and 77 piled up unseen until the audit removed them in #219.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      // `(list.find(...) || [, fallback])[1]` is used on purpose.
      'no-sparse-arrays': 'off',
    } },
];
