#!/usr/bin/env node
'use strict';
// Benchmark runner: bare /goal vs /goal + goalpost on the tasks in bench/tasks.
//
//   node bench/run-bench.js --round r1 --tasks A,B,C --arms bare,goalpost --reps 1 --parallel 3
//
// Each run gets a fresh copy of the task repo under <work>/<round>/<task>-<arm>-<rep>/ (outside this
// repository, so the agent can't find the hidden graders), a headless `claude -p "/goal ..."`, then the
// hidden grader. Results land in bench/results/<round>/*.json.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { gradeMulti } = require('./lib/grade-multi');

const ROOT = path.resolve(__dirname, '..');
const TASKS = path.join(__dirname, 'tasks');

function parseArgs(argv) {
  const o = { maxUtil: 0.85, round: 'r1', tasks: 'A,B,C', arms: 'bare,goalpost', reps: 1, parallel: 3, model: 'sonnet', timeoutMin: 75, work: 'C:/gpbench/runs', only: '' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    const v = argv[i + 1];
    if (k === 'reps' || k === 'parallel' || k === 'timeoutMin' || k === 'maxUtil') { o[k] = Number(v); i++; } else if (k in o) { o[k] = v; i++; }
  }
  return o;
}

function taskDir(letter) {
  const d = fs.readdirSync(TASKS).find((n) => n.startsWith(letter + '-'));
  if (!d) throw new Error(`no task ${letter}`);
  return path.join(TASKS, d);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function killTree(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)]);
  else try { process.kill(-pid, 'SIGKILL'); } catch (e) { /* gone */ }
}

// Pull numbers out of the stream-json log and the session transcript.
function metrics(streamFile, workdir) {
  const m = { turns: null, costUsd: null, durationMs: null, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, toolCalls: 0, subagents: 0, resultSubtype: null, lastText: '', rate: null, transcript: null, evaluator: [], stopBlocksByGoalpost: 0 };
  if (!fs.existsSync(streamFile)) return m;
  const lines = fs.readFileSync(streamFile, 'utf8').split('\n').filter(Boolean);
  for (const l of lines) {
    let r;
    try { r = JSON.parse(l); } catch (e) { continue; }
    if (r.type === 'assistant' && r.message && Array.isArray(r.message.content)) {
      for (const c of r.message.content) {
        if (c.type === 'tool_use') { m.toolCalls += 1; if (c.name === 'Agent' || c.name === 'Task') m.subagents += 1; }
        if (c.type === 'text' && !r.parent_tool_use_id) m.lastText = c.text;
      }
    }
    if (r.type === 'rate_limit_event' && r.rate_limit_info) m.rate = r.rate_limit_info.unifiedWindows || r.rate_limit_info;
    if (r.type === 'system' && r.subtype === 'init') m.sessionId = r.session_id;
    if (r.type === 'result') {
      m.turns = r.num_turns;
      m.costUsd = r.total_cost_usd;
      m.durationMs = r.duration_ms;
      m.resultSubtype = r.subtype;
      m.terminalReason = r.terminal_reason;
      for (const u of Object.values(r.modelUsage || {})) {
        m.inputTokens += u.inputTokens || 0;
        m.outputTokens += u.outputTokens || 0;
        m.cacheRead += u.cacheReadInputTokens || 0;
        m.cacheWrite += u.cacheCreationInputTokens || 0;
      }
      m.modelUsage = r.modelUsage;
    }
  }
  // The built-in evaluator's verdicts live in the transcript as goal_status records.
  if (m.sessionId) {
    const projDir = path.join(os.homedir(), '.claude', 'projects');
    for (const d of fs.existsSync(projDir) ? fs.readdirSync(projDir) : []) {
      const f = path.join(projDir, d, `${m.sessionId}.jsonl`);
      if (!fs.existsSync(f)) continue;
      m.transcript = f;
      for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
        if (!l.includes('goal_status') && !l.includes('Stop hook feedback') && !l.includes('consecutive times')) continue;
        let r;
        try { r = JSON.parse(l); } catch (e) { continue; }
        const a = r.attachment;
        if (a && a.type === 'goal_status') {
          const kind = a.failed ? 'failed' : a.sentinel ? (a.met ? 'cleared' : 'set') : a.met ? 'met' : 'not_met';
          m.evaluator.push({ kind, ts: r.timestamp, reason: (a.reason || '').slice(0, 300) });
        }
        if (r.type === 'system' && /consecutive times/.test(r.content || '')) m.blockCapHit = true;
      }
    }
  }
  const ev = path.join(workdir, '.goal', 'evidence.log');
  if (fs.existsSync(ev)) {
    const recs = fs.readFileSync(ev, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return {}; } });
    m.goalpost = {
      blocks: recs.filter((r) => r.kind === 'block').length,
      denies: recs.filter((r) => r.kind === 'deny').length,
      verifies: recs.filter((r) => r.kind === 'verify').length,
      audits: recs.filter((r) => r.kind === 'audit').map((r) => r.verdict),
      loops: recs.filter((r) => r.kind === 'loop').length,
      end: (recs.filter((r) => ['done', 'release'].includes(r.kind)).pop() || null),
      evaluatorMetWhileBlocking: recs.filter((r) => r.kind === 'block' && r.evaluator === 'met').length,
    };
    const st = path.join(workdir, '.goal', 'state.json');
    if (fs.existsSync(st)) {
      const s = JSON.parse(fs.readFileSync(st, 'utf8'));
      m.goalpost.state = { active: s.active, phase: s.phase, released: s.released, criteria: s.frozenCriteria ? s.frozenCriteria.length : null, edits: s.edits, toolCalls: s.toolCalls };
    }
  }
  return m;
}

function runOne(job, opts) {
  return new Promise((resolve) => {
    const { task, arm, rep } = job;
    const tdir = taskDir(task);
    const name = `${path.basename(tdir)}-${arm}-${rep}`;
    const roundDir = path.join(opts.work, opts.round);
    const workdir = path.join(roundDir, name);
    fs.rmSync(workdir, { recursive: true, force: true });
    copyDir(path.join(tdir, 'repo'), workdir);
    git(workdir, ['init', '-q']);
    git(workdir, ['add', '-A']);
    git(workdir, ['-c', 'user.name=bench', '-c', 'user.email=bench@example.com', 'commit', '-q', '-m', 'task start']);
    const prompt = fs.readFileSync(path.join(tdir, 'prompt.txt'), 'utf8').trim();
    const args = ['-p', prompt, '--setting-sources', 'project,local', '--model', opts.model, '--permission-mode', 'bypassPermissions',
      '--output-format', 'stream-json', '--verbose', '--include-hook-events'];
    if (arm === 'goalpost') args.push('--plugin-dir', opts.pluginCopy);
    const streamFile = path.join(roundDir, `${name}.stream.jsonl`);
    const errFile = path.join(roundDir, `${name}.err.txt`);
    const out = fs.openSync(streamFile, 'w');
    const err = fs.openSync(errFile, 'w');
    const started = Date.now();
    const env = Object.assign({}, process.env);
    delete env.CLAUDE_PROJECT_DIR;
    const child = spawn(opts.claudeBin, args, { cwd: workdir, stdio: ['ignore', out, err], env, windowsHide: true, shell: opts.claudeShell });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, opts.timeoutMin * 60000);
    log(`start ${name}`);
    child.on('exit', (code) => {
      clearTimeout(timer);
      fs.closeSync(out);
      fs.closeSync(err);
      const wallSecs = Math.round((Date.now() - started) / 1000);
      log(`end ${name} exit=${code} ${wallSecs}s${timedOut ? ' TIMEOUT' : ''} — grading`);
      const streamText = fs.existsSync(streamFile) ? fs.readFileSync(streamFile, 'utf8') : '';
      if (code !== 0 && !timedOut && (/"status":"rejected"/.test(streamText) || /rate_limit_error|usage limit|overloaded_error/i.test(streamText))) {
        const invDir = path.join(__dirname, 'results', opts.round, 'invalid');
        fs.mkdirSync(invDir, { recursive: true });
        fs.writeFileSync(path.join(invDir, `${name}.${Date.now()}.json`), JSON.stringify({ name, exit: code, wallSecs, reason: 'cut off by the account rate limit' }, null, 2));
        log(`invalid ${name}: cut off by the account rate limit — will retry`);
        resolve({ retry: true, job });
        return;
      }
      const gradeFile = path.join(roundDir, `${name}.grade.json`);
      const grade = gradeMulti(tdir, workdir, gradeFile, 3) || { error: 'grader crashed' };
      const diff = git(workdir, ['diff', '--stat', 'HEAD']).stdout.split('\n').slice(-2).join(' ').trim();
      const res = {
        name, task: path.basename(tdir), arm, rep, round: opts.round, model: opts.model, claudeVersion: opts.claudeVersion, exit: code, timedOut, wallSecs,
        startedAt: new Date(started).toISOString(), score: grade && grade.score, checks: grade && `${grade.checksPassed}/${grade.checksTotal}`,
        reqs: grade && `${grade.reqsPassed}/${grade.reqsTotal}`, grade, diff, metrics: metrics(streamFile, workdir),
      };
      const resDir = path.join(__dirname, 'results', opts.round);
      fs.mkdirSync(resDir, { recursive: true });
      // no local user names in published results
      const text = JSON.stringify(res, null, 2).replace(/[A-Za-z]:(?:\\\\|\\|\/)+Users(?:\\\\|\\|\/)+[^\\/"]+/g, '~');
      fs.writeFileSync(path.join(resDir, `${name}.json`), text);
      log(`done ${name}: score ${res.score} (${res.checks}) cost $${res.metrics.costUsd} turns ${res.metrics.turns}`);
      resolve(res);
    });
  });
}

// Shared account limits: before each launch, look at the latest 5-hour window utilisation reported in
// any stream of this round (or ask a tiny Haiku call) and wait for the reset when it is too high.
function latestRate(roundDir) {
  let best = null;
  for (const f of fs.existsSync(roundDir) ? fs.readdirSync(roundDir).filter((x) => x.endsWith('.stream.jsonl')) : []) {
    const full = path.join(roundDir, f);
    if (Date.now() - fs.statSync(full).mtimeMs > 5 * 60000) continue;
    const text = fs.readFileSync(full, 'utf8');
    const i = text.lastIndexOf('"rate_limit_event"');
    if (i < 0) continue;
    const start = text.lastIndexOf('\n', i) + 1;
    const end = text.indexOf('\n', i);
    const line = text.slice(start, end < 0 ? undefined : end);
    try {
      const w = JSON.parse(line).rate_limit_info.unifiedWindows.five_hour;
      if (!best || w.utilization > best.utilization) best = w;
    } catch (e) { /* partial line */ }
  }
  if (best) return best;
  const r = spawnSync(OPTS.claudeBin, ['-p', 'ok', '--model', 'haiku', '--setting-sources', 'project,local', '--output-format', 'stream-json', '--verbose'], { encoding: 'utf8', cwd: roundDir, timeout: 120000 });
  for (const l of (r.stdout || '').split('\n')) {
    try { const o = JSON.parse(l); if (o.type === 'rate_limit_event') return o.rate_limit_info.unifiedWindows.five_hour; } catch (e) { /* skip */ }
  }
  return null;
}

async function waitForQuota(opts) {
  for (;;) {
    const w = latestRate(path.join(opts.work, opts.round));
    if (!w || w.utilization < opts.maxUtil) return;
    const until = w.resetsAt * 1000 + 90000;
    log(`5h window at ${Math.round(w.utilization * 100)}% — waiting until ${new Date(until).toISOString().slice(11, 16)} UTC`);
    await new Promise((r) => setTimeout(r, Math.max(60000, Math.min(until - Date.now(), 30 * 60000))));
  }
}

function log(msg) {
  const line = `${new Date().toISOString().slice(11, 19)} ${msg}`;
  console.log(line);
  try { fs.appendFileSync(path.join(__dirname, 'results', 'bench.log'), line + '\n'); } catch (e) { /* first run */ }
}

let OPTS = null;
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  OPTS = opts;
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  // The plugin is loaded from a copy outside this repo so the agent can't wander into bench/.
  opts.pluginCopy = path.join(opts.work, opts.round, '_plugin');
  fs.rmSync(opts.pluginCopy, { recursive: true, force: true });
  copyDir(path.join(ROOT, 'plugin'), opts.pluginCopy);
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
  const candidates = (which.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  // Spawn the real binary, not the npm .cmd shim: no shell means the "/goal ..." prompt reaches it untouched.
  const real = candidates
    .map((c) => path.join(path.dirname(c), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'))
    .find((p) => fs.existsSync(p));
  opts.claudeBin = process.env.CLAUDE_BIN || real || candidates.find((c) => /\.exe$/i.test(c)) || candidates[0] || 'claude';
  opts.claudeShell = /\.cmd$/i.test(opts.claudeBin);
  opts.claudeVersion = (spawnSync(opts.claudeBin, ['--version'], { encoding: 'utf8' }).stdout || '').trim();
  log(`round ${opts.round}: tasks ${opts.tasks} arms ${opts.arms} reps ${opts.reps} model ${opts.model} claude=${opts.claudeBin}`);
  const jobs = [];
  for (let rep = 1; rep <= opts.reps; rep++) {
    for (const task of opts.tasks.split(',')) for (const arm of opts.arms.split(',')) jobs.push({ task, arm, rep });
  }
  // Resume: a job whose result file exists is done.
  const resDir = path.join(__dirname, 'results', opts.round);
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i];
    const name = `${path.basename(taskDir(j.task))}-${j.arm}-${j.rep}`;
    if (fs.existsSync(path.join(resDir, `${name}.json`))) { log(`skip ${name}: already has a result`); jobs.splice(i, 1); }
  }
  const results = [];
  const queue = jobs.slice();
  const lanes = Array.from({ length: Math.max(1, opts.parallel) }, async (_, i) => {
    await new Promise((r) => setTimeout(r, i * 20000)); // stagger starts
    while (queue.length) {
      await waitForQuota(opts);
      if (!queue.length) break;
      const job = queue.shift();
      const r = await runOne(job, opts);
      if (r && r.retry) {
        job.tries = (job.tries || 0) + 1;
        if (job.tries < 4) queue.push(job);
        continue;
      }
      results.push(r);
    }
  });
  await Promise.all(lanes);
  log(`round ${opts.round} finished: ${results.filter(Boolean).map((r) => `${r.name}=${r.score}`).join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
