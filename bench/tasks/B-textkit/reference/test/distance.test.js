const test = require('node:test');
const assert = require('node:assert/strict');
const { levenshtein } = require('../src');

test('classic example', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
});

test('empty string distance is the other length', () => {
  assert.equal(levenshtein('', 'abc'), 3);
});
