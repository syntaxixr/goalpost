'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createQueue } = require('../src');
const { tmpFile } = require('./helpers');

test('push and pop in order', (t, done) => {
  createQueue(tmpFile(), (err, q) => {
    assert.ifError(err);
    q.push('a', () => {
      q.push('b', () => {
        q.pop((err2, job) => {
          assert.ifError(err2);
          assert.equal(job.payload, 'a');
          assert.equal(job.status, 'running');
          done();
        });
      });
    });
  });
});

test('priority wins over age', (t, done) => {
  createQueue(tmpFile(), (err, q) => {
    q.push('low', () => {
      q.push('high', { priority: 5 }, () => {
        q.pop((err2, job) => {
          assert.equal(job.payload, 'high');
          done();
        });
      });
    });
  });
});

test('failed jobs are retried up to maxAttempts', (t, done) => {
  createQueue(tmpFile(), (err, q) => {
    q.push('x', { maxAttempts: 2 }, (e1, job) => {
      q.pop(() => {
        q.fail(job.id, new Error('boom'), (e2, j) => {
          assert.equal(j.status, 'pending');
          q.pop(() => {
            q.fail(job.id, 'boom again', (e3, j2) => {
              assert.equal(j2.status, 'failed');
              assert.equal(j2.error, 'boom again');
              done();
            });
          });
        });
      });
    });
  });
});

test('unknown id is an error', (t, done) => {
  createQueue(tmpFile(), (err, q) => {
    q.complete(42, null, (e) => {
      assert.match(e.message, /not found/);
      done();
    });
  });
});

test('state survives reopening the file', (t, done) => {
  const f = tmpFile();
  createQueue(f, (err, q) => {
    q.push({ n: 1 }, () => {
      createQueue(f, (err2, q2) => {
        q2.size((e, n) => {
          assert.equal(n, 1);
          done();
        });
      });
    });
  });
});
