'use strict';

// Replace {{key}} placeholders with values from `data`.
function render(tpl, data) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => data[k]);
}

module.exports = { render };
