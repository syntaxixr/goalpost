const test = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../src');

test('replaces placeholders', () => {
  assert.equal(render('Hi {{name}}!', { name: 'Ann' }), 'Hi Ann!');
});
