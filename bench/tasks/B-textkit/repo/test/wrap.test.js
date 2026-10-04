const test = require('node:test');
const assert = require('node:assert/strict');
const { wordWrap } = require('../src');

test('wraps at word boundaries', () => {
  assert.equal(wordWrap('the quick brown fox jumps', 10), 'the quick\nbrown fox\njumps');
});
