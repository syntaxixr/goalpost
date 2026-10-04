'use strict';

function delay(ms, cb) {
  setTimeout(() => cb(null), ms);
}

// Call fn(done) until it succeeds, at most `attempts` times.
function withRetry(fn, attempts, cb) {
  let left = attempts;
  const attempt = () => {
    left -= 1;
    fn((err, result) => {
      if (!err) return cb(null, result);
      if (left <= 0) return cb(err);
      attempt();
    });
  };
  attempt();
}

// Map items with iter(item, done), at most `limit` at a time; results keep input order.
function mapLimit(items, limit, iter, cb) {
  const results = new Array(items.length);
  let next = 0;
  let running = 0;
  let finished = 0;
  let failed = false;
  if (!items.length) return process.nextTick(cb, null, results);
  const launch = () => {
    while (running < limit && next < items.length && !failed) {
      const i = next++;
      running += 1;
      iter(items[i], (err, value) => {
        running -= 1;
        if (failed) return;
        if (err) {
          failed = true;
          return cb(err);
        }
        results[i] = value;
        finished += 1;
        if (finished === items.length) return cb(null, results);
        launch();
      });
    }
  };
  launch();
}

module.exports = { delay, withRetry, mapLimit };
