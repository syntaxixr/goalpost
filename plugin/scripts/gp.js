#!/usr/bin/env node
'use strict';
// Small CLI behind the /goalpost:* commands: status | on | off | release | selftest.
const fs = require('fs');
const path = require('path');
const { readJSON, writeJSONAtomic, clip } = require('./lib/util');
const { loadConfig, userConfigPath } = require('./lib/config');
const { goalPaths, loadState, release } = require('./lib/state');
const { computeStatus, statusLine } = require('./lib/status');
const { appendEvidence } = require('./lib/evidence');

function setEnabled(value) {
  const file = userConfigPath();
  const cfg = readJSON(file, {}) || {};
  cfg.enabled = value;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJSONAtomic(file, cfg);
  return file;
}

function status(root) {
  const cfg = loadConfig(root);
  const st = loadState(root);
  const lines = [`goalpost is ${cfg.enabled ? 'ON' : 'OFF'} (config: ${userConfigPath()}${fs.existsSync(path.join(root, '.claude', 'goalpost.json')) ? ' + .claude/goalpost.json' : ''})`];
  if (!st) {
    lines.push('No goal in this project yet (.goal/state.json not found). Start one with /goal <condition>.');
    return lines.join('\n');
  }
  const s = computeStatus(root, st, cfg);
  const mins = Math.round((Date.now() - (st.startedMs || Date.now())) / 60000);
  lines.push(`Goal: ${clip(st.condition, 300)}`);
  lines.push(`State: ${st.active ? 'active' : st.phase}${st.released ? ` — ${st.released.why}` : ''} · started ${mins} min ago · spec ${st.frozenAt ? 'frozen' : 'not frozen yet'}`);
  lines.push(`Criteria: ${statusLine(s)}`);
  lines.push(`Edits: ${st.edits} · tool calls: ${st.toolCalls} · stop blocks: ${st.stopBlocks} · audits: ${st.audits || 0}${st.audit ? ` (last: ${st.audit.verdict})` : ''}`);
  if (st.evaluator) lines.push(`Built-in /goal evaluator: ${st.evaluator.verdict}${st.evaluator.reason ? ` — ${clip(st.evaluator.reason, 200)}` : ''}`);
  if (s.problems.length) {
    lines.push('Open items:');
    for (const pr of s.problems.slice(0, 8)) lines.push(`- ${clip(pr.msg.split('\n')[0], 220)}`);
  }
  lines.push(`Files: ${path.relative(root, goalPaths(root).dir)}/SPEC.md, PROGRESS.md, evidence.log`);
  return lines.join('\n');
}

// Proves the guard on this machine: drives the real hooks through a throwaway goal whose check fails first.
function selftest(argv) {
  const os = require('os');
  const { spawnSync } = require('child_process');
  const keep = argv.includes('--keep');
  const realCfg = loadConfig(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goalpost-selftest-'));
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: dir, GOALPOST_USER_CONFIG: path.join(dir, '.selftest-config.json'), GOALPOST: '' });
  const hook = (event, input) => {
    const payload = Object.assign({ session_id: 'selftest', transcript_path: path.join(dir, '.selftest-transcript.jsonl'), cwd: dir, hook_event_name: event }, input);
    const r = spawnSync(process.execPath, [path.join(__dirname, 'hook.js'), event], { input: JSON.stringify(payload), encoding: 'utf8', env });
    return r.stdout && r.stdout.trim() ? JSON.parse(r.stdout) : null;
  };
  const verify = () => spawnSync(process.execPath, [path.join(__dirname, 'verify.js')], { cwd: dir, encoding: 'utf8', env: Object.assign({}, env, { GOALPOST_ROOT: dir }) });
  const write = (rel, text) => fs.writeFileSync(path.join(dir, rel), text);
  const edit = (rel) => hook('PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(dir, rel), content: '' } });
  const results = [];
  const step = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${clip(String(detail).split('\n')[0], 160)}` : ''}`);
  };

  console.log(`goalpost selftest — node ${process.version} — your goalpost is ${realCfg.enabled ? 'ON' : 'OFF (the test runs anyway)'}`);
  console.log(`throwaway project: ${dir}\n`);
  const start = hook('UserPromptSubmit', { prompt: '/goal ok.txt contains the word ok' });
  step('/goal starts goalpost and writes .goal/', !!(start && fs.existsSync(path.join(dir, '.goal', 'SPEC.md'))));

  const early = hook('PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'ok.txt'), content: 'ok' } });
  const denied = early && early.hookSpecificOutput && early.hookSpecificOutput.permissionDecision === 'deny';
  step('a project edit before the spec has criteria is blocked', denied, denied && early.hookSpecificOutput.permissionDecisionReason);

  write('.goal/SPEC.md', '# Goal\n\nok.txt contains the word ok\n\n## Acceptance criteria\n\n- [ ] AC-1: ok.txt contains ok\n  - Verify: `node -e "process.exit(require(\'fs\').readFileSync(\'ok.txt\',\'utf8\').trim()===\'ok\'?0:1)"`\n');
  write('ok.txt', 'not yet\n');
  edit('ok.txt');
  const v1 = verify();
  step('the check fails while the work is wrong', v1.status !== 0 && /AC-1 {2}FAIL/.test(v1.stdout), (v1.stdout.match(/AC-1 .*/) || [''])[0]);
  const s1 = hook('Stop', {});
  step('stopping is blocked, with the reason', !!(s1 && s1.decision === 'block' && /AC-1/.test(s1.reason)), s1 && s1.reason.split('\n').find((l) => /AC-1/.test(l)));

  write('ok.txt', 'ok\n');
  edit('ok.txt');
  const v2 = verify();
  step('after the fix the check passes', v2.status === 0 && /AC-1 {2}PASS/.test(v2.stdout));
  const s2 = hook('Stop', {});
  step('stopping still waits for the fresh-eyes audit', !!(s2 && s2.decision === 'block' && /audit/i.test(s2.reason)));

  hook('SubagentStop', { agent_type: realCfg.auditAgent || 'goalpost:auditor', agent_id: 'selftest', last_assistant_message: 'AC-1: PASS — ok.txt says ok\nCoverage: PASS\nGaming: PASS\nVERDICT: PASS' });
  const s3 = hook('Stop', {});
  step('with checks and audit green, Claude may stop', !!(s3 && !s3.decision && /done/.test(s3.systemMessage || '')), s3 && s3.systemMessage);

  const log = path.join(dir, '.goal', 'evidence.log');
  const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  console.log(`\nevidence.log has ${lines.length} records (start, deny, verify, block, audit, done): ${keep ? log : '.goal/evidence.log in your project during a real goal'}`);
  if (!keep) fs.rmSync(dir, { recursive: true, force: true });
  const ok = results.every(Boolean);
  console.log(ok
    ? '\nAll steps passed: the hooks enforce on this machine. In a real session, `/goalpost:status` after a /goal shows it as active; if it says there is no goal, Claude Code is not running the hooks (check that `node` is on PATH).'
    : '\nSome steps failed: goalpost would not enforce correctly here. Please open an issue with this output: https://github.com/syntaxixr/goalpost/issues');
  return ok ? 0 : 1;
}

function main(argv) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const cmd = (argv[0] || 'status').toLowerCase();
  if (cmd === 'selftest') return selftest(argv.slice(1));
  if (cmd === 'off') {
    const f = setEnabled(false);
    console.log(`goalpost is now OFF for all projects (${f}). /goal keeps working as usual, without goalpost's checks. Turn it back on with /goalpost:on.`);
    return 0;
  }
  if (cmd === 'on') {
    const f = setEnabled(true);
    console.log(`goalpost is now ON (${f}). The next /goal gets a spec, checks and an audit.`);
    return 0;
  }
  if (cmd === 'release') {
    const st = loadState(root);
    if (!st || !st.active) {
      console.log('goalpost: no active goal to release.');
      return 0;
    }
    appendEvidence(root, { kind: 'release', why: 'user' });
    release(root, st, 'released by the user (/goalpost:release)');
    console.log(`goalpost: stopped enforcing "${clip(st.condition, 120)}". The built-in /goal (if still set) keeps running; use /goal clear to stop it too.`);
    return 0;
  }
  console.log(status(root));
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, status };
