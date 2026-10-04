const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCSVLine } = require('../src');

test('splits simple fields', () => {
  assert.deepEqual(parseCSVLine('a,b,c'), ['a', 'b', 'c']);
});
