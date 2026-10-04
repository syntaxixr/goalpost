#!/usr/bin/env node
'use strict';
// Reference CLI for task A (validates the hidden grader).
const fs = require('fs');
const { Ledger, UsageError, toCents, fmt, validDate, today, normCategory, addMonths } = require('../src/ledger');

const HELP = `ledger — personal finance CLI
Commands: add, list, balance, delete, edit, budget set|status, import, export, report, undo, help
Global option: --file <path> (default ./ledger.json)`;

function parse(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (['json', 'by-category', 'help'].includes(k)) opt[k] = true;
      else { opt[k] = argv[i + 1]; i++; }
    } else pos.push(a);
  }
  return { pos, opt };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else { if (c === '\n') line++; field += c; }
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push({ line: rowLine, cells: row }); row = []; line++; rowLine = line;
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push({ line: rowLine, cells: row }); }
  return rows.filter((r) => r.cells.some((c) => c !== ''));
}
const csvField = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === 'help' || cmd === '-h') { console.log(HELP); return 0; }
  const { pos, opt } = parse(rest);
  const ledger = new Ledger(opt.file || 'ledger.json');
  const store = ledger.store;
  switch (cmd) {
    case 'add': {
      if (pos.length < 2) throw new UsageError('usage: add <amount> <category>');
      const cents = toCents(pos[0]);
      const category = normCategory(pos[1]);
      const date = opt.date || today();
      if (!validDate(date)) throw new UsageError(`invalid date: ${date}`);
      if (opt.repeat !== undefined) {
        const n = Number(opt.times);
        if (opt.repeat !== 'monthly' || !Number.isInteger(n) || n < 1) throw new UsageError('use --repeat monthly --times N');
        store.snapshot();
        const ids = [];
        for (let k = 0; k < n; k++) ids.push(ledger.addCents({ cents, category, date: addMonths(date, k), note: opt.note }).id);
        store.save();
        console.log(`added #${ids[0]}..#${ids[ids.length - 1]}`);
        return 0;
      }
      store.snapshot();
      const t = ledger.addCents({ cents, category, date, note: opt.note });
      store.save();
      console.log(`added #${t.id}`);
      return 0;
    }
    case 'list': {
      for (const d of ['from', 'to']) if (opt[d] && !validDate(opt[d])) throw new UsageError(`invalid date: ${opt[d]}`);
      const items = ledger.list({ category: opt.category, from: opt.from, to: opt.to });
      if (opt.json) console.log(JSON.stringify(items));
      else for (const t of items) console.log([`#${t.id}`, t.date, fmt(Math.round(t.amount * 100)), t.category, t.note].filter((x) => x !== '').join(' '));
      return 0;
    }
    case 'balance': {
      if (opt['by-category']) {
        const by = {};
        for (const t of ledger.tx) by[t.category] = (by[t.category] || 0) + t.amount;
        Object.entries(by).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).forEach(([c, v]) => console.log(`${c}: ${fmt(v)}`));
      } else console.log(`balance: ${fmt(ledger.tx.reduce((s, t) => s + t.amount, 0))}`);
      return 0;
    }
    case 'delete': {
      ledger.remove(Number(pos[0]));
      console.log(`deleted #${Number(pos[0])}`);
      return 0;
    }
    case 'edit': {
      const fields = {};
      for (const k of ['amount', 'category', 'date', 'note']) if (opt[k] !== undefined) fields[k] = opt[k];
      ledger.update(Number(pos[0]), fields);
      console.log(`updated #${Number(pos[0])}`);
      return 0;
    }
    case 'budget': {
      if (pos[0] === 'set') {
        const cents = toCents(pos[2]);
        if (cents <= 0) throw new UsageError('budget must be positive');
        const cat = normCategory(pos[1]);
        store.snapshot();
        store.data.budgets[cat] = cents;
        store.save();
        console.log(`budget ${cat} ${fmt(cents)}`);
        return 0;
      }
      if (pos[0] === 'status') {
        const month = opt.month || today().slice(0, 7);
        for (const cat of Object.keys(store.data.budgets).sort()) {
          const limit = store.data.budgets[cat];
          const spent = -ledger.tx.filter((t) => t.category === cat && t.date.startsWith(month) && t.amount < 0).reduce((s, t) => s + t.amount, 0);
          const left = limit - spent;
          console.log(`${cat} spent ${fmt(spent)} of ${fmt(limit)} left ${fmt(left)}${left < 0 ? ' !' : ''}`);
        }
        return 0;
      }
      throw new UsageError('usage: budget set|status');
    }
    case 'import': {
      const rows = parseCsv(fs.readFileSync(pos[0], 'utf8'));
      let ok = 0;
      let bad = 0;
      store.snapshot();
      for (const r of rows.slice(1)) {
        try {
          const [date, amount, category, note = ''] = r.cells;
          if (!validDate(date)) throw new Error(`invalid date ${date}`);
          ledger.addCents({ cents: toCents(amount), category: normCategory(category), date, note });
          ok++;
        } catch (e) { bad++; console.error(`line ${r.line}: ${e.message}`); }
      }
      store.save();
      console.log(`imported ${ok}`);
      return bad ? 1 : 0;
    }
    case 'export': {
      const items = ledger.list({});
      if (opt.format === 'json') console.log(JSON.stringify(items));
      else if (opt.format === 'csv') {
        console.log('id,date,amount,category,note');
        for (const t of items) console.log([t.id, t.date, fmt(Math.round(t.amount * 100)), csvField(t.category), csvField(t.note)].join(','));
      } else throw new UsageError('--format csv|json');
      return 0;
    }
    case 'report': {
      const m = opt.month;
      if (!/^\d{4}-\d{2}$/.test(m || '')) throw new UsageError('--month YYYY-MM');
      const tx = ledger.tx.filter((t) => t.date.startsWith(m));
      const income = tx.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const exp = -tx.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
      const by = {};
      for (const t of tx) if (t.amount < 0) by[t.category] = (by[t.category] || 0) - t.amount;
      const top = Object.entries(by).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3);
      console.log(`month: ${m}\nincome: ${fmt(income)}\nexpenses: ${fmt(exp)}\nnet: ${fmt(income - exp)}\ntop: ${top.length ? top.map(([c, v]) => `${c} ${fmt(v)}`).join(', ') : 'none'}`);
      return 0;
    }
    case 'undo': {
      if (!store.undo()) { console.log('nothing to undo'); return 1; }
      console.log('undone');
      return 0;
    }
    default:
      throw new UsageError(`unknown command: ${cmd}`);
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  console.error(e.message);
  process.exitCode = e instanceof UsageError || e.code === 'ENOENT' ? 2 : 1;
}
