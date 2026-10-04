'use strict';

// Process jobs until the queue is empty. handler(job, done) calls done(err, result).
// opts: { concurrency = 1 }. Calls cb(err, { processed, failed }).
function runWorker(queue, handler, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  const concurrency = opts.concurrency || 1;
  const stats = { processed: 0, failed: 0 };
  let active = 0;
  let finished = false;
  let drained = false;

  const finish = (err) => {
    if (finished) return;
    finished = true;
    cb(err || null, stats);
  };

  const tick = () => {
    if (finished) return;
    if (drained && active === 0) return finish();
    while (active < concurrency && !drained) {
      active += 1;
      queue.pop((err, job) => {
        if (err) return finish(err);
        if (!job) {
          active -= 1;
          drained = true;
          return tick();
        }
        handler(job, (herr, result) => {
          const after = (err2, j) => {
            active -= 1;
            if (err2) return finish(err2);
            if (j.status === 'done') stats.processed += 1;
            if (j.status === 'failed') stats.failed += 1;
            if (j.status === 'pending') drained = false;
            tick();
          };
          if (herr) queue.fail(job.id, herr, after);
          else queue.complete(job.id, result, after);
        });
      });
    }
  };
  tick();
}

module.exports = { runWorker };
