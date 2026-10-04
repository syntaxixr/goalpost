'use strict';

function wrapParagraph(text, width) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (let w of words) {
    while (w.length > width) {
      if (line) { lines.push(line); line = ''; }
      lines.push(w.slice(0, width));
      w = w.slice(width);
    }
    if (!w) continue;
    if (!line) line = w;
    else if (line.length + 1 + w.length <= width) line += ' ' + w;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

function wordWrap(text, width) {
  return String(text)
    .split(/\n[ \t]*\n/)
    .map((p) => wrapParagraph(p, width))
    .filter((p) => p.length)
    .join('\n\n');
}

module.exports = { wordWrap };
