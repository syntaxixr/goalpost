'use strict';
const store = require('./store');

class Queue {
  constructor(file, data) {
    this.file = file;
    this.data = data;
  }

  _save(cb) {
    store.save(this.file, this.data, cb);
  }

  _find(id, cb) {
    const job = this.data.jobs.find((j) => j.id === id);
    if (!job) {
      process.nextTick(cb, new Error(`job not found: ${id}`));
      return null;
    }
    return job;
  }

  _next() {
    return this.data.jobs
      .filter((j) => j.status === 'pending')
      .sort((a, b) => b.priority - a.priority || a.id - b.id)[0] || null;
  }

  // push(payload, [opts], cb) — opts: { priority = 0, maxAttempts = 1 }
  push(payload, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    const job = {
      id: this.data.nextId++,
      payload,
      status: 'pending',
      priority: opts.priority || 0,
      attempts: 0,
      maxAttempts: opts.maxAttempts || 1,
      result: null,
      error: null,
    };
    this.data.jobs.push(job);
    this._save((err) => (err ? cb(err) : cb(null, job)));
  }

  // Take the next pending job (highest priority, then oldest) and mark it running.
  pop(cb) {
    const job = this._next();
    if (!job) return process.nextTick(cb, null, null);
    job.status = 'running';
    job.attempts += 1;
    this._save((err) => (err ? cb(err) : cb(null, job)));
  }

  peek(cb) {
    process.nextTick(cb, null, this._next());
  }

  get(id, cb) {
    const job = this._find(id, cb);
    if (job) process.nextTick(cb, null, job);
  }

  complete(id, result, cb) {
    const job = this._find(id, cb);
    if (!job) return;
    job.status = 'done';
    job.result = result === undefined ? null : result;
    this._save((err) => (err ? cb(err) : cb(null, job)));
  }

  // A failed attempt goes back to pending until maxAttempts is reached.
  fail(id, error, cb) {
    const job = this._find(id, cb);
    if (!job) return;
    job.error = String(error && error.message ? error.message : error);
    job.status = job.attempts < job.maxAttempts ? 'pending' : 'failed';
    this._save((err) => (err ? cb(err) : cb(null, job)));
  }

  retry(id, cb) {
    const job = this._find(id, cb);
    if (!job) return;
    if (job.status !== 'failed') return process.nextTick(cb, new Error(`job ${id} is not failed`));
    job.status = 'pending';
    job.attempts = 0;
    job.error = null;
    this._save((err) => (err ? cb(err) : cb(null, job)));
  }

  size(cb) {
    process.nextTick(cb, null, this.data.jobs.filter((j) => j.status === 'pending').length);
  }

  // list([filter], cb) — filter: { status }
  list(filter, cb) {
    if (typeof filter === 'function') {
      cb = filter;
      filter = {};
    }
    const jobs = this.data.jobs.filter((j) => !filter.status || j.status === filter.status);
    process.nextTick(cb, null, jobs);
  }

  // Remove finished jobs; reports how many were removed.
  clear(cb) {
    const before = this.data.jobs.length;
    this.data.jobs = this.data.jobs.filter((j) => j.status !== 'done');
    const removed = before - this.data.jobs.length;
    this._save((err) => (err ? cb(err) : cb(null, removed)));
  }
}

function createQueue(file, cb) {
  store.load(file, (err, data) => {
    if (err) return cb(err);
    cb(null, new Queue(file, data));
  });
}

module.exports = { createQueue, Queue };
