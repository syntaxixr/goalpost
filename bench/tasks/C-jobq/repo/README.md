# jobq

A tiny file-backed job queue with a worker loop. No dependencies.

```js
const { createQueue, runWorker } = require('jobq');

createQueue('queue.json', (err, queue) => {
  queue.push({ email: 'ann@example.com' }, { priority: 1, maxAttempts: 3 }, (err, job) => {
    runWorker(queue, (job, done) => sendEmail(job.payload, done), { concurrency: 4 }, (err, stats) => {
      console.log(stats); // { processed, failed }
    });
  });
});
```

## API

- `createQueue(file, cb)`
- `queue.push(payload, [opts], cb)` — `opts.priority`, `opts.maxAttempts`
- `queue.pop(cb)`, `queue.peek(cb)`, `queue.get(id, cb)`
- `queue.complete(id, result, cb)`, `queue.fail(id, error, cb)`, `queue.retry(id, cb)`
- `queue.size(cb)`, `queue.list([filter], cb)`, `queue.clear(cb)`
- `runWorker(queue, handler, [opts], cb)` — `handler(job, done)`
- `delay(ms, cb)`, `withRetry(fn, attempts, cb)`, `mapLimit(items, limit, iter, cb)`
- `store.load(file, cb)`, `store.save(file, data, cb)`
