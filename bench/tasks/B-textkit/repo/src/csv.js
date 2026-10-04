'use strict';

// Split one CSV line into fields.
function parseCSVLine(line) {
  return line.split(',').map((s) => s.replace(/^"|"$/g, ''));
}

module.exports = { parseCSVLine };
