'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { store } = require('../src');
const { tmpFile } = require('./helpers');

test('missing file loads as an empty queue', async () => {
  assert.deepEqual(await store.load(tmpFile()), { nextId: 1, jobs: [] });
});

test('save then load round-trips', async () => {
  const f = tmpFile();
  await store.save(f, { nextId: 2, jobs: [{ id: 1 }] });
  assert.equal((await store.load(f)).nextId, 2);
});

test('corrupt file is an error', async () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{nope');
  await assert.rejects(store.load(f), /corrupt/);
});
