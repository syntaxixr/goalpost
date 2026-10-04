'use strict';
// Hidden grader for task D (minisheet). The agent never sees this file.
// Usage: node grade.js <workdir> [out.json]
const fs = require('fs');
const path = require('path');
const { createGrader, run, main } = require('../../lib/harness');

const work = path.resolve(process.argv[2] || '.');
const g = createGrader('D-sheet');
let SheetClass = null;
const Sheet = () => {
  if (!SheetClass) SheetClass = require(path.join(work, 'src', 'sheet.js')).Sheet;
  if (typeof SheetClass !== 'function') throw new Error('Sheet is not exported');
  return SheetClass;
};
// Build a sheet from {ref: input}.
function S(cells = {}) {
  const s = new (Sheet())();
  for (const [k, v] of Object.entries(cells)) s.set(k, v);
  return s;
}
const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b);
// Evaluate one formula (with optional context cells) in A100 and compare.
function F(formula, expected, cells = {}) {
  return () => {
    const s = S(cells);
    s.set('ZZ9999', formula);
    const v = s.get('ZZ9999');
    return { ok: same(v, expected), detail: `${formula} → ${JSON.stringify(v)}, expected ${JSON.stringify(expected)}` };
  };
}
const many = (pairs, cells) => () => {
  const bad = [];
  for (const [f, exp] of pairs) {
    const r = F(f, exp, cells)();
    if (!r.ok) bad.push(r.detail);
  }
  return { ok: bad.length === 0, detail: bad.join(' | ') };
};

const NUMS = { A1: '10', A2: '20', A3: 'apple', A4: '', A5: '5', A6: 'TRUE' };
const TABLE = { A1: 'apple', B1: '3', C1: 'red', A2: 'banana', B2: '5', C2: 'yellow', A3: 'cherry', B3: '7', C3: 'red', A4: 'date', B4: '9', C4: 'brown' };

// ---------- structure ----------
g.check('structure', 'own tests pass with node --test', () => {
  const r = run(process.execPath, ['--test'], { cwd: work, timeout: 180000 });
  const tests = Number((r.out.match(/ℹ tests (\d+)/) || [])[1] || 0);
  return { ok: r.code === 0 && tests >= 1, detail: `exit ${r.code}, tests ${tests}` };
});
g.check('structure', 'README lists the functions', () => {
  const t = fs.readFileSync(path.join(work, 'README.md'), 'utf8').toUpperCase();
  const fns = ['SUM', 'AVERAGE', 'COUNTBLANK', 'ROUNDDOWN', 'IFS', 'XOR', 'IFNA', 'TEXTJOIN', 'SUBSTITUTE', 'SEARCH', 'VLOOKUP', 'MATCH', 'CHOOSE', 'AVERAGEIF', 'ISLOGICAL'];
  const missing = fns.filter((f) => !t.includes(f));
  return { ok: !missing.length, detail: `missing ${missing.join(',')}` };
});
g.check('structure', 'no dependencies', () => {
  const p = path.join(work, 'package.json');
  const pkg = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  return !Object.keys(pkg.dependencies || {}).length;
});

// ---------- API & literals ----------
g.check('api', 'literals: numbers, booleans, text, clearing', () => {
  const s = S({ A1: '42', A2: ' 7 ', A3: '-3.5', A4: '1e3', A5: 'true', A6: 'False', A7: 'hello world', A8: 'x' });
  s.set('A8', '');
  const got = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'B9'].map((r) => s.get(r));
  return { ok: JSON.stringify(got) === JSON.stringify([42, 7, -3.5, 1000, true, false, 'hello world', null, null]), detail: JSON.stringify(got) };
});
g.check('api', 'getInput returns the raw input; references are case-insensitive with $', () => {
  const s = S({ b2: '=1+1' });
  return { ok: s.getInput('B2') === '=1+1' && s.get('$B$2') === 2 && s.get('b$2') === 2 && s.getInput('C3') === '', detail: `${s.getInput('B2')} ${s.get('$B$2')}` };
});
g.check('api', 'invalid references throw', () => {
  const s = S();
  let n = 0;
  for (const bad of ['A0', 'AAA1', '1A', 'A10000', '']) { try { s.get(bad); } catch (e) { n += 1; } }
  try { s.set('A0', '1'); } catch (e) { n += 1; }
  return { ok: n === 6, detail: `${n}/6 threw` };
});
g.check('api', 'recalculation follows dependency chains', () => {
  const s = S({ A1: '1', B1: '=A1*2', C1: '=B1+A1', D1: '=SUM(A1:C1)' });
  const before = s.get('D1');
  s.set('A1', '10');
  return { ok: before === 6 && s.get('B1') === 20 && s.get('C1') === 30 && s.get('D1') === 60, detail: `${before} ${s.get('D1')}` };
});
g.check('api', 'formula referencing an empty cell gives 0', F('=B77', 0));

// ---------- formula syntax & operators ----------
g.check('syntax', 'number and string literals in formulas', many([['=.5+1e2', 100.5], ['="say ""hi"""', 'say "hi"'], ['=true', true], ['=FaLsE', false]]));
g.check('syntax', 'whitespace and case-insensitive names', many([['= 1 +  2 ', 3], ['=sum( 1 , 2 )', 3]]));
g.check('operators', 'arithmetic', many([['=7-2*3', 1], ['=(7-2)*3', 15], ['=7/2', 3.5], ['=2^10', 1024]]));
g.check('operators', '^ is right-associative', F('=2^3^2', 512));
g.check('operators', 'unary minus binds tighter than ^', many([['=-2^2', 4], ['=2^-1', 0.5], ['=--3', 3], ['=+4', 4]]));
g.check('operators', 'postfix %', many([['=50%', 0.5], ['=200*10%', 20], ['=5%^2', 0.0025]]));
g.check('operators', '& concatenation and number formatting', many([['="a"&1.5&TRUE', 'a1.5TRUE'], ['=1+2&"x"', '3x'], ['="v"&B5', 'v']]));
g.check('operators', 'comparison has the lowest precedence', many([['=1+1=2', true], ['="a"&"b"="AB"', true], ['=2*3>5', true]]));
g.check('operators', 'comparisons of numbers, text (case-insensitive) and booleans', many([['=3<10', true], ['="apple"<"Banana"', true], ['="A"="a"', true], ['=FALSE<TRUE', true], ['=2<>2', false], ['=5>=5', true]]));
g.check('operators', 'cross-type comparison: numbers < text < booleans', many([['=999<"a"', true], ['="z"<TRUE', true], ['=1=TRUE', false]]));
g.check('operators', 'empty cell compares as 0 or ""', many([['=B50=0', true], ['=B50=""', true]]));

// ---------- coercion ----------
g.check('coercion', 'booleans and numeric text in arithmetic', many([['=TRUE+1', 2], ['="3"*"4"', 12], ['=" 2 "+1', 3]]));
g.check('coercion', 'non-numeric text in arithmetic → #VALUE!', many([['="abc"+1', '#VALUE!'], ['=-"x"', '#VALUE!']]));
g.check('coercion', 'empty cell is 0 in arithmetic', F('=B50+5', 5));
g.check('coercion', 'a range used as a value → #VALUE!', many([['=A1:A3', '#VALUE!'], ['=A1:A2+1', '#VALUE!']], { A1: '1', A2: '2' }));

// ---------- errors ----------
g.check('errors', 'division by zero', many([['=1/0', '#DIV/0!'], ['=1/B50', '#DIV/0!']]));
g.check('errors', 'unknown function → #NAME?', F('=FOO(1)', '#NAME?'));
g.check('errors', 'unknown identifier → #NAME?', F('=foo+1', '#NAME?'));
g.check('errors', 'reference outside the grid inside a formula → #REF!', many([['=AAA1+1', '#REF!'], ['=A10000', '#REF!']]));
g.check('errors', 'parse errors → #ERROR!', many([['=1+', '#ERROR!'], ['=(1', '#ERROR!'], ['=1 2', '#ERROR!'], ['="abc', '#ERROR!'], ['=SUM(1,', '#ERROR!']]));
g.check('errors', 'errors propagate through operators and functions (first error wins)', many([['=A1+1', '#DIV/0!'], ['=SUM(1,A1)', '#DIV/0!'], ['=A1&A2', '#DIV/0!'], ['=A2+A1', '#N/A'], ['=SUM(A1:A2)', '#DIV/0!']], { A1: '=1/0', A2: '=MATCH(9,B1:B2,0)', B1: '1', B2: '2' }));
g.check('errors', 'non-finite results → #NUM!', many([['=10^400', '#NUM!'], ['=POWER(-8, 0.5)', '#NUM!']]));
g.check('errors', 'wrong argument count → #VALUE!', many([['=ABS()', '#VALUE!'], ['=MOD(1)', '#VALUE!'], ['=LEN("a","b")', '#VALUE!']]));

// ---------- circular references ----------
g.check('cycles', 'self reference → #CIRC!', () => { const s = S({ A1: '=A1+1' }); return { ok: s.get('A1') === '#CIRC!', detail: s.get('A1') }; });
g.check('cycles', 'two-cell cycle: both cells #CIRC!', () => { const s = S({ A1: '=B1', B1: '=A1+1' }); return { ok: s.get('A1') === '#CIRC!' && s.get('B1') === '#CIRC!', detail: `${s.get('A1')} ${s.get('B1')}` }; });
g.check('cycles', 'cells depending on a cycle are #CIRC!', () => { const s = S({ A1: '=B1', B1: '=A1', C1: '=A1*2' }); return { ok: s.get('C1') === '#CIRC!', detail: s.get('C1') }; });
g.check('cycles', 'breaking the cycle restores values', () => {
  const s = S({ A1: '=B1', B1: '=A1+1' });
  s.get('A1');
  s.set('B1', '5');
  return { ok: s.get('A1') === 5 && s.get('B1') === 5, detail: `${s.get('A1')}` };
});
g.check('cycles', 'a long chain is fine (no false cycle)', () => {
  const cells = { A1: '1' };
  for (let i = 2; i <= 300; i++) cells[`A${i}`] = `=A${i - 1}+1`;
  const s = S(cells);
  return { ok: s.get('A300') === 300, detail: String(s.get('A300')) };
});

// ---------- math ----------
g.check('math', 'SUM/PRODUCT over ranges skip text, booleans and blanks', many([['=SUM(A1:A6)', 35], ['=PRODUCT(A1:A6)', 1000], ['=SUM(A1:A2,1,"2",TRUE)', 34]], NUMS));
g.check('math', 'MIN/MAX/AVERAGE', many([['=MIN(A1:A6)', 5], ['=MAX(A1:A6)', 20], ['=AVERAGE(A1:A6)', 35 / 3], ['=MAX(A3:A4)', 0], ['=MIN(A3)', 0]], NUMS));
g.check('math', 'AVERAGE of no numbers → #DIV/0!', F('=AVERAGE(A3:A4)', '#DIV/0!', NUMS));
g.check('math', 'COUNT, COUNTA, COUNTBLANK', many([['=COUNT(A1:A6)', 3], ['=COUNTA(A1:A6)', 5], ['=COUNTBLANK(A1:A6)', 1], ['=COUNT(1,2,"3")', 3]], NUMS));
g.check('math', 'ROUND half away from zero, negative digits', many([['=ROUND(2.5,0)', 3], ['=ROUND(-2.5,0)', -3], ['=ROUND(3.14159,2)', 3.14], ['=ROUND(1234,-2)', 1200], ['=ROUND(2.675,2)', 2.68]]));
g.check('math', 'ROUNDUP / ROUNDDOWN', many([['=ROUNDUP(3.2,0)', 4], ['=ROUNDUP(-3.2,0)', -4], ['=ROUNDUP(1.11,1)', 1.2], ['=ROUNDDOWN(3.9,0)', 3], ['=ROUNDDOWN(-3.9,0)', -3], ['=ROUNDDOWN(1289,-2)', 1200]]));
g.check('math', 'INT rounds down', many([['=INT(1.5)', 1], ['=INT(-1.5)', -2]]));
g.check('math', 'MOD has the sign of the divisor', many([['=MOD(7,3)', 1], ['=MOD(-7,3)', 2], ['=MOD(7,-3)', -2], ['=MOD(1,0)', '#DIV/0!']]));
g.check('math', 'ABS, SQRT, POWER', many([['=ABS(-4)', 4], ['=SQRT(16)', 4], ['=SQRT(-1)', '#NUM!'], ['=POWER(2,0.5)', Math.SQRT2]]));

// ---------- logic ----------
g.check('logic', 'IF with default else', many([['=IF(1>0,"y","n")', 'y'], ['=IF(0,"y","n")', 'n'], ['=IF(FALSE,1)', false]]));
g.check('logic', 'IF evaluates only the chosen branch', F('=IF(TRUE,1,1/0)', 1));
g.check('logic', 'IF with a text condition → #VALUE!', F('=IF("x",1,2)', '#VALUE!'));
g.check('logic', 'IFS first true / none → #N/A', many([['=IFS(1>2,"a",2>1,"b")', 'b'], ['=IFS(FALSE,1)', '#N/A']]));
g.check('logic', 'AND / OR / XOR / NOT', many([['=AND(TRUE,1)', true], ['=AND(TRUE,0)', false], ['=OR(0,FALSE,2)', true], ['=XOR(TRUE,TRUE,TRUE)', true], ['=XOR(1,1)', false], ['=NOT(0)', true]]));
g.check('logic', 'AND with a text argument → #VALUE!; ranges skip text', many([['=AND(TRUE,"x")', '#VALUE!'], ['=AND(A1:A3)', true]], { A1: 'TRUE', A2: 'word', A3: '1' }));
g.check('logic', 'IFERROR catches any error, IFNA only #N/A', many([['=IFERROR(1/0,"x")', 'x'], ['=IFERROR(5,"x")', 5], ['=IFNA(MATCH(9,B1:B2,0),"none")', 'none'], ['=IFNA(1/0,"x")', '#DIV/0!']], { B1: '1', B2: '2' }));

// ---------- text ----------
g.check('text', 'LEN, UPPER, LOWER', many([['=LEN("hello")', 5], ['=UPPER("abc")', 'ABC'], ['=LOWER("ÀBC")', 'àbc'], ['=LEN(12.5)', 4]]));
g.check('text', 'TRIM collapses inner spaces', F('=TRIM("  a   b  c ")', 'a b c'));
g.check('text', 'LEFT / RIGHT / MID', many([['=LEFT("hello")', 'h'], ['=LEFT("hello",3)', 'hel'], ['=RIGHT("hello",2)', 'lo'], ['=MID("hello",2,3)', 'ell'], ['=MID("hello",4,10)', 'lo'], ['=LEFT("abc",-1)', '#VALUE!']]));
g.check('text', 'CONCAT flattens ranges row by row', F('=CONCAT(A1:B2,"!")', 'abcd!', { A1: 'a', B1: 'b', A2: 'c', B2: 'd' }));
g.check('text', 'TEXTJOIN with and without ignore_empty', many([['=TEXTJOIN("-",TRUE,A1:A3)', 'x-z'], ['=TEXTJOIN(", ",FALSE,A1:A3,"w")', 'x, , z, w']], { A1: 'x', A3: 'z' }));
g.check('text', 'SUBSTITUTE all or the n-th occurrence', many([['=SUBSTITUTE("a-b-c","-","+")', 'a+b+c'], ['=SUBSTITUTE("a-b-c","-","+",2)', 'a-b+c'], ['=SUBSTITUTE("aaa","a","b",5)', 'aaa']]));
g.check('text', 'FIND is case-sensitive; not found → #VALUE!', many([['=FIND("l","hello")', 3], ['=FIND("l","hello",4)', 4], ['=FIND("L","hello")', '#VALUE!']]));
g.check('text', 'SEARCH is case-insensitive with wildcards', many([['=SEARCH("L","hello")', 3], ['=SEARCH("h?l","ahelp")', 2], ['=SEARCH("e*p","help")', 2], ['=SEARCH("z","abc")', '#VALUE!']]));
g.check('text', 'REPT, EXACT, VALUE', many([['=REPT("ab",3)', 'ababab'], ['=EXACT("a","A")', false], ['=EXACT("a","a")', true], ['=VALUE("12.5")', 12.5], ['=VALUE("x")', '#VALUE!']]));

// ---------- lookup ----------
g.check('lookup', 'VLOOKUP exact match (case-insensitive)', many([['=VLOOKUP("Cherry",A1:C4,2,FALSE)', 7], ['=VLOOKUP("cherry",A1:C4,3,FALSE)', 'red']], TABLE));
g.check('lookup', 'VLOOKUP no match → #N/A; bad column → #REF!', many([['=VLOOKUP("kiwi",A1:C4,2,FALSE)', '#N/A'], ['=VLOOKUP("date",A1:C4,4,FALSE)', '#REF!']], TABLE));
g.check('lookup', 'VLOOKUP approximate on a sorted column', many([['=VLOOKUP(65,E1:F4,2)', 'D'], ['=VLOOKUP(90,E1:F4,2,TRUE)', 'A'], ['=VLOOKUP(10,E1:F4,2)', '#N/A']], { E1: '50', F1: 'E', E2: '60', F2: 'D', E3: '75', F3: 'C', E4: '90', F4: 'A' }));
g.check('lookup', 'INDEX with row and column; outside → #REF!', many([['=INDEX(A1:C4,2,3)', 'yellow'], ['=INDEX(B1:B4,3)', 7], ['=INDEX(A1:C4,5,1)', '#REF!']], TABLE));
g.check('lookup', 'MATCH exact, ascending and descending', many([['=MATCH("date",A1:A4,0)', 4], ['=MATCH(6,B1:B4)', 2], ['=MATCH(6,D1:D4,-1)', 2], ['=MATCH(100,B1:B4,0)', '#N/A']], Object.assign({ D1: '10', D2: '8', D3: '5', D4: '1' }, TABLE)));
g.check('lookup', 'CHOOSE', many([['=CHOOSE(2,"a","b","c")', 'b'], ['=CHOOSE(4,"a","b","c")', '#VALUE!']]));

// ---------- conditional aggregates ----------
const SALES = { A1: 'apple', B1: '10', A2: 'Apple pie', B2: '20', A3: 'banana', B3: '5', A4: 'cherry', B4: '15', A5: '', B5: '100' };
g.check('conditional', 'SUMIF with text and wildcard criteria', many([['=SUMIF(A1:A4,"apple",B1:B4)', 10], ['=SUMIF(A1:A4,"apple*",B1:B4)', 30], ['=SUMIF(A1:A4,"?herry",B1:B4)', 15]], SALES));
g.check('conditional', 'SUMIF with numeric operator criteria on the same range', many([['=SUMIF(B1:B5,">10")', 135], ['=SUMIF(B1:B5,"<=10")', 15], ['=SUMIF(B1:B4,"<>10")', 40], ['=SUMIF(B1:B4,15)', 15]], SALES));
g.check('conditional', 'COUNTIF variants', many([['=COUNTIF(A1:A5,"<>apple")', 4], ['=COUNTIF(B1:B5,">=15")', 3], ['=COUNTIF(A1:A5,"*an*")', 1]], SALES));
g.check('conditional', 'AVERAGEIF; no match → #DIV/0!', many([['=AVERAGEIF(A1:A4,"*e*",B1:B4)', 15], ['=AVERAGEIF(B1:B4,">100")', '#DIV/0!']], SALES));

// ---------- information ----------
g.check('info', 'ISBLANK, ISNUMBER, ISTEXT, ISLOGICAL', many([['=ISBLANK(C9)', true], ['=ISBLANK(A1)', false], ['=ISNUMBER(A1)', true], ['=ISNUMBER("1")', false], ['=ISTEXT(A2)', true], ['=ISLOGICAL(A3)', true]], { A1: '1', A2: 'x', A3: 'FALSE' }));
g.check('info', 'ISERROR and ISNA', many([['=ISERROR(1/0)', true], ['=ISERROR(1)', false], ['=ISNA(MATCH(5,A1:A1,0))', true], ['=ISNA(1/0)', false]], { A1: '1' }));

main(g);
