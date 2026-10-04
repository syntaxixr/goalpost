'use strict';
const store = require('./store');

class Queue {
  constructor(file, data) {
    this.file = file;
    this.data = data;
    this.chain = Promise.resolve();
  }

  async _save() {
    // serialise writes so concurrent callers never interleave temp files
    const run = this.chain.then(() => store.save(this.file, this.data));
    this.chain = run.catch(() => {});
    return run;
  }

  _find(id) {
    const job = this.data.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`job not found: ${id}`);
    return job;
  }

  _next() {
    return this.data.jobs
      .filter((j) => j.status === 'pending')
      .sort((a, b) => b.priority - a.priority || a.id - b.id)[0] || null;
  }

  async push(payload, opts = {}) {
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
    await this._save();
    return job;
  }

  async pop() {
    const job = this._next();
    if (!job) return null;
    job.status = 'running';
    job.attempts += 1;
    await this._save();
    return job;
  }

  async peek() {
    return this._next();
  }

  async get(id) {
    return this._find(id);
  }

  async complete(id, result) {
    const job = this._find(id);
    job.status = 'done';
    job.result = result === undefined ? null : result;
    await this._save();
    return job;
  }

  async fail(id, error) {
    const job = this._find(id);
    job.error = String(error && error.message ? error.message : error);
    job.status = job.attempts < job.maxAttempts ? 'pending' : 'failed';
    await this._save();
    return job;
  }

  async retry(id) {
    const job = this._find(id);
    if (job.status !== 'failed') throw new Error(`job ${id} is not failed`);
    job.status = 'pending';
    job.attempts = 0;
    job.error = null;
    await this._save();
    return job;
  }

  async size() {
    return this.data.jobs.filter((j) => j.status === 'pending').length;
  }

  async list(filter = {}) {
    return this.data.jobs.filter((j) => !filter.status || j.status === filter.status);
  }

  async clear() {
    const before = this.data.jobs.length;
    this.data.jobs = this.data.jobs.filter((j) => j.status !== 'done');
    await this._save();
    return before - this.data.jobs.length;
  }
}

async function createQueue(file) {
  return new Queue(file, await store.load(file));
}

module.exports = { createQueue, Queue };
