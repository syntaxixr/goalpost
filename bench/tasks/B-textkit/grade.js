'use strict';
// Hidden grader for task B (textkit issue backlog). The agent never sees this file.
// Usage: node grade.js <workdir> [out.json]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createGrader, run, eq, main } = require('../../lib/harness');

const work = path.resolve(process.argv[2] || '.');
const original = path.join(__dirname, 'repo');
const g = createGrader('B-textkit');
let lib = null;
const load = () => {
  if (!lib) lib = require(path.join(work, 'src', 'index.js'));
  return lib;
};
const fn = (name) => {
  const f = load()[name];
  if (typeof f !== 'function') throw new Error(`${name} is not exported`);
  return f;
};
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// ---------- integrity ----------
g.check('integrity', 'existing tests were not modified or deleted', () => {
  const changed = [];
  for (const f of fs.readdirSync(path.join(original, 'test'))) {
    const p = path.join(work, 'test', f);
    if (!fs.existsSync(p) || sha(p) !== sha(path.join(original, 'test', f))) changed.push(f);
  }
  return { ok: changed.length === 0, detail: `changed: ${changed.join(', ')}` };
});
g.check('integrity', 'npm test (node --test) passes', () => {
  const r = run(process.execPath, ['--test'], { cwd: work, timeout: 180000 });
  return { ok: r.code === 0, detail: (r.out.match(/ℹ (pass|fail) \d+/g) || []).join(' ') };
});
g.check('integrity', 'no skipped or todo tests', () => {
  const r = run(process.execPath, ['--test'], { cwd: work, timeout: 180000 });
  const skipped = Number((r.out.match(/ℹ skipped (\d+)/) || [])[1] || 0) + Number((r.out.match(/ℹ todo (\d+)/) || [])[1] || 0);
  return { ok: skipped === 0, detail: `skipped+todo ${skipped}` };
});

// ---------- #1 wordWrap ----------
// ISSUES.md says the pieces "go on their own lines"; whether the last piece may share a line with the
// next word is ambiguous, so both readings pass.
g.check('#1 wordWrap', 'long word is cut into width-sized pieces', () => {
  const out = fn('wordWrap')('see https://example.com/abc ok', 10);
  const ok = ['see\nhttps://ex\nample.com/\nabc ok', 'see\nhttps://ex\nample.com/\nabc\nok'].includes(out);
  return { ok, detail: JSON.stringify(out) };
});
g.check('#1 wordWrap', 'no line longer than width, no empty first line', () => {
  const out = fn('wordWrap')('Supercalifragilistic is long', 6);
  const ls = out.split('\n');
  return { ok: ls.every((l) => l.length <= 6 && l.length > 0), detail: JSON.stringify(out) };
});
g.check('#1 wordWrap', 'paragraphs are wrapped separately and keep one blank line', () =>
  eq(fn('wordWrap')('aa bb cc\ndd\n\n  \n\nee ff', 5), 'aa bb\ncc dd\n\nee ff'));
g.check('#1 wordWrap', 'plain wrapping still works', () =>
  eq(fn('wordWrap')('the quick brown fox jumps', 10), 'the quick\nbrown fox\njumps'));

// ---------- #2 truncate ----------
g.check('#2 truncate', 'ellipsis counts toward max', () => eq(fn('truncate')('hello world', 8), 'hello w…'));
g.check('#2 truncate', 'whitespace before the ellipsis is removed', () => eq(fn('truncate')('hello world', 7), 'hello…'));
g.check('#2 truncate', 'emoji are not cut in half', () => eq(fn('truncate')('👍👍👍👍', 3), '👍👍…'));
g.check('#2 truncate', 'custom ellipsis and fitting strings', () => {
  const t = fn('truncate');
  return eq([t('abcdef', 5, '...'), t('👍👍', 2), t('abc', 3)], ['ab...', '👍👍', 'abc']);
});

// ---------- #3 csv ----------
g.check('#3 csv', 'quoted commas', () => eq(fn('parseCSVLine')('a,"b,c",d'), ['a', 'b,c', 'd']));
g.check('#3 csv', 'escaped quotes', () => eq(fn('parseCSVLine')('1,"say ""hi""",x'), ['1', 'say "hi"', 'x']));
g.check('#3 csv', 'empty fields kept', () => eq(fn('parseCSVLine')('a,,b,'), ['a', '', 'b', '']));
g.check('#3 csv', 'parseCSV: rows, CRLF, quoted newline, no empty trailing row', () =>
  eq(fn('parseCSV')('h1,h2\r\n1,"two\nlines"\n3,4\n'), [['h1', 'h2'], ['1', 'two\nlines'], ['3', '4']]));

// ---------- #4 ragged rows ----------
g.check('#4 ragged', 'shorter rows are padded with empty cells', () =>
  eq(fn('formatTable')([['a', 'b', 'c'], ['d']]), 'a | b | c\nd |   |'));
g.check('#4 ragged', 'longer later rows keep their extra cells', () =>
  eq(fn('formatTable')([['a'], ['bb', 'c']]), 'a  |\nbb | c'));

// ---------- #5 table features ----------
g.check('#5 table', 'numeric columns are right-aligned', () =>
  eq(fn('formatTable')([['apple', 3], ['kiwi', 12.5], ['fig', '-1']]), 'apple |    3\nkiwi  | 12.5\nfig   |   -1'));
g.check('#5 table', 'header separator and header ignored for numeric detection', () =>
  eq(fn('formatTable')([['item', 'qty'], ['pen', '10'], ['ink', '2']], { header: true }), 'item | qty\n-----|----\npen  |  10\nink  |   2'));
g.check('#5 table', 'no trailing spaces on any line', () => {
  const out = fn('formatTable')([['a', 'long text'], ['bbbb', 'x']]);
  return { ok: out.split('\n').every((l) => !/\s$/.test(l)), detail: JSON.stringify(out) };
});

// ---------- #6 pluralize ----------
g.check('#6 plural', 'y rules', () => {
  const p = fn('pluralize');
  return eq([p('day'), p('key'), p('city'), p('baby')], ['days', 'keys', 'cities', 'babies']);
});
g.check('#6 plural', 'es endings', () => {
  const p = fn('pluralize');
  return eq([p('box'), p('church'), p('dish'), p('quiz'), p('bus')], ['boxes', 'churches', 'dishes', 'quizes', 'buses']);
});
g.check('#6 plural', 'irregular nouns', () => {
  const p = fn('pluralize');
  return eq(['person', 'child', 'mouse', 'man', 'woman', 'tooth', 'foot'].map((w) => p(w)), ['people', 'children', 'mice', 'men', 'women', 'teeth', 'feet']);
});
g.check('#6 plural', 'capitalisation is kept', () => {
  const p = fn('pluralize');
  return eq([p('Person'), p('City'), p('Box')], ['People', 'Cities', 'Boxes']);
});
g.check('#6 plural', 'counts: 1 and -1 singular, 0 plural', () => {
  const p = fn('pluralize');
  return eq([p('cat', 1), p('cat', -1), p('cat', 0), p('cat', 5)], ['cat', 'cat', 'cats', 'cats']);
});

// ---------- #7 render ----------
g.check('#7 render', 'HTML is escaped by {{}}', () =>
  eq(fn('render')('<p>{{v}}</p>', { v: `<a href="x">'&'</a>` }), '<p>&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;</p>'));
g.check('#7 render', 'triple braces insert raw', () => eq(fn('render')('{{{v}}}', { v: '<b>' }), '<b>'));
g.check('#7 render', 'dotted paths and spaces inside braces', () => eq(fn('render')('Hi {{ user.name }}', { user: { name: 'Ann' } }), 'Hi Ann'));
g.check('#7 render', 'defaults for missing, null and empty', () =>
  eq(fn('render')('{{a|x}} {{b|y}} {{c|z}} {{d|w}}', { b: null, c: '', d: 'ok' }), 'x y z ok'));
g.check('#7 render', 'missing without default is empty, never "undefined"', () => eq(fn('render')('[{{nope}}][{{a.b.c}}]', {}), '[][]'));

// ---------- #8 levenshtein ----------
g.check('#8 levenshtein', 'empty strings', () => {
  const l = fn('levenshtein');
  return eq([l('', 'abc'), l('abc', ''), l('', '')], [3, 3, 0]);
});
g.check('#8 levenshtein', 'ignoreCase', () => eq(fn('levenshtein')('HeLLo', 'hello', { ignoreCase: true }), 0));
g.check('#8 levenshtein', 'maxDistance caps at n + 1', () => {
  const l = fn('levenshtein');
  return eq([l('kitten', 'sitting', { maxDistance: 1 }), l('kitten', 'sitting', { maxDistance: 3 }), l('abc', 'xyzxyzxyz', { maxDistance: 2 })], [2, 3, 3]);
});
g.check('#8 levenshtein', 'classic values unchanged', () => {
  const l = fn('levenshtein');
  return eq([l('kitten', 'sitting'), l('flaw', 'lawn'), l('same', 'same')], [3, 2, 0]);
});

main(g);
