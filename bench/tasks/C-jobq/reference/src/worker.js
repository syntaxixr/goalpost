'use strict';

async function runWorker(queue, handler, opts = {}) {
  const concurrency = opts.concurrency || 1;
  const stats = { processed: 0, failed: 0 };
  const lane = async () => {
    for (;;) {
      const job = await queue.pop();
      if (!job) return;
      let j;
      try {
        const result = await handler(job);
        j = await queue.complete(job.id, result);
      } catch (err) {
        j = await queue.fail(job.id, err);
      }
      if (j.status === 'done') stats.processed += 1;
      if (j.status === 'failed') stats.failed += 1;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, lane));
  return stats;
}

module.exports = { runWorker };
