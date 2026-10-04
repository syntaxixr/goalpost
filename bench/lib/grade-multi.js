'use strict';
// Grade a workdir several times and keep a check only if it passed every time.
// Intermittent failures (races, timing) are real defects, and one lucky run must not hide them.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function gradeMulti(taskDir, workdir, outFile, times = 3) {
  const runs = [];
  for (let i = 0; i < times; i++) {
    const tmp = `${outFile}.${i}.json`;
    spawnSync(process.execPath, [path.join(taskDir, 'grade.js'), workdir, tmp], { encoding: 'utf8', timeout: 15 * 60000 });
    try { runs.push(JSON.parse(fs.readFileSync(tmp, 'utf8'))); } catch (e) { /* grader crashed: counts as all failed */ }
    try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
  }
  if (!runs.length) return null;
  const base = runs[0];
  const results = base.results.map((r, i) => {
    const all = runs.map((x) => x.results[i]);
    const passes = all.filter((x) => x && x.ok).length;
    const firstFail = all.find((x) => x && !x.ok);
    return { ...r, ok: passes === runs.length, passes, of: runs.length, detail: firstFail ? firstFail.detail : r.detail };
  });
  const reqs = {};
  for (const r of results) {
    reqs[r.req] = reqs[r.req] || { total: 0, passed: 0 };
    reqs[r.req].total += 1;
    if (r.ok) reqs[r.req].passed += 1;
  }
  const out = {
    task: base.task,
    gradedTimes: runs.length,
    checksPassed: results.filter((r) => r.ok).length,
    checksTotal: results.length,
    reqsPassed: Object.values(reqs).filter((q) => q.passed === q.total).length,
    reqsTotal: Object.keys(reqs).length,
    flaky: results.filter((r) => r.passes > 0 && r.passes < r.of).map((r) => r.title),
    reqs,
    results,
  };
  out.score = out.checksTotal ? +(out.checksPassed / out.checksTotal).toFixed(4) : 0;
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  return out;
}

module.exports = { gradeMulti };
