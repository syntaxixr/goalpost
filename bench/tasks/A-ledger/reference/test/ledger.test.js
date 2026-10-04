const test = require('node:test');
const assert = require('node:assert');
const { toCents, fmt, validDate, addMonths } = require('../src/ledger');
test('cents', () => { assert.equal(toCents('-12.5'), -1250); assert.throws(() => toCents('1.234')); });
test('fmt', () => { assert.equal(fmt(-1250), '-12.50'); assert.equal(fmt(30), '0.30'); });
test('dates', () => { assert.ok(validDate('2024-02-29')); assert.ok(!validDate('2025-02-30')); });
test('months', () => { assert.equal(addMonths('2025-01-31', 1), '2025-02-28'); });
test('months leap', () => { assert.equal(addMonths('2024-01-31', 1), '2024-02-29'); });
