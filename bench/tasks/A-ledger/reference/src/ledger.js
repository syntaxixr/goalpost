'use strict';
// Reference solution for task A. Used only to validate the hidden grader.
const fs = require('fs');
const path = require('path');

class UsageError extends Error {}

function toCents(input) {
  const s = String(input).trim();
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(s)) throw new UsageError(`invalid amount: ${input}`);
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace(/^[+-]/, '').split('.');
  const cents = Number(i) * 100 + Number((f + '00').slice(0, 2));
  return neg ? -cents : cents;
}
function fmt(cents) {
  const neg = cents < 0;
  const a = Math.abs(cents);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}
function validDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return false;
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function normCategory(c) {
  const s = String(c == null ? '' : c).trim().toLowerCase();
  if (!s) throw new UsageError('category must not be empty');
  return s;
}
function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const total = (m - 1) + n;
  const ny = y + Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

class Store {
  constructor(file) {
    this.file = file;
    this.data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    this.data.nextId = this.data.nextId || 1;
    this.data.transactions = this.data.transactions || [];
    this.data.budgets = this.data.budgets || {};
    this.data.history = this.data.history || [];
  }
  snapshot() {
    const { history, ...rest } = this.data;
    this.data.history.push(JSON.stringify(rest));
    if (this.data.history.length > 20) this.data.history.shift();
  }
  undo() {
    const prev = this.data.history.pop();
    if (!prev) return false;
    Object.assign(this.data, JSON.parse(prev));
    this.save();
    return true;
  }
  save() {
    const tmp = path.join(path.dirname(path.resolve(this.file)), `.${path.basename(this.file)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

const pub = (t) => ({ id: t.id, date: t.date, amount: t.amount / 100, category: t.category, note: t.note });

class Ledger {
  constructor(file) { this.store = new Store(file); }
  get tx() { return this.store.data.transactions; }
  addCents({ cents, category, date, note }) {
    const t = { id: this.store.data.nextId++, date, amount: cents, category, note: note || '' };
    this.tx.push(t);
    return t;
  }
  add({ amount, category, date, note }) {
    const d = date || today();
    if (!validDate(d)) throw new UsageError(`invalid date: ${d}`);
    this.store.snapshot();
    const t = this.addCents({ cents: toCents(amount), category: normCategory(category), date: d, note });
    this.store.save();
    return pub(t);
  }
  list({ category, from, to } = {}) {
    return this.tx
      .filter((t) => (!category || t.category === String(category).toLowerCase()) && (!from || t.date >= from) && (!to || t.date <= to))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
      .map(pub);
  }
  balance() { return this.tx.reduce((s, t) => s + t.amount, 0) / 100; }
  find(id) {
    const t = this.tx.find((x) => x.id === Number(id));
    if (!t) throw new UsageError(`no transaction #${id}`);
    return t;
  }
  remove(id) {
    const t = this.find(id);
    this.store.snapshot();
    this.store.data.transactions = this.tx.filter((x) => x !== t);
    this.store.save();
  }
  update(id, fields) {
    const t = this.find(id);
    const next = Object.assign({}, t);
    if (fields.amount !== undefined) next.amount = toCents(fields.amount);
    if (fields.category !== undefined) next.category = normCategory(fields.category);
    if (fields.date !== undefined) { if (!validDate(fields.date)) throw new UsageError(`invalid date: ${fields.date}`); next.date = fields.date; }
    if (fields.note !== undefined) next.note = String(fields.note);
    this.store.snapshot();
    Object.assign(t, next);
    this.store.save();
    return pub(t);
  }
}

module.exports = { Ledger, Store, UsageError, toCents, fmt, validDate, today, normCategory, addMonths };
