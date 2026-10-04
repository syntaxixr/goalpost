'use strict';
// Tiny grading harness shared by the hidden graders. A grader registers checks grouped by
// requirement; the result is JSON with per-check pass/fail so BENCHMARK.md can show exactly
// what was and wasn't done.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function createGrader(name) {
  const checks = [];
  return {
    check(req, title, fn) {
      checks.push({ req, title, fn });
    },
    async run() {
      const results = [];
      for (const c of checks) {
        let ok = false;
        let detail = '';
        try {
          const r = await withTimeout(c.fn(), 60000);
          ok = r === true || (r && r.ok === true);
          if (r && typeof r === 'object' && r.detail) detail = String(r.detail);
          if (r === false) detail = detail || 'returned false';
        } catch (e) {
          ok = false;
          detail = String((e && e.message) || e).slice(0, 400);
        }
        results.push({ req: c.req, title: c.title, ok, detail: detail.slice(0, 400) });
      }
      const reqs = {};
      for (const r of results) {
        reqs[r.req] = reqs[r.req] || { total: 0, passed: 0 };
        reqs[r.req].total += 1;
        if (r.ok) reqs[r.req].passed += 1;
      }
      const reqNames = Object.keys(reqs);
      const summary = {
        task: name,
        checksPassed: results.filter((r) => r.ok).length,
        checksTotal: results.length,
        reqsPassed: reqNames.filter((k) => reqs[k].passed === reqs[k].total).length,
        reqsTotal: reqNames.length,
        reqs,
        results,
      };
      summary.score = summary.checksTotal ? +(summary.checksPassed / summary.checksTotal).toFixed(4) : 0;
      return summary;
    },
  };
}

function withTimeout(value, ms) {
  if (!value || typeof value.then !== 'function') return value;
  let timer;
  return Promise.race([value, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`check timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer));
}

function tmpDir(prefix = 'grade-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, Object.assign({ encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 }, opts));
  return { code: r.status, out: (r.stdout || '').replace(/\r\n/g, '\n'), err: (r.stderr || '').replace(/\r\n/g, '\n'), error: r.error };
}

function lines(s) {
  return String(s || '').replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.length);
}

function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) return { ok: false, detail: `${label} expected ${e.slice(0, 200)} got ${a.slice(0, 200)}` };
  return { ok: true };
}

async function main(grader) {
  const out = await grader.run();
  const target = process.argv[3];
  const text = JSON.stringify(out, null, 2);
  process.stderr.write(`${out.task}: ${out.checksPassed}/${out.checksTotal} checks, ${out.reqsPassed}/${out.reqsTotal} requirements\n`);
  // Exit explicitly: code under test may leave timers or handles open.
  if (target) {
    fs.writeFileSync(target, text);
    process.exit(0);
  } else {
    process.stdout.write(text + '\n', () => process.exit(0));
  }
}

module.exports = { createGrader, tmpDir, run, lines, eq, main };
