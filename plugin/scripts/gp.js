#!/usr/bin/env node
'use strict';
// Small CLI behind the /goalpost:* commands: status | on | off | release.
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

function main(argv) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const cmd = (argv[0] || 'status').toLowerCase();
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
