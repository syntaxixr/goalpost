'use strict';

function truncate(str, max, ellipsis = '…') {
  const chars = Array.from(str);
  if (chars.length <= max) return str;
  const e = Array.from(ellipsis);
  if (max <= e.length) return chars.slice(0, max).join('');
  return chars.slice(0, max - e.length).join('').replace(/\s+$/, '') + ellipsis;
}

module.exports = { truncate };
