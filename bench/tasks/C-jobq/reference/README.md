# jobq

A tiny file-backed job queue with a worker loop. No dependencies. Every function returns a Promise.

```js
const { createQueue, runWorker } = require('jobq');

const queue = await createQueue('queue.json');
await queue.push({ email: 'ann@example.com' }, { priority: 1, maxAttempts: 3 });
const stats = await runWorker(queue, async (job) => sendEmail(job.payload), { concurrency: 4 });
console.log(stats); // { processed, failed }
```

## API

- `await createQueue(file)`
- `await queue.push(payload, [opts])`, `pop()`, `peek()`, `get(id)`, `complete(id, result)`, `fail(id, error)`, `retry(id)`, `size()`, `list([filter])`, `clear()`
- `await runWorker(queue, async handler, [opts])`
- `await delay(ms)`, `await withRetry(asyncFn, attempts)`, `await mapLimit(items, limit, asyncIter)`
- `await store.load(file)`, `await store.save(file, data)`
