'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { store } = require('../src');
const { tmpFile } = require('./helpers');

test('missing file loads as an empty queue', (t, done) => {
  store.load(tmpFile(), (err, data) => {
    assert.ifError(err);
    assert.deepEqual(data, { nextId: 1, jobs: [] });
    done();
  });
});

test('save then load round-trips', (t, done) => {
  const f = tmpFile();
  store.save(f, { nextId: 2, jobs: [{ id: 1 }] }, (err) => {
    assert.ifError(err);
    store.load(f, (err2, data) => {
      assert.ifError(err2);
      assert.equal(data.nextId, 2);
      done();
    });
  });
});

test('corrupt file is an error', (t, done) => {
  const f = tmpFile();
  fs.writeFileSync(f, '{nope');
  store.load(f, (err) => {
    assert.match(err.message, /corrupt/);
    done();
  });
});
