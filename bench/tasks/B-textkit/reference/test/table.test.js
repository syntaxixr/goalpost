const test = require('node:test');
const assert = require('node:assert/strict');
const { formatTable } = require('../src');

test('pads columns', () => {
  assert.equal(formatTable([['a', 'bb'], ['ccc', 'd']]), 'a   | bb\nccc | d');
});
