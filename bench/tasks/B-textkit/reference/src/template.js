'use strict';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function lookup(data, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);
}

function value(data, expr) {
  const [key, def] = expr.split('|').map((s) => s.trim());
  const v = lookup(data, key);
  if (v === undefined || v === null || v === '') return def !== undefined ? def : '';
  return v;
}

function render(tpl, data) {
  return tpl
    .replace(/\{\{\{\s*([^}]+?)\s*\}\}\}/g, (_, e) => String(value(data, e)))
    .replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, e) => escape(value(data, e)));
}

module.exports = { render };
