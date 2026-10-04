'use strict';

const isNum = (c) => typeof c === 'number' || (typeof c === 'string' && /^-?\d+(\.\d+)?$/.test(c.trim()));

function formatTable(rows, opts = {}) {
  const cols = Math.max(0, ...rows.map((r) => r.length));
  const grid = rows.map((r) => Array.from({ length: cols }, (_, i) => (r[i] === undefined || r[i] === null ? '' : String(r[i]))));
  const widths = Array.from({ length: cols }, (_, i) => Math.max(0, ...grid.map((r) => r[i].length)));
  const body = opts.header ? rows.slice(1) : rows;
  const numeric = Array.from({ length: cols }, (_, i) => {
    const cells = body.map((r) => r[i]).filter((c) => c !== undefined && c !== null && c !== '');
    return cells.length > 0 && cells.every(isNum);
  });
  const line = (r) => r.map((c, i) => (numeric[i] ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join(' | ').replace(/\s+$/, '');
  const out = grid.map(line);
  if (opts.header && out.length) out.splice(1, 0, widths.map((w) => '-'.repeat(w)).join('-|-'));
  return out.join('\n');
}

module.exports = { formatTable };
