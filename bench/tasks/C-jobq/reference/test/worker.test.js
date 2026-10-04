'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createQueue, runWorker, mapLimit, withRetry, delay } = require('../src');
const { tmpFile } = require('./helpers');

test('worker processes every job', async () => {
  const q = await createQueue(tmpFile());
  for (const n of [1, 2, 3]) await q.push(n);
  assert.deepEqual(await runWorker(q, async (job) => job.payload * 10, { concurrency: 2 }), { processed: 3, failed: 0 });
});

test('worker records failures', async () => {
  const q = await createQueue(tmpFile());
  await q.push('bad');
  assert.deepEqual(await runWorker(q, async () => { throw new Error('nope'); }), { processed: 0, failed: 1 });
});

test('mapLimit keeps order', async () => {
  assert.deepEqual(await mapLimit([30, 10, 20], 2, async (n) => { await delay(n); return n / 10; }), [3, 1, 2]);
});

test('withRetry gives up after the last attempt', async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls += 1; throw new Error('fail ' + calls); }, 3), /fail 3/);
  assert.equal(calls, 3);
});

test('delay waits', async () => {
  const start = Date.now();
  await delay(20);
  assert.ok(Date.now() - start >= 15);
});
