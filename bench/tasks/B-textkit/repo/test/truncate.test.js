const test = require('node:test');
const assert = require('node:assert/strict');
const { truncate } = require('../src');

test('short strings are unchanged', () => {
  assert.equal(truncate('hello', 10), 'hello');
});
