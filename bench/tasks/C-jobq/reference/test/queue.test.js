'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createQueue } = require('../src');
const { tmpFile } = require('./helpers');

test('push and pop in order', async () => {
  const q = await createQueue(tmpFile());
  await q.push('a');
  await q.push('b');
  const job = await q.pop();
  assert.equal(job.payload, 'a');
  assert.equal(job.status, 'running');
});

test('priority wins over age', async () => {
  const q = await createQueue(tmpFile());
  await q.push('low');
  await q.push('high', { priority: 5 });
  assert.equal((await q.pop()).payload, 'high');
});

test('failed jobs are retried up to maxAttempts', async () => {
  const q = await createQueue(tmpFile());
  const job = await q.push('x', { maxAttempts: 2 });
  await q.pop();
  assert.equal((await q.fail(job.id, new Error('boom'))).status, 'pending');
  await q.pop();
  const j2 = await q.fail(job.id, 'boom again');
  assert.equal(j2.status, 'failed');
  assert.equal(j2.error, 'boom again');
});

test('unknown id is an error', async () => {
  const q = await createQueue(tmpFile());
  await assert.rejects(q.complete(42, null), /not found/);
});

test('state survives reopening the file', async () => {
  const f = tmpFile();
  const q = await createQueue(f);
  await q.push({ n: 1 });
  assert.equal(await (await createQueue(f)).size(), 1);
});
