'use strict';
// Push three numbers, double them in a worker, print the results.
const os = require('os');
const path = require('path');
const fs = require('fs');
const { createQueue, runWorker } = require('../src');

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jobq-example-')), 'queue.json');

createQueue(file, (err, queue) => {
  if (err) throw err;
  queue.push(1, () => {
    queue.push(2, () => {
      queue.push(3, () => {
        const double = (job, done) => setTimeout(() => done(null, job.payload * 2), 5);
        runWorker(queue, double, { concurrency: 2 }, (err2, stats) => {
          if (err2) throw err2;
          queue.list({ status: 'done' }, (err3, jobs) => {
            if (err3) throw err3;
            for (const j of jobs) console.log('job ' + j.id + ' done: ' + j.result);
            console.log('processed ' + stats.processed);
          });
        });
      });
    });
  });
});
