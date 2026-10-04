'use strict';
// Push three numbers, double them in a worker, print the results.
const os = require('os');
const path = require('path');
const fs = require('fs');
const { createQueue, runWorker, delay } = require('../src');

async function main() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jobq-example-')), 'queue.json');
  const queue = await createQueue(file);
  for (const n of [1, 2, 3]) await queue.push(n);
  const stats = await runWorker(queue, async (job) => {
    await delay(5);
    return job.payload * 2;
  }, { concurrency: 2 });
  for (const j of await queue.list({ status: 'done' })) console.log(`job ${j.id} done: ${j.result}`);
  console.log(`processed ${stats.processed}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
