'use strict';
// Hidden grader for task A (ledger). The agent never sees this file.
// Usage: node grade.js <workdir> [out.json]
const fs = require('fs');
const path = require('path');
const { createGrader, tmpDir, run, lines, eq, main } = require('../../lib/harness');

const work = path.resolve(process.argv[2] || '.');
const BIN = path.join(work, 'bin', 'ledger.js');
const g = createGrader('A-ledger');

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function thisMonth() { return today().slice(0, 7); }

// A fresh ledger file per scenario; `L(...args)` runs the CLI against it.
function scenario() {
  const dir = tmpDir('ledger-');
  const file = path.join(dir, 'data.json');
  const L = (...args) => run(process.execPath, [BIN, ...args, '--file', file], { cwd: dir });
  return { dir, file, L };
}
function listJson(L) {
  const r = L('list', '--json');
  return JSON.parse(r.out);
}

// ---------- structure ----------
g.check('structure', 'bin/ledger.js exists', () => fs.existsSync(BIN));
g.check('structure', 'package.json has no dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(work, 'package.json'), 'utf8'));
  return !Object.keys(pkg.dependencies || {}).length;
});
g.check('structure', 'own test suite passes with node --test', () => {
  const r = run(process.execPath, ['--test'], { cwd: work, timeout: 180000 });
  const tests = (r.out.match(/ℹ tests (\d+)/) || [])[1];
  return { ok: r.code === 0 && Number(tests) >= 1, detail: `exit ${r.code}, tests ${tests}` };
});
g.check('structure', 'README documents every command', () => {
  const readme = fs.readFileSync(path.join(work, 'README.md'), 'utf8').toLowerCase();
  const missing = ['add', 'list', 'balance', 'delete', 'edit', 'budget', 'import', 'export', 'report', 'undo'].filter((c) => !new RegExp(`\\b${c}\\b`).test(readme));
  return { ok: !missing.length, detail: `missing: ${missing.join(',')}` };
});

// ---------- add ----------
g.check('add', 'add prints "added #1" and stores the transaction', () => {
  const { L } = scenario();
  const r = L('add', '-12.5', 'Food', '--date', '2025-01-10', '--note', 'lunch');
  if (r.code !== 0 || r.out.trim() !== 'added #1') return { ok: false, detail: `${r.code} ${r.out} ${r.err}` };
  return eq(lines(L('list').out), ['#1 2025-01-10 -12.50 food lunch']);
});
g.check('add', 'more than 2 decimals is rejected with exit 2', () => {
  const { L } = scenario();
  const r = L('add', '1.234', 'x', '--date', '2025-01-01');
  return { ok: r.code === 2 && lines(L('list').out).length === 0, detail: `exit ${r.code}` };
});
g.check('add', 'non-numeric amount is rejected with exit 2', () => {
  const { L } = scenario();
  return L('add', 'abc', 'x').code === 2;
});
g.check('add', 'empty category is rejected with exit 2', () => {
  const { L } = scenario();
  return L('add', '5', '   ').code === 2;
});
g.check('add', 'impossible date is rejected with exit 2', () => {
  const { L } = scenario();
  return L('add', '5', 'x', '--date', '2025-02-30').code === 2;
});
g.check('add', 'date defaults to today, "+3.99" accepted, category trimmed+lowercased', () => {
  const { L } = scenario();
  L('add', '+3.99', '  Misc ');
  return eq(listJson(L), [{ id: 1, date: today(), amount: 3.99, category: 'misc', note: '' }]);
});
g.check('add', 'repeat monthly keeps day of month, clamps to month end', () => {
  const { L } = scenario();
  const r = L('add', '-100', 'rent', '--date', '2025-01-31', '--repeat', 'monthly', '--times', '3');
  if (r.out.trim() !== 'added #1..#3') return { ok: false, detail: r.out + r.err };
  return eq(listJson(L).map((t) => t.date), ['2025-01-31', '2025-02-28', '2025-03-31']);
});
g.check('add', 'repeat handles leap years', () => {
  const { L } = scenario();
  L('add', '-1', 'x', '--date', '2024-01-31', '--repeat', 'monthly', '--times', '2');
  return eq(listJson(L).map((t) => t.date), ['2024-01-31', '2024-02-29']);
});
g.check('add', 'ids are never reused after delete', () => {
  const { L } = scenario();
  L('add', '1', 'a', '--date', '2025-01-01');
  L('add', '2', 'a', '--date', '2025-01-01');
  L('delete', '2');
  return L('add', '3', 'a', '--date', '2025-01-01').out.trim() === 'added #3';
});

// ---------- money ----------
g.check('money', '0.1 + 0.2 = 0.30', () => {
  const { L } = scenario();
  L('add', '0.1', 'a', '--date', '2025-01-01');
  L('add', '0.2', 'a', '--date', '2025-01-01');
  return eq(L('balance').out.trim(), 'balance: 0.30');
});
g.check('money', 'amounts stored as integer cents in the file', () => {
  const { L, file } = scenario();
  L('add', '-12.5', 'a', '--date', '2025-01-01');
  const text = fs.readFileSync(file, 'utf8');
  return { ok: /-1250\b/.test(text) && !/-12\.5\b/.test(text), detail: text.slice(0, 200) };
});

// ---------- list ----------
function seeded() {
  const s = scenario();
  s.L('add', '-20', 'Food', '--date', '2025-03-05', '--note', 'pizza night');
  s.L('add', '1000', 'Salary', '--date', '2025-03-01');
  s.L('add', '-5', 'Food', '--date', '2025-03-01', '--note', 'coffee');
  s.L('add', '-60', 'Transport', '--date', '2025-02-20');
  return s;
}
g.check('list', 'sorted by date, then id; no trailing space without note', () => {
  const { L } = seeded();
  return eq(lines(L('list').out), [
    '#4 2025-02-20 -60.00 transport',
    '#2 2025-03-01 1000.00 salary',
    '#3 2025-03-01 -5.00 food coffee',
    '#1 2025-03-05 -20.00 food pizza night',
  ]);
});
g.check('list', '--category filter', () => {
  const { L } = seeded();
  return eq(listJson(L).length && JSON.parse(L('list', '--category', 'food', '--json').out).map((t) => t.id), [3, 1]);
});
g.check('list', '--from/--to are inclusive', () => {
  const { L } = seeded();
  return eq(JSON.parse(L('list', '--from', '2025-03-01', '--to', '2025-03-01', '--json').out).map((t) => t.id), [2, 3]);
});
g.check('list', '--json shape and units', () => {
  const { L } = seeded();
  return eq(listJson(L)[0], { id: 4, date: '2025-02-20', amount: -60, category: 'transport', note: '' });
});

// ---------- balance ----------
g.check('balance', 'balance is the sum', () => {
  const { L } = seeded();
  return eq(L('balance').out.trim(), 'balance: 915.00');
});
g.check('balance', '--by-category sorted ascending, ties by name', () => {
  const { L } = seeded();
  L('add', '-25', 'books', '--date', '2025-03-02');
  return eq(lines(L('balance', '--by-category').out), ['transport: -60.00', 'books: -25.00', 'food: -25.00', 'salary: 1000.00']);
});

// ---------- delete / edit ----------
g.check('delete', 'delete prints "deleted #id" and removes it', () => {
  const { L } = seeded();
  const r = L('delete', '3');
  return { ok: r.out.trim() === 'deleted #3' && !listJson(L).some((t) => t.id === 3), detail: r.out + r.err };
});
g.check('delete', 'unknown id → exit 2', () => {
  const { L } = seeded();
  return L('delete', '99').code === 2;
});
g.check('edit', 'edit changes only the given fields', () => {
  const { L } = seeded();
  const r = L('edit', '1', '--amount', '-22.75');
  const t = listJson(L).find((x) => x.id === 1);
  return { ok: r.out.trim() === 'updated #1' && t.amount === -22.75 && t.note === 'pizza night' && t.category === 'food', detail: r.out + JSON.stringify(t) };
});
g.check('edit', 'edit validates like add (bad date → exit 2, unchanged)', () => {
  const { L } = seeded();
  const r = L('edit', '1', '--date', '2025-13-01');
  return r.code === 2 && listJson(L).find((x) => x.id === 1).date === '2025-03-05';
});
g.check('edit', 'edit unknown id → exit 2', () => {
  const { L } = seeded();
  return L('edit', '42', '--note', 'x').code === 2;
});

// ---------- budget ----------
g.check('budget', 'budget set prints "budget <cat> <amount>"', () => {
  const { L } = scenario();
  return eq(L('budget', 'set', 'Food', '100').out.trim(), 'budget food 100.00');
});
g.check('budget', 'budget status per month, sorted, "!" when over', () => {
  const { L } = seeded();
  L('add', '-100', 'food', '--date', '2025-03-10');
  L('budget', 'set', 'food', '100');
  L('budget', 'set', 'transport', '50');
  return eq(lines(L('budget', 'status', '--month', '2025-03').out), [
    'food spent 125.00 of 100.00 left -25.00 !',
    'transport spent 0.00 of 50.00 left 50.00',
  ]);
});
g.check('budget', 'budget status defaults to the current month', () => {
  const { L } = scenario();
  L('add', '-30', 'fun', '--date', `${thisMonth()}-01`);
  L('budget', 'set', 'fun', '40');
  return eq(lines(L('budget', 'status').out), ['fun spent 30.00 of 40.00 left 10.00']);
});
g.check('budget', 'negative budget → exit 2', () => {
  const { L } = scenario();
  return L('budget', 'set', 'x', '-5').code === 2;
});

// ---------- import ----------
g.check('import', 'quoted fields with commas and "" quotes', () => {
  const { L, dir } = scenario();
  const csv = path.join(dir, 'in.csv');
  fs.writeFileSync(csv, 'date,amount,category,note\n2025-04-01,-9.99,Books,"Dune, part 2"\n2025-04-02,50,gift,"he said ""hi"""\n');
  const r = L('import', csv);
  const t = listJson(L);
  return { ok: r.code === 0 && r.out.trim() === 'imported 2' && t[0].note === 'Dune, part 2' && t[1].note === 'he said "hi"' && t[0].category === 'books', detail: r.out + r.err + JSON.stringify(t) };
});
g.check('import', 'invalid rows reported as "line <n>: ..." on stderr, exit 1', () => {
  const { L, dir } = scenario();
  const csv = path.join(dir, 'in.csv');
  fs.writeFileSync(csv, 'date,amount,category,note\n2025-04-01,-1,a,\n2025-04-31,-2,a,\n2025-04-03,abc,a,\n2025-04-04,-4,a,ok\n');
  const r = L('import', csv);
  const errLines = lines(r.err).filter((l) => /^line \d+:/.test(l)).map((l) => l.split(':')[0]);
  return { ok: r.code === 1 && r.out.trim() === 'imported 2' && JSON.stringify(errLines) === JSON.stringify(['line 3', 'line 4']), detail: `${r.code} ${r.out} ${r.err}` };
});

// ---------- export ----------
g.check('export', 'json export equals list --json', () => {
  const { L } = seeded();
  return eq(JSON.parse(L('export', '--format', 'json').out), listJson(L));
});
g.check('export', 'csv export with header, 2 decimals, quoting', () => {
  const { L } = scenario();
  L('add', '-5', 'food', '--date', '2025-01-02', '--note', 'a, b');
  return eq(lines(L('export', '--format', 'csv').out), ['id,date,amount,category,note', '1,2025-01-02,-5.00,food,"a, b"']);
});

// ---------- report ----------
g.check('report', 'monthly report lines', () => {
  const { L } = seeded();
  L('add', '-20', 'books', '--date', '2025-03-03');
  return eq(lines(L('report', '--month', '2025-03').out), [
    'month: 2025-03', 'income: 1000.00', 'expenses: 45.00', 'net: 955.00', 'top: food 25.00, books 20.00',
  ]);
});
g.check('report', '"top: none" without expenses', () => {
  const { L } = scenario();
  L('add', '10', 'gift', '--date', '2025-05-05');
  return eq(lines(L('report', '--month', '2025-05').out).pop(), 'top: none');
});

// ---------- undo ----------
g.check('undo', 'undo reverts an add', () => {
  const { L } = seeded();
  L('add', '-1', 'oops', '--date', '2025-03-09');
  const r = L('undo');
  return { ok: r.out.trim() === 'undone' && listJson(L).length === 4, detail: r.out + r.err };
});
g.check('undo', 'undo reverts a delete', () => {
  const { L } = seeded();
  L('delete', '2');
  L('undo');
  return listJson(L).some((t) => t.id === 2 && t.amount === 1000);
});
g.check('undo', 'nothing to undo → exit 1', () => {
  const { L } = scenario();
  const r = L('undo');
  return { ok: r.code === 1 && /nothing to undo/.test(r.out + r.err), detail: `${r.code} ${r.out} ${r.err}` };
});

// ---------- cli ----------
g.check('cli', '--help names every command', () => {
  const r = run(process.execPath, [BIN, '--help'], { cwd: work });
  const text = (r.out + r.err).toLowerCase();
  const missing = ['add', 'list', 'balance', 'delete', 'edit', 'budget', 'import', 'export', 'report', 'undo'].filter((c) => !text.includes(c));
  return { ok: r.code === 0 && !missing.length, detail: `exit ${r.code} missing ${missing}` };
});
g.check('cli', 'unknown command → exit 2 with a message on stderr', () => {
  const { L } = scenario();
  const r = L('frobnicate');
  return r.code === 2 && r.err.trim().length > 0;
});
g.check('cli', 'default file is ledger.json in the cwd', () => {
  const dir = tmpDir('ledger-cwd-');
  run(process.execPath, [BIN, 'add', '7', 'x', '--date', '2025-01-01'], { cwd: dir });
  return fs.existsSync(path.join(dir, 'ledger.json'));
});
g.check('cli', '--file works anywhere after the command', () => {
  const { dir } = scenario();
  const f = path.join(dir, 'other.json');
  run(process.execPath, [BIN, 'add', '--file', f, '7', 'x', '--date', '2025-01-01'], { cwd: dir });
  const r = run(process.execPath, [BIN, 'list', '--file', f, '--json'], { cwd: dir });
  return { ok: r.code === 0 && JSON.parse(r.out).length === 1, detail: r.out + r.err };
});
g.check('cli', 'no temp files left behind (atomic write)', () => {
  if (!fs.existsSync(BIN)) return { ok: false, detail: 'no CLI' };
  const { L, dir } = seeded();
  L('edit', '1', '--note', 'x');
  const left = fs.readdirSync(dir).filter((f) => !['data.json'].includes(f) && !/\.csv$/.test(f));
  return { ok: left.length === 0 || left.every((f) => /undo|history|backup/i.test(f)), detail: left.join(',') };
});

// ---------- library ----------
g.check('library', 'Ledger class: add/list/balance/update/remove persist to file', () => {
  const dir = tmpDir('ledger-lib-');
  const file = path.join(dir, 'lib.json');
  const { Ledger } = require(path.join(work, 'src', 'ledger.js'));
  const l = new Ledger(file);
  const t = l.add({ amount: -5.25, category: 'Food', date: '2025-01-01', note: '' });
  if (!t || t.id !== 1 || t.amount !== -5.25) return { ok: false, detail: JSON.stringify(t) };
  l.add({ amount: 10, category: 'x', date: '2025-01-02', note: 'n' });
  if (l.balance() !== 4.75) return { ok: false, detail: `balance ${l.balance()}` };
  l.update(1, { note: 'changed' });
  l.remove(2);
  const fresh = new Ledger(file).list({});
  return eq(fresh, [{ id: 1, date: '2025-01-01', amount: -5.25, category: 'food', note: 'changed' }]);
});
g.check('library', 'list() filters by category and dates', () => {
  const dir = tmpDir('ledger-lib2-');
  const { Ledger } = require(path.join(work, 'src', 'ledger.js'));
  const l = new Ledger(path.join(dir, 'x.json'));
  l.add({ amount: -1, category: 'a', date: '2025-01-01', note: '' });
  l.add({ amount: -2, category: 'b', date: '2025-01-05', note: '' });
  l.add({ amount: -3, category: 'a', date: '2025-01-09', note: '' });
  return eq(l.list({ category: 'a', from: '2025-01-02' }).map((t) => t.id), [3]);
});

main(g);
