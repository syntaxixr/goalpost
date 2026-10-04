'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createQueue, runWorker, mapLimit, withRetry, delay } = require('../src');
const { tmpFile } = require('./helpers');

test('worker processes every job', (t, done) => {
  createQueue(tmpFile(), (err, q) => {
    q.push(1, () => q.push(2, () => q.push(3, () => {
      runWorker(q, (job, cb) => cb(null, job.payload * 10), { concurrency: 2 }, (e, stats) => {
        assert.ifError(e);
        assert.deepEqual(stats, { processed: 3, failed: 0 });
        done();
      });
    })));
  });
});

test('worker records failures', (t, done) => {
  createQueue(tmpFile(), (err, q) => {
    q.push('bad', () => {
      runWorker(q, (job, cb) => cb(new Error('nope')), (e, stats) => {
        assert.deepEqual(stats, { processed: 0, failed: 1 });
        done();
      });
    });
  });
});

test('mapLimit keeps order', (t, done) => {
  mapLimit([30, 10, 20], 2, (n, cb) => setTimeout(() => cb(null, n / 10), n), (err, out) => {
    assert.deepEqual(out, [3, 1, 2]);
    done();
  });
});

test('withRetry gives up after the last attempt', (t, done) => {
  let calls = 0;
  const fn = (cb) => {
    calls += 1;
    cb(new Error('fail ' + calls));
  };
  withRetry(fn, 3, (err) => {
    assert.equal(calls, 3);
    assert.equal(err.message, 'fail 3');
    done();
  });
});

test('delay waits', (t, done) => {
  const start = Date.now();
  delay(20, () => {
    assert.ok(Date.now() - start >= 15);
    done();
  });
});
