const test = require('node:test');
const assert = require('node:assert/strict');
const { pluralize } = require('../src');

test('regular nouns', () => {
  assert.equal(pluralize('cat'), 'cats');
  assert.equal(pluralize('city'), 'cities');
});

test('y after a vowel just adds s', () => {
  assert.equal(pluralize('day'), 'days');
});

test('singular for one', () => {
  assert.equal(pluralize('cat', 1), 'cat');
});
