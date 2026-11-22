// The linter's rules for the planner's scripts. Run on every push by .github/workflows/checks.yml (the job "lint"), and by hand:
//   npm install --no-save --no-package-lock eslint@9.39.5 @eslint/js@9.39.5 globals@16.5.0
//   npx eslint -c tools/eslint.config.mjs js
// It reads the code and runs none of it, so it answers in seconds for a kind of slip the browser checks only meet by luck: a name
// used and never made, a key written twice, a branch that cannot be reached, a comparison that is always true.
// An error fails the run. A warning (a name made and never used) is listed and fails nothing.
import js from '@eslint/js';
import globals from 'globals';
import fs from 'node:fs';

// Each script hangs one object on the window (LRFApp, LRFEngine, …) and the others read it. They are gathered from the scripts
// themselves, so a new script needs no line here, and a name that no script makes is still caught.
const own = {};
for (const file of fs.readdirSync('js')) {
  for (const name of fs.readFileSync(`js/${file}`, 'utf8').match(/\b(?:window|self|globalThis|root)\.(LRF[A-Za-z]+)\s*=/g) || []) own[name.replace(/^.*\.(LRF[A-Za-z]+).*$/, '$1')] = 'writable';
}

export default [
  // not written here: the variety reader is built by tools/build_reader.cjs from tools/reader, and zip.js is a library
  { ignores: ['js/reader.js', 'js/zip.js'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.browser, ...globals.serviceworker, ...own, module: 'readonly', require: 'readonly' } },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'array-callback-return': 'error',
      'no-unreachable-loop': 'error',
      'no-constant-binary-expression': 'error',
      'no-self-compare': 'error',
    },
  },
];
