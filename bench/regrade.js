#!/usr/bin/env node
'use strict';
// Re-run the hidden graders for every run of a round and update the result files.
// Used after a grader fix, so every run is scored by the same grader version.
//   node bench/regrade.js r1 [r2 ...]
const fs = require('fs');
const path = require('path');
const { gradeMulti } = require('./lib/grade-multi');

const WORK = process.env.BENCH_WORK || 'C:/gpbench/runs';
for (const round of process.argv.slice(2)) {
  const dir = path.join(__dirname, 'results', round);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !x.endsWith('.grade.json'))) {
    const file = path.join(dir, f);
    const res = JSON.parse(fs.readFileSync(file, 'utf8'));
    const workdir = path.join(WORK, round, res.name);
    const taskDir = path.join(__dirname, 'tasks', res.task);
    const out = path.join(WORK, round, `${res.name}.grade.json`);
    const grade = gradeMulti(taskDir, workdir, out, 3);
    const before = res.checks;
    Object.assign(res, { grade, score: grade.score, checks: `${grade.checksPassed}/${grade.checksTotal}`, reqs: `${grade.reqsPassed}/${grade.reqsTotal}`, regradedAt: new Date().toISOString() });
    fs.writeFileSync(file, JSON.stringify(res, null, 2));
    console.log(`${round}/${res.name}: ${before} -> ${res.checks}${grade.flaky.length ? `  (flaky: ${grade.flaky.join('; ')})` : ''}`);
  }
}
