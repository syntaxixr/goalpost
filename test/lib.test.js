'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { globToRegExp, matchAny, relToRoot } = require('../plugin/scripts/lib/util');
const { parseSpec, tampered, snapshot, setChecks } = require('../plugin/scripts/lib/spec');
const { scanGoalStatus, classify } = require('../plugin/scripts/lib/transcript');
const { criteriaStatus } = require('../plugin/scripts/lib/evidence');
const { shellModifies, shellWritesTo, redirectTargets, writeTargets } = require('../plugin/scripts/lib/protect');
const { errorSignature, GOAL_RE } = require('../plugin/scripts/hook');

test('globs: gitignore-style matching', () => {
  assert.ok(matchAny('test/a.js', ['**/test/**']));
  assert.ok(matchAny('pkg/test/deep/a.js', ['**/test/**']));
  assert.ok(matchAny('src/add.test.js', ['**/*.test.*']));
  assert.ok(matchAny('add.test.ts', ['**/*.test.*']));
  assert.ok(matchAny('tests/test_api.py', ['**/test_*.py']));
  assert.ok(matchAny('a/b/conftest.py', ['conftest.py']));
  assert.ok(matchAny('fixtures/x/y.json', ['fixtures/']));
  assert.ok(!matchAny('src/latest.js', ['**/test/**', '**/*.test.*']));
  assert.ok(!matchAny('src/contest.py', ['**/test_*.py']));
  assert.ok(globToRegExp('{a,b}.js').test('b.js'));
});

test('relToRoot gives forward-slash relative paths', () => {
  const root = path.join(os.tmpdir(), 'proj');
  assert.equal(relToRoot(root, path.join(root, 'src', 'a.js')), 'src/a.js');
  assert.equal(relToRoot(root, 'src/a.js'), 'src/a.js');
  assert.ok(relToRoot(root, path.join(os.tmpdir(), 'other', 'x')).startsWith('../'));
});

test('spec: criteria, verify lines, manual, sections', () => {
  const spec = parseSpec(`# Goal
Build the thing

## Acceptance criteria
- [ ] AC-1: health endpoint returns 200
  - Verify: \`npm test -- health\`
- [x] **AC-2**: README has setup steps
  - Verify: manual — follow the README
* [ ] AC-3: inline form — Verify: \`node check.js\`
- [ ] AC-4: no verify line

## Protected
- test/fixtures/**
- \`scripts/check.sh\` — the grader

## Test changes
- test/legacy.test.js: API removed on purpose

## Spec changes
- AC-9: dropped, client said so
`);
  assert.deepEqual(spec.criteria.map((c) => c.id), ['AC-1', 'AC-2', 'AC-3', 'AC-4']);
  assert.equal(spec.criteria[0].verify, 'npm test -- health');
  assert.equal(spec.criteria[1].checked, true);
  assert.equal(spec.criteria[1].manual, true);
  assert.equal(spec.criteria[2].verify, 'node check.js');
  assert.equal(spec.criteria[2].text, 'inline form');
  assert.equal(spec.criteria[3].verify, null);
  assert.deepEqual(spec.protected, ['test/fixtures/**', 'scripts/check.sh']);
  assert.deepEqual(spec.testChanges, ['test/legacy.test.js']);
  assert.match(spec.specChanges, /AC-9/);
  assert.equal(spec.goal, 'Build the thing');
});

test('spec: duplicates are reported', () => {
  const spec = parseSpec('- [ ] AC-1: a\n  - Verify: `x`\n- [ ] AC-1: b\n  - Verify: `y`\n');
  assert.deepEqual(spec.duplicates, ['AC-1']);
});

test('spec: tampering with frozen criteria is detected unless explained', () => {
  const before = parseSpec('- [ ] AC-1: add works\n  - Verify: `npm test`\n- [ ] AC-2: docs\n  - Verify: `test -f README.md`\n');
  const frozen = snapshot(before);
  // ticking boxes and adding criteria is fine
  const ok = parseSpec('- [x] AC-1: add works\n  - Verify: `npm test`\n- [ ] AC-2: docs\n  - Verify: `test -f README.md`\n- [ ] AC-3: new\n  - Verify: `true`\n');
  assert.deepEqual(tampered(frozen, ok), []);
  // weakening a check is not
  const weak = parseSpec('- [x] AC-1: add works\n  - Verify: `true`\n- [ ] AC-2: docs\n  - Verify: `test -f README.md`\n');
  assert.deepEqual(tampered(frozen, weak).map((t) => [t.id, t.kind]), [['AC-1', 'verify-changed']]);
  // removing one is not
  const removed = parseSpec('- [x] AC-1: add works\n  - Verify: `npm test`\n');
  assert.deepEqual(tampered(frozen, removed).map((t) => [t.id, t.kind]), [['AC-2', 'removed']]);
  // ...unless "## Spec changes" names it
  const explained = parseSpec('- [x] AC-1: add works\n  - Verify: `npm test`\n\n## Spec changes\n- AC-2: docs moved to the wiki by request\n');
  assert.deepEqual(tampered(frozen, explained), []);
});

test('spec: setChecks flips only the named boxes', () => {
  const text = '- [ ] AC-1: a\n  - Verify: `x`\n- [x] AC-2: b\n  - Verify: `y`\r\n- [ ] AC-3: c\n';
  const out = setChecks(text, { 'AC-1': true, 'AC-2': false });
  assert.equal(out, '- [x] AC-1: a\n  - Verify: `x`\n- [ ] AC-2: b\n  - Verify: `y`\r\n- [ ] AC-3: c\n');
});

test('transcript: goal_status records are classified and read incrementally', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gp-tr-')), 't.jsonl');
  const rec = (att) => JSON.stringify({ type: 'attachment', timestamp: 't', attachment: Object.assign({ type: 'goal_status' }, att) }) + '\n';
  fs.writeFileSync(f, JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n' + rec({ met: false, sentinel: true, condition: 'X' }));
  let r = scanGoalStatus(f, 0);
  assert.deepEqual(r.records.map((x) => x.kind), ['set']);
  fs.appendFileSync(f, rec({ met: true, condition: 'X', reason: 'looks done' }) + '{"partial":');
  const r2 = scanGoalStatus(f, r.offset);
  assert.deepEqual(r2.records.map((x) => [x.kind, x.reason]), [['met', 'looks done']]);
  fs.appendFileSync(f, '1}\n' + rec({ met: true, sentinel: true, condition: 'X' }) + rec({ met: false, failed: true, reason: 'nope' }));
  const r3 = scanGoalStatus(f, r2.offset);
  assert.deepEqual(r3.records.map((x) => x.kind), ['cleared', 'failed']);
  assert.equal(classify({ type: 'goal_status', met: false }), 'not_met');
  assert.deepEqual(scanGoalStatus(path.join(os.tmpdir(), 'nope-does-not-exist.jsonl'), 0).records, []);
});

test('evidence: pass / fail / stale / changed / never', () => {
  const crit = parseSpec('- [ ] AC-1: a\n  - Verify: `a`\n- [ ] AC-2: b\n  - Verify: `b`\n- [ ] AC-3: c\n  - Verify: `c`\n- [ ] AC-4: d\n  - Verify: `d2`\n- [ ] AC-5: e\n  - Verify: `e`\n').criteria;
  const t = (ms) => new Date(ms).toISOString();
  const ev = [
    { kind: 'verify', id: 'AC-1', cmd: 'a', exit: 0, start: t(2000) },
    { kind: 'verify', id: 'AC-2', cmd: 'b', exit: 1, start: t(2000) },
    { kind: 'verify', id: 'AC-3', cmd: 'c', exit: 0, start: t(500) },
    { kind: 'verify', id: 'AC-4', cmd: 'd', exit: 0, start: t(2000) },
  ];
  const st = criteriaStatus(crit, ev, { lastEditAt: 1000, startedMs: 100 });
  assert.deepEqual(Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v.status])), {
    'AC-1': 'pass', 'AC-2': 'fail', 'AC-3': 'stale', 'AC-4': 'changed', 'AC-5': 'never',
  });
});

test('shell heuristics: what counts as modifying files', () => {
  assert.ok(shellModifies('echo hi > src/a.js'));
  assert.ok(shellModifies('sed -i s/a/b/ src/x.js'));
  assert.ok(shellModifies('rm -rf build'));
  assert.ok(shellModifies("cat > src/x.ts <<'EOF'\nx\nEOF"));
  assert.ok(!shellModifies('npm test 2>&1 | tail -20'));
  assert.ok(!shellModifies('node .goal/verify.js AC-1 2>&1'));
  assert.ok(!shellModifies('ls -la > /dev/null'));
  assert.ok(!shellModifies('echo done >> .goal/PROGRESS.md'));
  assert.ok(!shellModifies('git status && git diff'));
  assert.deepEqual(redirectTargets('a 2>&1 > out.txt 2>/dev/null'), ['out.txt']);
  assert.ok(shellWritesTo('echo {} >> .goal/evidence.log', '.goal/evidence.log'));
  assert.ok(shellWritesTo('rm test/add.test.js', 'test/add.test.js'));
  assert.ok(shellWritesTo("sed -i 's/5/6/' add.test.js", 'test/add.test.js'));
  assert.ok(!shellWritesTo('cat test/add.test.js', 'test/add.test.js'));
  assert.ok(!shellWritesTo('node .goal/verify.js 2>&1 | tail -5', '.goal/verify.js'));
  assert.ok(!shellWritesTo('npx jest test/add.test.js > out.txt', 'test/add.test.js'));
});

test('shell heuristics: file contents are not commands (no false positives)', () => {
  const heredoc = "cat > .goal/SPEC.md <<'EOF'\n- Verify: `node .goal/verify.js` and rm test/add.test.js\nevidence.log > state.json\nEOF";
  assert.deepEqual(writeTargets(heredoc), ['.goal/SPEC.md']);
  assert.ok(!shellWritesTo(heredoc, '.goal/evidence.log'));
  assert.ok(!shellWritesTo(heredoc, 'test/add.test.js'));
  const inline = "node -e \"const fs=require('fs');fs.writeFileSync('.goal/SPEC.md', s.replace('verify.js','x'))\"";
  assert.ok(!shellWritesTo(inline, '.goal/verify.js'));
  assert.ok(shellWritesTo("node -e \"require('fs').appendFileSync('.goal/evidence.log','{}')\"", '.goal/evidence.log'));
  assert.ok(shellWritesTo("python3 -c \"open('.goal/state.json','w').write('{}')\"", '.goal/state.json'));
  assert.ok(shellWritesTo('rm -f test/*.test.js', 'test/add.test.js'));
  assert.ok(shellWritesTo('git checkout -- test/add.test.js', 'test/add.test.js'));
  assert.ok(shellWritesTo('cp /tmp/x.js test/add.test.js', 'test/add.test.js'));
  assert.ok(!shellWritesTo('cp test/add.test.js /tmp/backup.js', 'test/add.test.js'));
  assert.ok(!shellWritesTo('grep -rn add test/ && npm test', 'test/add.test.js'));
});

test('shell heuristics: PowerShell here-strings and variables are not targets (found by the benchmark)', () => {
  const ps = "$progress = @'\n# Progress\n- AC-1 uses `npm test -- --grep \"<pattern>\"`\n- rm old stuff > later\n'@\nSet-Content -Path .\\.goal\\PROGRESS.md -Value $progress";
  assert.deepEqual(writeTargets(ps), ['.goal/PROGRESS.md']);
  assert.ok(!shellModifies(ps), 'updating PROGRESS.md is bookkeeping, not a code edit');
  assert.ok(!shellModifies('Add-Content C:/proj/.goal/PROGRESS.md "- step done"'));
  assert.ok(!shellModifies('echo "a <b> c" && npm test'));
  assert.ok(shellModifies('Set-Content -Path src/app.js -Value $code'));
  assert.ok(shellWritesTo('Remove-Item -Path test\\add.test.js', 'test/add.test.js'));
});

test('error signatures ignore numbers and paths', () => {
  const a = errorSignature('Bash', 'Exit code 1\nError: Cannot find module \'/home/u/p/src/x.js\'\n    at line 12');
  const b = errorSignature('Bash', 'Exit code 1\nError: Cannot find module \'C:\\Users\\u\\p\\src\\y.js\'\n    at line 40');
  assert.equal(a.sig, b.sig);
  const c = errorSignature('Bash', 'Exit code 2\nSyntaxError: Unexpected token }');
  assert.notEqual(a.sig, c.sig);
});

test('/goal prompt detection', () => {
  assert.equal('/goal ship it'.match(GOAL_RE)[1], 'ship it');
  assert.equal('  /goal   all tests pass \n'.match(GOAL_RE)[1], 'all tests pass');
  assert.equal('/goal'.match(GOAL_RE)[1], undefined);
  assert.equal('/goals are nice'.match(GOAL_RE), null);
  assert.equal('please /goal x'.match(GOAL_RE), null);
});
