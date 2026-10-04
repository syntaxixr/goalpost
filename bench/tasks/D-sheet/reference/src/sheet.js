'use strict';
// Reference solution for task D (validates the hidden grader). Not shown to the agent.

class Err {
  constructor(code) { this.code = code; }
}
const E = (c) => new Err(c);
const isErr = (v) => v instanceof Err;
class Range {
  constructor(rows) { this.rows = rows; } // 2D array of values
  flat() { return this.rows.flat(); }
}

const MAX_COL = 26 * 27; // ZZ
const MAX_ROW = 9999;
function colNum(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function colName(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function parseRef(ref) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(ref).trim());
  if (!m) return null;
  const col = colNum(m[1]);
  const row = Number(m[2]);
  return { col, row, valid: col >= 1 && col <= MAX_COL && row >= 1 && row <= MAX_ROW, key: `${m[1].toUpperCase()}${row}` };
}
function normRef(ref) {
  const r = parseRef(ref);
  if (!r || !r.valid) throw new Error(`invalid reference: ${ref}`);
  return `${colName(r.col)}${r.row}`;
}

const NUM_RE = /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;

// ---------- tokenizer ----------
function tokenize(src) {
  const t = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new Error('bad number');
      t.push({ type: 'num', value: Number(m[0]) }); i += m[0].length; continue;
    }
    if (c === '"') {
      let s = ''; i++;
      for (;;) {
        if (i >= src.length) throw new Error('unterminated string');
        if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i += 2; continue; } i++; break; }
        s += src[i++];
      }
      t.push({ type: 'str', value: s }); continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_.$]*/.exec(src.slice(i));
      const word = m[0];
      i += word.length;
      let j = i; while (/\s/.test(src[j] || '')) j++;
      if (src[j] === '(') { t.push({ type: 'func', value: word.toUpperCase() }); continue; }
      if (/^(TRUE|FALSE)$/i.test(word)) { t.push({ type: 'bool', value: word.toUpperCase() === 'TRUE' }); continue; }
      if (/^\$?[A-Za-z]{1,3}\$?\d+$/.test(word)) { t.push({ type: 'ref', value: word }); continue; }
      t.push({ type: 'name', value: word }); continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '<>'].includes(two)) { t.push({ type: 'op', value: two }); i += 2; continue; }
    if ('+-*/^&=<>%:(),'.includes(c)) { t.push({ type: c === '(' || c === ')' || c === ',' || c === ':' ? c : 'op', value: c }); i++; continue; }
    throw new Error(`bad char ${c}`);
  }
  return t;
}

// ---------- parser (Pratt) ----------
const BIN = { '=': [1, 'L'], '<>': [1, 'L'], '<': [1, 'L'], '>': [1, 'L'], '<=': [1, 'L'], '>=': [1, 'L'], '&': [2, 'L'], '+': [3, 'L'], '-': [3, 'L'], '*': [4, 'L'], '/': [4, 'L'], '^': [5, 'R'] };
function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (type) => { const t = next(); if (!t || t.type !== type) throw new Error(`expected ${type}`); return t; };
  function primary() {
    const t = next();
    if (!t) throw new Error('unexpected end');
    if (t.type === 'num') return { k: 'lit', v: t.value };
    if (t.type === 'str') return { k: 'lit', v: t.value };
    if (t.type === 'bool') return { k: 'lit', v: t.value };
    if (t.type === 'name') return { k: 'name', v: t.value };
    if (t.type === 'ref') {
      if (peek() && peek().type === ':') { next(); const b = expect('ref'); return { k: 'range', a: t.value, b: b.value }; }
      return { k: 'ref', v: t.value };
    }
    if (t.type === 'func') {
      expect('(');
      const args = [];
      if (peek() && peek().type === ')') { next(); return { k: 'call', name: t.value, args }; }
      for (;;) {
        args.push(expr(0));
        const s = next();
        if (!s) throw new Error('unclosed call');
        if (s.type === ')') break;
        if (s.type !== ',') throw new Error('expected , or )');
      }
      return { k: 'call', name: t.value, args };
    }
    if (t.type === '(') { const e = expr(0); expect(')'); return e; }
    if (t.type === 'op' && (t.value === '-' || t.value === '+')) return { k: 'neg', sign: t.value, e: expr(6) };
    throw new Error(`unexpected ${t.value}`);
  }
  function expr(min) {
    let left = primary();
    for (;;) {
      const t = peek();
      if (!t || t.type !== 'op') break;
      if (t.value === '%') { if (7 < min) break; next(); left = { k: 'pct', e: left }; continue; }
      const b = BIN[t.value];
      if (!b || b[0] < min) break;
      next();
      const right = expr(b[1] === 'L' ? b[0] + 1 : b[0]);
      left = { k: 'bin', op: t.value, l: left, r: right };
    }
    return left;
  }
  const tree = expr(0);
  if (p !== toks.length) throw new Error('trailing tokens');
  return tree;
}

// ---------- coercion ----------
function toNum(v) {
  if (isErr(v)) return v;
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Range) return E('#VALUE!');
  if (NUM_RE.test(v)) return Number(v);
  return E('#VALUE!');
}
function toText(v) {
  if (isErr(v)) return v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Range) return E('#VALUE!');
  return String(v);
}
function toBool(v) {
  if (isErr(v)) return v;
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v instanceof Range) return E('#VALUE!');
  return E('#VALUE!');
}
const rank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
function cmp(a, b) {
  if (a === null && b === null) return 0;
  if (a === null) a = typeof b === 'number' ? 0 : typeof b === 'string' ? '' : false;
  if (b === null) b = typeof a === 'number' ? 0 : typeof a === 'string' ? '' : false;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === 'string') { const x = a.toLowerCase(); const y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  const x = Number(a); const y = Number(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
const finite = (n) => (Number.isFinite(n) ? n : E('#NUM!'));
const wildRe = (pat, whole = true) => new RegExp((whole ? '^' : '') + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + (whole ? '$' : ''), 'i');

// ---------- the sheet ----------
class Sheet {
  constructor() { this.cells = new Map(); }
  set(ref, input) {
    const key = normRef(ref);
    const s = String(input);
    if (s === '') this.cells.delete(key);
    else this.cells.set(key, { input: s, ast: undefined });
  }
  getInput(ref) {
    const c = this.cells.get(normRef(ref));
    return c ? c.input : '';
  }
  get(ref) {
    const v = this.value(normRef(ref), new Map(), new Set());
    if (isErr(v)) return v.code;
    return v;
  }
  literal(s) {
    if (NUM_RE.test(s)) return Number(s);
    if (/^(true|false)$/i.test(s.trim())) return s.trim().toLowerCase() === 'true';
    return s;
  }
  value(key, memo, visiting) {
    if (memo.has(key)) return memo.get(key);
    const c = this.cells.get(key);
    if (!c) return null;
    if (!c.input.startsWith('=')) return this.literal(c.input);
    if (visiting.has(key)) return E('#CIRC!');
    visiting.add(key);
    let v;
    try {
      if (c.ast === undefined) { try { c.ast = parse(c.input.slice(1)); } catch (e) { c.ast = null; } }
      if (c.ast === null) v = E('#ERROR!');
      else {
        v = this.ev(c.ast, memo, visiting);
        if (v instanceof Range) v = E('#VALUE!');
        else if (v === null) v = 0;
        else if (typeof v === 'number') v = finite(v);
      }
    } finally { visiting.delete(key); }
    memo.set(key, v);
    return v;
  }
  cellValue(refText, memo, visiting) {
    const r = parseRef(refText);
    if (!r || !r.valid) return E('#REF!');
    return this.value(`${colName(r.col)}${r.row}`, memo, visiting);
  }
  rangeValue(a, b, memo, visiting) {
    const ra = parseRef(a); const rb = parseRef(b);
    if (!ra || !rb || !ra.valid || !rb.valid) return E('#REF!');
    const rows = [];
    for (let r = Math.min(ra.row, rb.row); r <= Math.max(ra.row, rb.row); r++) {
      const row = [];
      for (let c = Math.min(ra.col, rb.col); c <= Math.max(ra.col, rb.col); c++) row.push(this.value(`${colName(c)}${r}`, memo, visiting));
      rows.push(row);
    }
    return new Range(rows);
  }
  ev(n, memo, vis) {
    switch (n.k) {
      case 'lit': return n.v;
      case 'name': return E('#NAME?');
      case 'ref': return this.cellValue(n.v, memo, vis);
      case 'range': return this.rangeValue(n.a, n.b, memo, vis);
      case 'neg': { const x = toNum(this.scalar(n.e, memo, vis)); if (isErr(x)) return x; return n.sign === '-' ? -x : x; }
      case 'pct': { const x = toNum(this.scalar(n.e, memo, vis)); if (isErr(x)) return x; return x / 100; }
      case 'bin': return this.bin(n, memo, vis);
      case 'call': return this.call(n, memo, vis);
      default: return E('#ERROR!');
    }
  }
  scalar(node, memo, vis) {
    const v = this.ev(node, memo, vis);
    return v instanceof Range ? E('#VALUE!') : v;
  }
  bin(n, memo, vis) {
    const a = this.scalar(n.l, memo, vis);
    if (isErr(a)) return a;
    const b = this.scalar(n.r, memo, vis);
    if (isErr(b)) return b;
    if (n.op === '&') return toText(a) + toText(b);
    if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) {
      const c = cmp(a, b);
      return { '=': c === 0, '<>': c !== 0, '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[n.op];
    }
    const x = toNum(a); if (isErr(x)) return x;
    const y = toNum(b); if (isErr(y)) return y;
    switch (n.op) {
      case '+': return x + y;
      case '-': return x - y;
      case '*': return x * y;
      case '/': return y === 0 ? E('#DIV/0!') : x / y;
      case '^': return finite(Math.pow(x, y));
      default: return E('#ERROR!');
    }
  }
  call(n, memo, vis) {
    const name = n.name;
    const lazy = (i) => (i < n.args.length ? this.ev(n.args[i], memo, vis) : undefined);
    const argc = n.args.length;
    const need = (lo, hi = lo) => argc >= lo && argc <= hi;
    // error-handling and lazy functions first
    if (name === 'IF') {
      if (!need(2, 3)) return E('#VALUE!');
      const c = toBool(this.scalarOf(lazy(0))); if (isErr(c)) return c;
      return c ? this.scalarOf(lazy(1)) : argc === 3 ? this.scalarOf(lazy(2)) : false;
    }
    if (name === 'IFS') {
      if (argc < 2 || argc % 2) return E('#VALUE!');
      for (let i = 0; i < argc; i += 2) {
        const c = toBool(this.scalarOf(lazy(i))); if (isErr(c)) return c;
        if (c) return this.scalarOf(lazy(i + 1));
      }
      return E('#N/A');
    }
    if (name === 'IFERROR' || name === 'IFNA') {
      if (!need(2)) return E('#VALUE!');
      const v = this.scalarOf(lazy(0));
      if (isErr(v) && (name === 'IFERROR' || v.code === '#N/A')) return this.scalarOf(lazy(1));
      return v;
    }
    if (name === 'ISERROR' || name === 'ISNA') {
      if (!need(1)) return E('#VALUE!');
      const v = this.scalarOf(lazy(0));
      return name === 'ISERROR' ? isErr(v) : isErr(v) && v.code === '#N/A';
    }
    const args = n.args.map((a) => this.ev(a, memo, vis));
    // Aggregates treat a plain cell reference like a 1x1 range (text in it is skipped, not coerced).
    const asRange = n.args.map((a, i) => (a.k === 'ref' && !isErr(args[i]) ? new Range([[args[i]]]) : args[i]));
    for (const a of args) {
      if (isErr(a)) return a;
      if (a instanceof Range) { const e = a.flat().find(isErr); if (e) return e; }
    }
    const fn = FUNCS[name];
    if (!fn) return E('#NAME?');
    return RANGE_LIKE.has(name) ? fn(asRange, this) : fn(args, this);
  }
  scalarOf(v) { return v instanceof Range ? E('#VALUE!') : v; }
}

// ---------- functions ----------
function nums(args) {
  const out = [];
  for (const a of args) {
    if (a instanceof Range) { for (const v of a.flat()) if (typeof v === 'number') out.push(v); continue; }
    const x = toNum(a);
    if (isErr(x)) return x;
    out.push(x);
  }
  return out;
}
function flatAll(args) {
  const out = [];
  for (const a of args) if (a instanceof Range) out.push(...a.flat()); else out.push(a);
  return out;
}
const scalarArgs = (args, f) => (args.some((a) => a instanceof Range) ? E('#VALUE!') : f(...args));
const roundWith = (fn) => (args) => {
  if (args.length !== 2) return E('#VALUE!');
  return scalarArgs(args, (a, b) => {
    const x = toNum(a); if (isErr(x)) return x;
    const d = toNum(b); if (isErr(d)) return d;
    const digits = Math.trunc(d);
    const s = Math.sign(x);
    const r = fn(Number(`${Math.abs(x)}e${digits}`));
    return s * Number(`${r}e${-digits}`);
  });
};
const text1 = (f) => (args) => (args.length !== 1 ? E('#VALUE!') : scalarArgs(args, (a) => { const s = toText(a); return isErr(s) ? s : f(s); }));
function parseCriteria(c) {
  if (typeof c === 'number' || typeof c === 'boolean') return { op: '=', val: c };
  const s = c === null ? '' : String(c);
  const m = /^(<=|>=|<>|<|>|=)(.*)$/.exec(s);
  const op = m ? m[1] : '=';
  const raw = m ? m[2] : s;
  const val = NUM_RE.test(raw) ? Number(raw) : /^(true|false)$/i.test(raw) ? raw.toLowerCase() === 'true' : raw;
  return { op, val };
}
function matches(v, crit) {
  const { op, val } = crit;
  if (typeof val === 'number') {
    if (typeof v !== 'number') return op === '<>';
    return { '=': v === val, '<>': v !== val, '<': v < val, '>': v > val, '<=': v <= val, '>=': v >= val }[op];
  }
  if (typeof val === 'boolean') {
    const eq = v === val;
    return op === '<>' ? !eq : op === '=' ? eq : false;
  }
  if (op === '=' || op === '<>') {
    let eq;
    if (val === '') eq = v === null || v === '';
    else eq = typeof v === 'string' && wildRe(val).test(v);
    return op === '=' ? eq : !eq;
  }
  if (typeof v !== 'string') return false;
  const c = cmp(v, val);
  return { '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[op];
}
function condPairs(args) {
  const [range, crit, other] = args;
  if (!(range instanceof Range)) return E('#VALUE!');
  if (crit instanceof Range) return E('#VALUE!');
  const target = other instanceof Range ? other : range;
  const c = parseCriteria(crit);
  const out = [];
  range.rows.forEach((row, i) => row.forEach((v, j) => {
    if (matches(v, c)) out.push(target.rows[i] ? target.rows[i][j] : undefined);
  }));
  return out;
}

const FUNCS = {
  SUM: (a) => { const n = nums(a); return isErr(n) ? n : n.reduce((s, x) => s + x, 0); },
  PRODUCT: (a) => { const n = nums(a); return isErr(n) ? n : n.reduce((s, x) => s * x, 1); },
  MIN: (a) => { const n = nums(a); return isErr(n) ? n : n.length ? Math.min(...n) : 0; },
  MAX: (a) => { const n = nums(a); return isErr(n) ? n : n.length ? Math.max(...n) : 0; },
  AVERAGE: (a) => { const n = nums(a); if (isErr(n)) return n; return n.length ? n.reduce((s, x) => s + x, 0) / n.length : E('#DIV/0!'); },
  COUNT: (a) => { let c = 0; for (const x of a) { if (x instanceof Range) c += x.flat().filter((v) => typeof v === 'number').length; else if (!isErr(toNum(x))) c += 1; } return c; },
  COUNTA: (a) => flatAll(a).filter((v) => v !== null && v !== undefined).length,
  COUNTBLANK: (a) => (a.length === 1 && a[0] instanceof Range ? a[0].flat().filter((v) => v === null).length : E('#VALUE!')),
  ROUND: roundWith(Math.round),
  ROUNDUP: roundWith(Math.ceil),
  ROUNDDOWN: roundWith(Math.floor),
  INT: (a) => (a.length !== 1 ? E('#VALUE!') : scalarArgs(a, (x) => { const n = toNum(x); return isErr(n) ? n : Math.floor(n); })),
  MOD: (a) => (a.length !== 2 ? E('#VALUE!') : scalarArgs(a, (x, y) => {
    const p = toNum(x); if (isErr(p)) return p; const q = toNum(y); if (isErr(q)) return q;
    if (q === 0) return E('#DIV/0!');
    return p - q * Math.floor(p / q);
  })),
  ABS: (a) => (a.length !== 1 ? E('#VALUE!') : scalarArgs(a, (x) => { const n = toNum(x); return isErr(n) ? n : Math.abs(n); })),
  SQRT: (a) => (a.length !== 1 ? E('#VALUE!') : scalarArgs(a, (x) => { const n = toNum(x); if (isErr(n)) return n; return n < 0 ? E('#NUM!') : Math.sqrt(n); })),
  POWER: (a) => (a.length !== 2 ? E('#VALUE!') : scalarArgs(a, (x, y) => { const p = toNum(x); if (isErr(p)) return p; const q = toNum(y); if (isErr(q)) return q; return finite(Math.pow(p, q)); })),
  AND: (a) => logic(a, (bs) => bs.every(Boolean)),
  OR: (a) => logic(a, (bs) => bs.some(Boolean)),
  XOR: (a) => logic(a, (bs) => bs.filter(Boolean).length % 2 === 1),
  NOT: (a) => (a.length !== 1 ? E('#VALUE!') : scalarArgs(a, (x) => { const b = toBool(x); return isErr(b) ? b : !b; })),
  LEN: text1((s) => s.length),
  UPPER: text1((s) => s.toUpperCase()),
  LOWER: text1((s) => s.toLowerCase()),
  TRIM: text1((s) => s.trim().replace(/ +/g, ' ')),
  LEFT: (a) => (a.length < 1 || a.length > 2 ? E('#VALUE!') : scalarArgs(a, (t, n = 1) => { const s = toText(t); if (isErr(s)) return s; const k = toNum(n); if (isErr(k)) return k; return k < 0 ? E('#VALUE!') : s.slice(0, Math.floor(k)); })),
  RIGHT: (a) => (a.length < 1 || a.length > 2 ? E('#VALUE!') : scalarArgs(a, (t, n = 1) => { const s = toText(t); if (isErr(s)) return s; const k = toNum(n); if (isErr(k)) return k; if (k < 0) return E('#VALUE!'); const m = Math.floor(k); return m === 0 ? '' : s.slice(-m); })),
  MID: (a) => (a.length !== 3 ? E('#VALUE!') : scalarArgs(a, (t, st, n) => { const s = toText(t); if (isErr(s)) return s; const p = toNum(st); if (isErr(p)) return p; const k = toNum(n); if (isErr(k)) return k; if (p < 1 || k < 0) return E('#VALUE!'); return s.substr(Math.floor(p) - 1, Math.floor(k)); })),
  CONCAT: (a) => flatAll(a).map(toText).join(''),
  TEXTJOIN: (a) => {
    if (a.length < 3) return E('#VALUE!');
    const d = toText(a[0]); if (isErr(d)) return d;
    const ig = toBool(a[1]); if (isErr(ig)) return ig;
    const parts = flatAll(a.slice(2)).map(toText).filter((s) => !(ig && s === ''));
    return parts.join(d);
  },
  SUBSTITUTE: (a) => (a.length < 3 || a.length > 4 ? E('#VALUE!') : scalarArgs(a, (t, o, nw, inst) => {
    const s = toText(t); const old = toText(o); const rep = toText(nw);
    if (old === '') return s;
    if (inst === undefined) return s.split(old).join(rep);
    const k = toNum(inst); if (isErr(k)) return k;
    if (k < 1) return E('#VALUE!');
    let idx = -1;
    for (let i = 0; i < k; i++) { idx = s.indexOf(old, idx + 1); if (idx < 0) return s; }
    return s.slice(0, idx) + rep + s.slice(idx + old.length);
  })),
  FIND: (a) => (a.length < 2 || a.length > 3 ? E('#VALUE!') : scalarArgs(a, (nd, hs, st = 1) => {
    const n = toText(nd); const h = toText(hs); const p = toNum(st); if (isErr(p)) return p;
    if (p < 1 || p > h.length + 1) return E('#VALUE!');
    const i = h.indexOf(n, Math.floor(p) - 1);
    return i < 0 ? E('#VALUE!') : i + 1;
  })),
  SEARCH: (a) => (a.length < 2 || a.length > 3 ? E('#VALUE!') : scalarArgs(a, (nd, hs, st = 1) => {
    const n = toText(nd); const h = toText(hs); const p = toNum(st); if (isErr(p)) return p;
    if (p < 1 || p > h.length + 1) return E('#VALUE!');
    const m = wildRe(n, false).exec(h.slice(Math.floor(p) - 1));
    return m ? m.index + Math.floor(p) : E('#VALUE!');
  })),
  REPT: (a) => (a.length !== 2 ? E('#VALUE!') : scalarArgs(a, (t, n) => { const s = toText(t); const k = toNum(n); if (isErr(k)) return k; return k < 0 ? E('#VALUE!') : s.repeat(Math.floor(k)); })),
  EXACT: (a) => (a.length !== 2 ? E('#VALUE!') : scalarArgs(a, (x, y) => toText(x) === toText(y))),
  VALUE: (a) => (a.length !== 1 ? E('#VALUE!') : scalarArgs(a, (x) => (typeof x === 'number' ? x : typeof x === 'string' && NUM_RE.test(x) ? Number(x) : E('#VALUE!')))),
  VLOOKUP: (a) => {
    if (a.length < 3 || a.length > 4 || !(a[1] instanceof Range)) return E('#VALUE!');
    const [v, r, c, approx = true] = a;
    const col = toNum(c); if (isErr(col)) return col;
    const ap = toBool(approx); if (isErr(ap)) return ap;
    const width = r.rows[0].length;
    if (col < 1 || col > width) return E('#REF!');
    let hit = -1;
    for (let i = 0; i < r.rows.length; i++) {
      const k = r.rows[i][0];
      if (!ap) { if (k !== null && rank(k) === rank(v) && cmp(k, v) === 0) { hit = i; break; } } else {
        if (k === null || rank(k) !== rank(v)) continue;
        if (cmp(k, v) <= 0) hit = i; else break;
      }
    }
    return hit < 0 ? E('#N/A') : r.rows[hit][Math.floor(col) - 1];
  },
  INDEX: (a) => {
    if (a.length < 2 || a.length > 3 || !(a[0] instanceof Range)) return E('#VALUE!');
    const r = toNum(a[1]); if (isErr(r)) return r;
    const c = a.length === 3 ? toNum(a[2]) : 1; if (isErr(c)) return c;
    const row = a[0].rows[Math.floor(r) - 1];
    if (!row || c < 1 || c > row.length) return E('#REF!');
    return row[Math.floor(c) - 1];
  },
  MATCH: (a) => {
    if (a.length < 2 || a.length > 3 || !(a[1] instanceof Range)) return E('#VALUE!');
    const r = a[1];
    if (r.rows.length > 1 && r.rows[0].length > 1) return E('#N/A');
    const vals = r.flat();
    const type = a.length === 3 ? toNum(a[2]) : 1; if (isErr(type)) return type;
    const v = a[0];
    let hit = -1;
    for (let i = 0; i < vals.length; i++) {
      const k = vals[i];
      if (k === null || rank(k) !== rank(v)) continue;
      const c = cmp(k, v);
      if (type === 0) { if (c === 0) { hit = i; break; } } else if (type > 0) { if (c <= 0) hit = i; else break; } else if (c >= 0) hit = i; else break;
    }
    return hit < 0 ? E('#N/A') : hit + 1;
  },
  CHOOSE: (a) => {
    if (a.length < 2) return E('#VALUE!');
    const i = toNum(a[0]); if (isErr(i)) return i;
    const k = Math.floor(i);
    if (k < 1 || k >= a.length) return E('#VALUE!');
    return a[k] instanceof Range ? E('#VALUE!') : a[k];
  },
  SUMIF: (a) => { if (a.length < 2 || a.length > 3) return E('#VALUE!'); const v = condPairs(a); return isErr(v) ? v : v.filter((x) => typeof x === 'number').reduce((s, x) => s + x, 0); },
  COUNTIF: (a) => { if (a.length !== 2) return E('#VALUE!'); const v = condPairs(a); return isErr(v) ? v : v.length; },
  AVERAGEIF: (a) => {
    if (a.length < 2 || a.length > 3) return E('#VALUE!');
    const v = condPairs(a); if (isErr(v)) return v;
    const n = v.filter((x) => typeof x === 'number');
    return n.length ? n.reduce((s, x) => s + x, 0) / n.length : E('#DIV/0!');
  },
  ISBLANK: (a) => (a.length !== 1 ? E('#VALUE!') : a[0] === null),
  ISNUMBER: (a) => (a.length !== 1 ? E('#VALUE!') : typeof a[0] === 'number'),
  ISTEXT: (a) => (a.length !== 1 ? E('#VALUE!') : typeof a[0] === 'string'),
  ISLOGICAL: (a) => (a.length !== 1 ? E('#VALUE!') : typeof a[0] === 'boolean'),
};
const RANGE_LIKE = new Set(['SUM', 'PRODUCT', 'MIN', 'MAX', 'AVERAGE', 'COUNT', 'COUNTA', 'AND', 'OR', 'XOR', 'CONCAT', 'TEXTJOIN']);
function logic(args, f) {
  const bs = [];
  for (const a of args) {
    if (a instanceof Range) { for (const v of a.flat()) if (typeof v === 'number' || typeof v === 'boolean') bs.push(typeof v === 'number' ? v !== 0 : v); continue; }
    if (typeof a === 'string') return E('#VALUE!');
    const b = toBool(a); if (isErr(b)) return b;
    bs.push(b);
  }
  if (!bs.length) return E('#VALUE!');
  return f(bs);
}

module.exports = { Sheet };
