#!/usr/bin/env node
'use strict';
// Runs the Verify commands from .goal/SPEC.md, records each result in .goal/evidence.log,
// ticks/unticks the SPEC.md boxes, and prints where the goal stands.
// Usually started through the shim: `node .goal/verify.js [AC-1 AC-2 ...]`.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readText, writeFileAtomic, lastLines, clip } = require('./lib/util');
const { loadConfig } = require('./lib/config');
const { goalPaths, loadState } = require('./lib/state');
const { parseSpec, setChecks } = require('./lib/spec');
const { appendEvidence } = require('./lib/evidence');
const { computeStatus, statusLine } = require('./lib/status');

function findGitBash() {
  const cands = [
    process.env.CLAUDE_CODE_GIT_BASH_PATH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  const where = spawnSync('where', ['git'], { encoding: 'utf8' });
  if (where.status === 0) {
    for (const line of where.stdout.split(/\r?\n/)) {
      const guess = path.join(path.dirname(path.dirname(line.trim())), 'bin', 'bash.exe');
      if (line.trim() && fs.existsSync(guess)) return guess;
    }
  }
  return null;
}

function shellFor(pref) {
  const win = process.platform === 'win32';
  if (pref === 'cmd' || (win && pref === 'auto' && !findGitBash())) {
    return { file: process.env.ComSpec || 'cmd.exe', args: (c) => ['/d', '/s', '/c', c], opts: { windowsVerbatimArguments: true }, name: 'cmd' };
  }
  if (pref === 'powershell') return { file: win ? 'powershell.exe' : 'pwsh', args: (c) => ['-NoProfile', '-Command', c], opts: {}, name: 'powershell' };
  if (pref === 'sh') return { file: 'sh', args: (c) => ['-c', c], opts: {}, name: 'sh' };
  if (win) return { file: findGitBash() || 'bash', args: (c) => ['-c', c], opts: {}, name: 'bash' };
  const bash = fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
  return { file: pref === 'bash' ? 'bash' : bash, args: (c) => ['-c', c], opts: {}, name: path.basename(bash) };
}

function main(argv) {
  const root = process.env.GOALPOST_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const p = goalPaths(root);
  const cfg = loadConfig(root);
  const specText = readText(p.spec, null);
  if (specText == null) {
    console.log('goalpost verify: .goal/SPEC.md not found. Start a goal with /goal <condition> first.');
    return 2;
  }
  const spec = parseSpec(specText);
  const wanted = argv.filter((a) => /^AC-\d+$/i.test(a)).map((a) => a.toUpperCase());
  const unknown = wanted.filter((id) => !spec.criteria.some((c) => c.id === id));
  if (unknown.length) console.log(`goalpost verify: no criterion ${unknown.join(', ')} in SPEC.md.`);
  const selected = spec.criteria.filter((c) => !wanted.length || wanted.includes(c.id));
  const runnable = selected.filter((c) => c.verify && !c.manual);
  if (!spec.criteria.length) {
    console.log('goalpost verify: SPEC.md has no acceptance criteria yet (`- [ ] AC-1: ...` with a `- Verify: `<command>`` line).');
    return 2;
  }
  const shell = shellFor(cfg.verifyShell || 'auto');
  const timeoutMs = (Number(cfg.verifyTimeoutSec) || 900) * 1000;
  console.log(`goalpost verify — ${new Date().toLocaleString()} — shell: ${shell.name}`);
  const marks = {};
  let failed = 0;
  for (const c of selected) {
    if (c.manual) {
      console.log(`${c.id}  MANUAL  ${clip(c.verify, 100)} (judged by the auditor)`);
      continue;
    }
    if (!c.verify) {
      console.log(`${c.id}  NO VERIFY LINE — add "- Verify: \`<command>\`" under it`);
      failed += 1;
      continue;
    }
    const start = new Date();
    const res = spawnSync(shell.file, shell.args(c.verify), Object.assign({
      cwd: root,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env: Object.assign({}, process.env, { GOALPOST_VERIFY: '1' }),
    }, shell.opts));
    const ms = Date.now() - start.getTime();
    const output = `${res.stdout || ''}${res.stderr ? (res.stdout ? '\n' : '') + res.stderr : ''}`;
    let exit = res.status;
    let note = '';
    if (res.error && res.error.code === 'ETIMEDOUT') { exit = 124; note = ` (timed out after ${timeoutMs / 1000}s)`; }
    else if (res.error) { exit = 127; note = ` (${res.error.message})`; }
    else if (exit === null) { exit = 128; note = ` (killed by ${res.signal})`; }
    appendEvidence(root, { kind: 'verify', id: c.id, cmd: c.verify, exit, ms, start: start.toISOString(), tail: clip(lastLines(output, 40), 4000) });
    marks[c.id] = exit === 0;
    const secs = (ms / 1000).toFixed(1);
    if (exit === 0) {
      console.log(`${c.id}  PASS  (exit 0, ${secs}s)  ${clip(c.verify, 120)}`);
    } else {
      failed += 1;
      console.log(`${c.id}  FAIL  (exit ${exit}${note}, ${secs}s)  ${clip(c.verify, 120)}`);
      const tail = lastLines(output, 15);
      if (tail.trim()) console.log(tail.split(/\r?\n/).map((l) => `    | ${l}`).join('\n'));
    }
  }
  if (Object.keys(marks).length) {
    const latest = readText(p.spec, specText);
    const updated = setChecks(latest, marks);
    if (updated !== latest) writeFileAtomic(p.spec, updated);
  }
  const state = loadState(root);
  if (state) {
    const status = computeStatus(root, state, cfg);
    console.log(`\nSTATUS ${statusLine(status)}`);
    const open = status.problems.filter((pr) => pr.kind !== 'progress').slice(0, 5);
    if (open.length) console.log('Open:\n' + open.map((pr) => `- ${clip(pr.msg.split('\n')[0], 200)}`).join('\n'));
  } else {
    console.log(`\n${runnable.length - failed}/${runnable.length} checks passed.`);
  }
  return failed ? 1 : 0;
}

if (require.main === module || process.env.GOALPOST_ROOT) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { main, shellFor };
