'use strict';
// Hidden grader for task C (jobq callbacks -> promises). The agent never sees this file.
// Usage: node grade.js <workdir> [out.json]
const fs = require('fs');
const path = require('path');
const { createGrader, tmpDir, run, eq, main } = require('../../lib/harness');

const work = path.resolve(process.argv[2] || '.');
const g = createGrader('C-jobq');
let lib = null;
const load = () => {
  if (!lib) lib = require(path.join(work, 'src', 'index.js'));
  return lib;
};
const tmpFile = () => path.join(tmpDir('jobq-grade-'), 'q.json');
const isThenable = (v) => !!v && typeof v.then === 'function';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Call a function the promise way and make sure it neither needs nor waits for a callback.
async function promised(label, call) {
  const v = call();
  if (!isThenable(v)) throw new Error(`${label} did not return a Promise`);
  return v;
}

// ---------- project health ----------
g.check('health', 'npm test (node --test) passes', () => {
  const r = run(process.execPath, ['--test'], { cwd: work, timeout: 180000 });
  const tests = Number((r.out.match(/ℹ tests (\d+)/) || [])[1] || 0);
  return { ok: r.code === 0 && tests >= 10, detail: `exit ${r.code}, tests ${tests}` };
});
g.check('health', 'tests use the promise API (no done-callbacks left)', () => {
  const dir = path.join(work, 'test');
  const text = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const doneStyle = (text.match(/\(t,\s*done\)|\bdone\(\)/g) || []).length;
  return { ok: doneStyle === 0 && /await/.test(text), detail: `done-callback uses: ${doneStyle}` };
});
g.check('health', 'examples/basic.js runs and prints the results', () => {
  const r = run(process.execPath, [path.join(work, 'examples', 'basic.js')], { cwd: work, timeout: 30000 });
  const ok = r.code === 0 && /job 1 done: 2/.test(r.out) && /job 3 done: 6/.test(r.out) && /processed 3/.test(r.out);
  return { ok, detail: `${r.code} ${r.out.slice(0, 200)} ${r.err.slice(0, 200)}` };
});
g.check('health', 'README shows the async API', () => {
  const t = fs.readFileSync(path.join(work, 'README.md'), 'utf8');
  return { ok: /await/.test(t) && !/\(err,\s*\w+\)\s*=>/.test(t), detail: 'needs await examples and no (err, x) => callbacks' };
});

// ---------- no callbacks left in src ----------
g.check('style', 'src/ has no callback plumbing left', () => {
  const dir = path.join(work, 'src');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/\b(cb|callback|done)\s*\(/.test(text)) offenders.push(`${f}: calls cb/callback/done`);
    if (/\(\s*err\s*,/.test(text)) offenders.push(`${f}: (err, ...) handler`);
    if (/process\.nextTick\(\s*cb/.test(text)) offenders.push(`${f}: nextTick(cb)`);
  }
  return { ok: offenders.length === 0, detail: offenders.join('; ') };
});

// ---------- store ----------
g.check('store', 'load/save return promises; missing file = empty queue', async () => {
  const { store } = load();
  const f = tmpFile();
  const empty = await promised('store.load', () => store.load(f));
  await promised('store.save', () => store.save(f, { nextId: 5, jobs: [] }));
  const back = await store.load(f);
  return eq([empty, back.nextId], [{ nextId: 1, jobs: [] }, 5]);
});
g.check('store', 'corrupt file rejects', async () => {
  const { store } = load();
  const f = tmpFile();
  fs.writeFileSync(f, '{nope');
  try {
    await store.load(f);
    return { ok: false, detail: 'resolved' };
  } catch (e) {
    return { ok: /corrupt/.test(e.message), detail: e.message };
  }
});

// ---------- queue ----------
g.check('queue', 'createQueue and every queue method return promises', async () => {
  const { createQueue } = load();
  const q = await promised('createQueue', () => createQueue(tmpFile()));
  const j = await promised('push', () => q.push('a', { maxAttempts: 1 }));
  await promised('push without opts', () => q.push('b'));
  await promised('peek', () => q.peek());
  await promised('size', () => q.size());
  await promised('list', () => q.list());
  await promised('get', () => q.get(j.id));
  await promised('pop', () => q.pop());
  await promised('fail', () => q.fail(j.id, new Error('x')));
  await promised('retry', () => q.retry(j.id));
  const p2 = await q.pop();
  await promised('complete', () => q.complete(p2.id, 1));
  await promised('clear', () => q.clear());
  return true;
});
g.check('queue', 'FIFO with priority', async () => {
  const q = await load().createQueue(tmpFile());
  await q.push('a');
  await q.push('b', { priority: 5 });
  await q.push('c');
  const order = [];
  for (let i = 0; i < 3; i++) order.push((await q.pop()).payload);
  return eq([order, await q.pop()], [['b', 'a', 'c'], null]);
});
g.check('queue', 'peek does not change state; size counts pending', async () => {
  const q = await load().createQueue(tmpFile());
  await q.push(1);
  await q.push(2);
  const p = await q.peek();
  return eq([p.payload, p.status, await q.size()], [1, 'pending', 2]);
});
g.check('queue', 'fail/retry lifecycle with maxAttempts', async () => {
  const q = await load().createQueue(tmpFile());
  const job = await q.push('x', { maxAttempts: 2 });
  await q.pop();
  const a = { ...(await q.fail(job.id, new Error('boom'))) };
  await q.pop();
  const b = { ...(await q.fail(job.id, 'again')) };
  const c = { ...(await q.retry(job.id)) };
  return eq([a.status, b.status, b.error, c.status, c.attempts], ['pending', 'failed', 'again', 'pending', 0]);
});
g.check('queue', 'complete stores the result; clear removes done jobs and returns the count', async () => {
  const q = await load().createQueue(tmpFile());
  await q.push(1);
  await q.push(2);
  const j = await q.pop();
  const done = await q.complete(j.id, { ok: true });
  const removed = await q.clear();
  return eq([done.status, done.result, removed, (await q.list()).length], ['done', { ok: true }, 1, 1]);
});
g.check('queue', 'list filters by status', async () => {
  const q = await load().createQueue(tmpFile());
  await q.push(1);
  await q.push(2);
  await q.pop();
  return eq([(await q.list({ status: 'running' })).length, (await q.list({ status: 'pending' })).length, (await q.list()).length], [1, 1, 2]);
});
g.check('queue', 'unknown id rejects with "not found" (complete, fail, get, retry)', async () => {
  const q = await load().createQueue(tmpFile());
  const calls = [() => q.complete(9, 1), () => q.fail(9, 'x'), () => q.get(9), () => q.retry(9)];
  for (const c of calls) {
    try {
      await c();
      return { ok: false, detail: 'resolved' };
    } catch (e) {
      if (!/not found/.test(e.message)) return { ok: false, detail: e.message };
    }
  }
  return true;
});
g.check('queue', 'retry of a non-failed job rejects', async () => {
  const q = await load().createQueue(tmpFile());
  const j = await q.push(1);
  try {
    await q.retry(j.id);
    return false;
  } catch (e) {
    return true;
  }
});
g.check('queue', 'state persists across createQueue calls', async () => {
  const f = tmpFile();
  const q = await load().createQueue(f);
  await q.push('keep', { priority: 2 });
  const q2 = await load().createQueue(f);
  const p = await q2.peek();
  return eq([await q2.size(), p.payload, p.priority], [1, 'keep', 2]);
});

// ---------- worker ----------
g.check('worker', 'runWorker with an async handler processes everything', async () => {
  const q = await load().createQueue(tmpFile());
  for (const n of [1, 2, 3, 4]) await q.push(n);
  const stats = await promised('runWorker', () => load().runWorker(q, async (job) => job.payload * 2, { concurrency: 2 }));
  const results = (await q.list({ status: 'done' })).map((j) => j.result).sort();
  return eq([stats, results], [{ processed: 4, failed: 0 }, [2, 4, 6, 8]]);
});
g.check('worker', 'concurrency limit is respected', async () => {
  const q = await load().createQueue(tmpFile());
  for (let i = 0; i < 6; i++) await q.push(i);
  let active = 0;
  let peak = 0;
  await load().runWorker(q, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await sleep(15);
    active -= 1;
  }, { concurrency: 3 });
  return { ok: peak > 1 && peak <= 3, detail: `peak ${peak}` };
});
g.check('worker', 'rejected handlers go through fail() and retries', async () => {
  const q = await load().createQueue(tmpFile());
  await q.push('flaky', { maxAttempts: 2 });
  await q.push('bad');
  let flakyCalls = 0;
  const stats = await load().runWorker(q, async (job) => {
    if (job.payload === 'bad') throw new Error('nope');
    flakyCalls += 1;
    if (flakyCalls === 1) throw new Error('first try fails');
    return 'ok';
  });
  return eq([stats, flakyCalls], [{ processed: 1, failed: 1 }, 2]);
});
g.check('worker', 'default options work (no opts argument)', async () => {
  const q = await load().createQueue(tmpFile());
  await q.push(1);
  return eq(await load().runWorker(q, async () => 'x'), { processed: 1, failed: 0 });
});

// ---------- util ----------
g.check('util', 'delay returns a promise that waits', async () => {
  const start = Date.now();
  await promised('delay', () => load().delay(30));
  return { ok: Date.now() - start >= 25, detail: `${Date.now() - start} ms` };
});
g.check('util', 'withRetry retries an async fn until it succeeds', async () => {
  let n = 0;
  const v = await promised('withRetry', () => load().withRetry(async () => { n += 1; if (n < 3) throw new Error('no'); return 'yes'; }, 3));
  return eq([v, n], ['yes', 3]);
});
g.check('util', 'withRetry rejects with the last error', async () => {
  let n = 0;
  try {
    await load().withRetry(async () => { n += 1; throw new Error(`fail ${n}`); }, 2);
    return false;
  } catch (e) {
    return eq([e.message, n], ['fail 2', 2]);
  }
});
g.check('util', 'mapLimit keeps order and respects the limit', async () => {
  let active = 0;
  let peak = 0;
  const out = await promised('mapLimit', () => load().mapLimit([40, 10, 30, 20, 5], 2, async (ms) => {
    active += 1;
    peak = Math.max(peak, active);
    await sleep(ms);
    active -= 1;
    return ms / 5;
  }));
  return eq([out, peak], [[8, 2, 6, 4, 1], 2]);
});
g.check('util', 'mapLimit rejects when an item fails; empty input resolves to []', async () => {
  const empty = await load().mapLimit([], 3, async (x) => x);
  try {
    await load().mapLimit([1, 2, 3], 2, async (x) => { if (x === 2) throw new Error('two'); return x; });
    return false;
  } catch (e) {
    return eq([empty, e.message], [[], 'two']);
  }
});

main(g);
