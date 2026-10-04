'use strict';
// Finds the test files that exist when a goal starts. Those become read-only for the goal.
const fs = require('fs');
const path = require('path');
const { matchAny, toPosix } = require('./util');

function findTests(root, cfg) {
  const ignore = new Set((cfg.ignoreDirs || []).map((d) => d.toLowerCase()));
  const limit = cfg.scanLimit || 20000;
  const deadline = Date.now() + 3000;
  const found = [];
  let visited = 0;
  const stack = [''];
  while (stack.length) {
    if (visited > limit || Date.now() > deadline) break;
    const rel = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const ent of entries) {
      visited += 1;
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (ignore.has(ent.name.toLowerCase()) || ent.name.startsWith('.') && ent.name !== '.github') continue;
        stack.push(childRel);
      } else if (ent.isFile() && matchAny(childRel, cfg.testGlobs)) {
        found.push(toPosix(childRel));
      }
    }
  }
  return found.sort();
}

module.exports = { findTests };
