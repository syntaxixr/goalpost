'use strict';

// Render rows (arrays of cells) as a plain-text table with columns separated by " | ".
function formatTable(rows, opts = {}) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => r.map((c, i) => String(c).padEnd(widths[i])).join(' | ')).join('\n');
}

module.exports = { formatTable };
