'use strict';
const fs = require('fs');

// Read the queue file. A missing file is an empty queue.
function load(file, cb) {
  fs.readFile(file, 'utf8', (err, text) => {
    if (err && err.code === 'ENOENT') return cb(null, { nextId: 1, jobs: [] });
    if (err) return cb(err);
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return cb(new Error(`corrupt queue file ${file}: ${e.message}`));
    }
    cb(null, data);
  });
}

// Write the queue file atomically (temp file + rename).
function save(file, data, cb) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFile(tmp, JSON.stringify(data, null, 2), (err) => {
    if (err) return cb(err);
    fs.rename(tmp, file, cb);
  });
}

module.exports = { load, save };
