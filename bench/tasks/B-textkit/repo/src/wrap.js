'use strict';

// Wrap text so that no line is longer than `width` characters.
function wordWrap(text, width) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) {
      lines.push(line);
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

module.exports = { wordWrap };
