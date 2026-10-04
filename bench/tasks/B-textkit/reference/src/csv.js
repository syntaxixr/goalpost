'use strict';

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let any = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    any = true;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = ''; any = false;
    } else field += c;
  }
  if (any) { row.push(field); rows.push(row); }
  return rows;
}

function parseCSVLine(line) {
  return parseCSV(line)[0] || [''];
}

module.exports = { parseCSVLine, parseCSV };
