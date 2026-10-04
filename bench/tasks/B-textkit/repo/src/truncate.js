'use strict';

// Shorten `str` to at most `max` characters, adding an ellipsis when it was cut.
function truncate(str, max, ellipsis = '…') {
  if (str.length <= max) return str;
  return str.slice(0, max) + ellipsis;
}

module.exports = { truncate };
