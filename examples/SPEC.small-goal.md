# Goal

src/slug.js exports slugify(str) that lowercases, trims, turns runs of non-alphanumerics into single hyphens and strips leading/trailing hyphens; it has tests in test/slug.test.js that pass with `node --test test/`

## Assumptions

- CommonJS module (`module.exports = { slugify }`), no package.json present; Node built-in test runner only.
- "Alphanumeric" means ASCII [a-z0-9] after lowercasing; accented/non-ASCII letters count as non-alphanumeric.
- Non-string input is coerced with String(); null/undefined yield an empty string.

## Milestones

- M1: src/slug.js implemented. M2: test/slug.test.js covers each behavior and passes.

## Acceptance criteria

- [x] AC-1: src/slug.js exports a function slugify
  - Verify: `node -e "const {slugify}=require('./src/slug.js'); if(typeof slugify!=='function') process.exit(1)"`
- [x] AC-2: slugify lowercases, trims, collapses runs of non-alphanumerics into one hyphen, strips leading/trailing hyphens
  - Verify: `node -e "const {slugify:s}=require('./src/slug.js'); const a=require('assert'); a.strictEqual(s('  Hello, World!  '),'hello-world'); a.strictEqual(s('a---b___c   d'),'a-b-c-d'); a.strictEqual(s('--Foo--'),'foo'); a.strictEqual(s('!!!'),''); a.strictEqual(s('Node 20'),'node-20')"`
- [x] AC-3: test/slug.test.js exists and tests pass with `node --test test/`
  - Verify: `node --test test/`

## Protected

<!-- none -->

## Test changes

<!-- none: test file is new -->

## Spec changes

<!-- none -->
