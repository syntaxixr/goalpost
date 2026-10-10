'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { tmpProject, runHook, runVerify, transcriptGoal, SPEC_OK } = require('./helpers');

const W = (proj, rel, content = 'x') => ({ tool_name: 'Write', tool_input: { file_path: proj.file(rel), content } });

function startGoal(proj, condition = 'make add() work and document it') {
  const r = runHook(proj, 'UserPromptSubmit', { prompt: `/goal ${condition}` });
  assert.equal(r.status, 0, r.stderr);
  return r;
}

// Simulate a finished build: spec written, code edited (freezes the spec), checks run.
function buildAndVerify(proj) {
  proj.write('.goal/SPEC.md', SPEC_OK);
  proj.write('src/add.js', 'module.exports=(a,b)=>a+b;');
  runHook(proj, 'PostToolUse', W(proj, 'src/add.js'));
  proj.write('README.md', 'add(a, b) adds numbers');
  runHook(proj, 'PostToolUse', W(proj, 'README.md'));
  proj.write('.goal/PROGRESS.md', '# Progress\n- built add and README\n');
  runHook(proj, 'PostToolUse', W(proj, '.goal/PROGRESS.md'));
  return runVerify(proj);
}

test('UserPromptSubmit: /goal creates .goal/ and injects the protocol', (t) => {
  const proj = tmpProject({ 'test/add.test.js': 'assert(add(2,3)===5)', 'src/x.spec.ts': '' });
  t.after(proj.cleanup);
  const r = startGoal(proj);
  const ctx = r.json.hookSpecificOutput.additionalContext;
  assert.equal(r.json.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(ctx, /goalpost/);
  assert.match(ctx, /node \.goal\/verify\.js/);
  assert.match(ctx, /goalpost:auditor/);
  assert.match(ctx, /2 test file/);
  for (const f of ['SPEC.md', 'PROGRESS.md', 'evidence.log', 'state.json', 'verify.js']) assert.ok(proj.exists(`.goal/${f}`), f);
  const st = proj.state();
  assert.equal(st.active, true);
  assert.equal(st.sessionId, 'sess-1');
  assert.deepEqual(st.protectedFiles, ['src/x.spec.ts', 'test/add.test.js']);
  assert.match(proj.read('.goal/SPEC.md'), /make add\(\) work/);
});

test('UserPromptSubmit: bare /goal, /goal clear and plain prompts', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  assert.equal(runHook(proj, 'UserPromptSubmit', { prompt: '/goal' }).json, null);
  assert.equal(runHook(proj, 'UserPromptSubmit', { prompt: 'hello there' }).json, null);
  assert.ok(!proj.exists('.goal'));
  startGoal(proj);
  const mid = runHook(proj, 'UserPromptSubmit', { prompt: 'how is it going?' });
  assert.match(mid.json.hookSpecificOutput.additionalContext, /still active/);
  runHook(proj, 'UserPromptSubmit', { prompt: '/goal clear' });
  assert.equal(proj.state().active, false);
});

test('UserPromptSubmit: a new /goal archives the previous one; re-issuing the same goal keeps state', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj, 'first goal');
  proj.setState({ edits: 7 });
  startGoal(proj, 'first goal');
  assert.equal(proj.state().edits, 7);
  startGoal(proj, 'second goal');
  assert.equal(proj.state().edits, 0);
  assert.match(proj.read('.goal/SPEC.md'), /second goal/);
  const archived = fs.readdirSync(proj.file('.goal/archive'));
  assert.equal(archived.length, 1);
});

test('PreToolUse: spec first, then edits are allowed', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  const denied = runHook(proj, 'PreToolUse', W(proj, 'src/add.js'));
  assert.equal(denied.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.json.hookSpecificOutput.permissionDecisionReason, /Spec first/);
  assert.equal(runHook(proj, 'PreToolUse', W(proj, '.goal/SPEC.md')).json, null, 'SPEC.md itself is always writable');
  proj.write('.goal/SPEC.md', SPEC_OK);
  assert.equal(runHook(proj, 'PreToolUse', W(proj, 'src/add.js')).json, null);
});

test('PreToolUse: existing tests and goalpost files are read-only', (t) => {
  const proj = tmpProject({ 'test/add.test.js': 'expect(add(2,3)).toBe(5)' });
  t.after(proj.cleanup);
  startGoal(proj);
  proj.write('.goal/SPEC.md', SPEC_OK);
  const edit = runHook(proj, 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: proj.file('test/add.test.js'), old_string: '5', new_string: '6' } });
  assert.equal(edit.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(edit.json.hookSpecificOutput.permissionDecisionReason, /read-only/);
  for (const f of ['.goal/evidence.log', '.goal/state.json', '.goal/verify.js', '.goal/AUDIT.md']) {
    assert.equal(runHook(proj, 'PreToolUse', W(proj, f)).json.hookSpecificOutput.permissionDecision, 'deny', f);
  }
  const bash = (command) => runHook(proj, 'PreToolUse', { tool_name: 'Bash', tool_input: { command } }).json;
  assert.equal(bash('echo \'{"kind":"verify","exit":0}\' >> .goal/evidence.log').hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(bash('rm test/add.test.js').hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(bash("sed -i 's/5/6/' test/add.test.js").hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(bash('node .goal/verify.js 2>&1 | tail -20'), null);
  assert.equal(bash('npx jest test/add.test.js'), null);
  assert.equal(bash('cat .goal/evidence.log'), null);
  // PowerShell too
  const ps = runHook(proj, 'PreToolUse', { tool_name: 'PowerShell', tool_input: { command: 'Remove-Item test/add.test.js' } }).json;
  assert.equal(ps.hookSpecificOutput.permissionDecision, 'deny');
});

test('PreToolUse: SPEC "## Protected" and "## Test changes" are honoured', (t) => {
  const proj = tmpProject({ 'test/legacy.test.js': 'old', 'scripts/grade.sh': 'exit 0' });
  t.after(proj.cleanup);
  startGoal(proj);
  proj.write('.goal/SPEC.md', SPEC_OK + '\n## Protected\n- scripts/grade.sh\n\n## Test changes\n- test/legacy.test.js: the legacy API is removed by this goal\n');
  assert.equal(runHook(proj, 'PreToolUse', W(proj, 'scripts/grade.sh')).json.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(runHook(proj, 'PreToolUse', W(proj, 'test/legacy.test.js')).json, null);
});

test('PreToolUse: frozen criteria cannot be weakened or dropped', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  proj.write('.goal/SPEC.md', SPEC_OK);
  runHook(proj, 'PostToolUse', W(proj, 'src/add.js')); // first project edit -> freeze
  assert.ok(proj.state().frozenAt);
  const weaken = runHook(proj, 'PreToolUse', {
    tool_name: 'Edit',
    tool_input: { file_path: proj.file('.goal/SPEC.md'), old_string: "require('./src/add.js')(2,3)===5", new_string: 'true' },
  });
  assert.equal(weaken.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(weaken.json.hookSpecificOutput.permissionDecisionReason, /AC-1/);
  const tick = runHook(proj, 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: proj.file('.goal/SPEC.md'), old_string: '- [ ] AC-2', new_string: '- [x] AC-2' } });
  assert.equal(tick.json, null);
  const add = runHook(proj, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: proj.file('.goal/SPEC.md'), content: SPEC_OK + '- [ ] AC-3: more\n  - Verify: `true`\n' } });
  assert.equal(add.json, null);
  const drop = runHook(proj, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: proj.file('.goal/SPEC.md'), content: SPEC_OK.split('- [ ] AC-2')[0] } });
  assert.equal(drop.json.hookSpecificOutput.permissionDecision, 'deny');
  const explained = runHook(proj, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: proj.file('.goal/SPEC.md'), content: SPEC_OK.split('- [ ] AC-2')[0] + '\n## Spec changes\n- AC-2: user said README is out of scope\n' } });
  assert.equal(explained.json, null);
});

test('PostToolUse: commands land in evidence.log, edits are counted', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  proj.write('.goal/SPEC.md', SPEC_OK);
  runHook(proj, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok' }, duration_ms: 12 });
  runHook(proj, 'PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm run lint' }, error: 'Exit code 2\nlint failed' });
  runHook(proj, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'echo x > src/gen.js' } });
  const cmds = proj.evidence().filter((e) => e.kind === 'cmd');
  assert.deepEqual(cmds.map((c) => [c.cmd, c.exit]), [['npm test', 0], ['npm run lint', 2], ['echo x > src/gen.js', 0]]);
  const st = proj.state();
  assert.equal(st.toolCalls, 3);
  assert.equal(st.edits, 1, 'only the redirect into src/ counts as an edit');
  assert.ok(st.frozenAt, 'first project change froze the spec');
});

test('PostToolUseFailure: the same error three times asks for a new approach', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  const fail = (line) => runHook(proj, 'PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, error: `Exit code 1\nTypeError: cannot read properties of undefined (reading 'x') at src/a.js:${line}` });
  assert.equal(fail(10).json, null);
  assert.equal(fail(12).json, null);
  const third = fail(15).json;
  assert.match(third.hookSpecificOutput.additionalContext, /3 times in a row/);
  assert.equal(third.hookSpecificOutput.hookEventName, 'PostToolUseFailure');
  // a different error resets the streak
  runHook(proj, 'PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'npm test' }, error: 'Exit code 1\nSyntaxError: Unexpected token' });
  assert.equal(proj.state().failureStreak.count, 1);
  // the failing command succeeding resets it too
  runHook(proj, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.equal(proj.state().failureStreak.count, 0);
});

test('PostToolUse: anti-drift reminder every N tool calls', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  fs.writeFileSync(proj.userCfg, JSON.stringify({ reminderEveryToolCalls: 3 }));
  startGoal(proj);
  const read = () => runHook(proj, 'PostToolUse', { tool_name: 'Read', tool_input: { file_path: proj.file('x') } }).json;
  assert.equal(read(), null);
  assert.equal(read(), null);
  assert.match(read().hookSpecificOutput.additionalContext, /goalpost checkpoint/);
});

test('Stop: blocks with concrete reasons until checks pass and the audit is clean', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  let r = runHook(proj, 'Stop', { stop_hook_active: false });
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /no acceptance criteria/);

  proj.write('.goal/SPEC.md', SPEC_OK);
  runHook(proj, 'PostToolUse', W(proj, 'src/add.js'));
  r = runHook(proj, 'Stop', { stop_hook_active: true });
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /AC-1 has not been checked yet/);

  const v = buildAndVerify(proj);
  assert.equal(v.status, 0, v.stdout + v.stderr);
  assert.match(v.stdout, /AC-1 {2}PASS/);
  assert.match(proj.read('.goal/SPEC.md'), /- \[x\] AC-1/);
  r = runHook(proj, 'Stop', { stop_hook_active: true });
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /independent audit/);

  runHook(proj, 'SubagentStop', { agent_type: 'goalpost:auditor', agent_id: 'a1', last_assistant_message: 'AC-1: FAIL — add ignores negatives\nAC-2: PASS\nVERDICT: FAIL' });
  r = runHook(proj, 'Stop', { stop_hook_active: true });
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /add ignores negatives/);
  assert.match(proj.read('.goal/AUDIT.md'), /Verdict: FAIL/);

  runHook(proj, 'SubagentStop', { agent_type: 'goalpost:auditor', agent_id: 'a2', last_assistant_message: 'AC-1: PASS\nAC-2: PASS\nCoverage: PASS\nGaming: PASS\nVERDICT: PASS' });
  r = runHook(proj, 'Stop', { stop_hook_active: true });
  assert.equal(r.json.decision, undefined);
  assert.match(r.json.systemMessage, /done/);
  assert.equal(proj.state().active, false);
  assert.equal(proj.state().phase, 'done');
  // once done, goalpost is quiet
  assert.equal(runHook(proj, 'Stop', {}).json, null);
});

test('Stop: a code edit after verification makes the evidence stale', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  buildAndVerify(proj);
  proj.write('src/add.js', 'module.exports=(a,b)=>a+b; // changed');
  runHook(proj, 'PostToolUse', W(proj, 'src/add.js'));
  const r = runHook(proj, 'Stop', {});
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /out of date/);
});

// Build and verify without ever touching PROGRESS.md.
function buildWithoutNotes(proj, spec = SPEC_OK) {
  proj.write('.goal/SPEC.md', spec);
  proj.write('src/add.js', 'module.exports=(a,b)=>a+b;');
  runHook(proj, 'PostToolUse', W(proj, 'src/add.js'));
  proj.write('README.md', 'add(a, b) adds numbers');
  runHook(proj, 'PostToolUse', W(proj, 'README.md'));
  return runVerify(proj);
}

test('Stop: PROGRESS.md is a hint, never a reason to keep going', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  assert.equal(buildWithoutNotes(proj).status, 0);
  runHook(proj, 'SubagentStop', { agent_type: 'goalpost:auditor', agent_id: 'a1', last_assistant_message: 'AC-1: PASS\nAC-2: PASS\nCoverage: PASS\nGaming: PASS\nVERDICT: PASS' });
  const r = runHook(proj, 'Stop', {});
  assert.equal(r.json.decision, undefined, r.json.reason);
  assert.match(r.json.systemMessage, /done/);
});

test('Stop: auditMinCriteria lets small goals skip the audit, unless a check is manual', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  fs.writeFileSync(proj.userCfg, JSON.stringify({ auditMinCriteria: 3 }));
  startGoal(proj);
  assert.equal(buildWithoutNotes(proj).status, 0);
  const r = runHook(proj, 'Stop', {});
  assert.equal(r.json.decision, undefined, r.json.reason);
  assert.match(r.json.systemMessage, /done/);
  assert.doesNotMatch(r.json.systemMessage, /audit/);

  const proj2 = tmpProject();
  t.after(proj2.cleanup);
  fs.writeFileSync(proj2.userCfg, JSON.stringify({ auditMinCriteria: 3 }));
  startGoal(proj2);
  buildWithoutNotes(proj2, SPEC_OK + '- [ ] AC-3: the README reads well\n  - Verify: manual — read README.md\n');
  const r2 = runHook(proj2, 'Stop', {});
  assert.equal(r2.json.decision, 'block');
  assert.match(r2.json.reason, /independent audit/);
});

test('UserPromptSubmit: the protocol stays short (it is re-read on every turn)', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  const ctx = startGoal(proj).json.hookSpecificOutput.additionalContext;
  assert.ok(ctx.length < 3600, `protocol is ${ctx.length} chars`);
  assert.doesNotMatch(ctx, /STATUS \d/, 'no per-reply status line');
});

test('Stop: failing check shows its output', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  proj.write('.goal/SPEC.md', SPEC_OK);
  proj.write('src/add.js', 'module.exports=(a,b)=>a-b;');
  runHook(proj, 'PostToolUse', W(proj, 'src/add.js'));
  const v = runVerify(proj, ['AC-1']);
  assert.equal(v.status, 1);
  assert.match(v.stdout, /AC-1 {2}FAIL/);
  const r = runHook(proj, 'Stop', {});
  assert.match(r.json.reason, /AC-1 fails its check \(exit 1\)/);
});

test('Stop: no-progress guard releases the goal instead of looping', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  const results = [];
  for (let i = 0; i < 4; i++) results.push(runHook(proj, 'Stop', { stop_hook_active: i > 0 }).json);
  assert.deepEqual(results.slice(0, 3).map((x) => x.decision), ['block', 'block', 'block']);
  assert.equal(results[3].decision, undefined);
  assert.match(results[3].systemMessage, /no progress/);
  assert.equal(proj.state().active, false);
  assert.match(proj.read('.goal/PROGRESS.md'), /goalpost released the goal/);
});

test('Stop: tool use between stops keeps the goal alive', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  for (let i = 0; i < 6; i++) {
    assert.equal(runHook(proj, 'Stop', { stop_hook_active: i > 0 }).json.decision, 'block');
    runHook(proj, 'PostToolUse', { tool_name: 'Read', tool_input: { file_path: proj.file('a') } });
  }
  assert.equal(proj.state().active, true);
});

test('Stop: a blocker marked USER: lets Claude stop at once and tells the user why', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  proj.write('.goal/BLOCKED.md', 'USER: need the Stripe API key to test payments.');
  const r = runHook(proj, 'Stop', {});
  assert.match(r.json.systemMessage, /Stripe API key/);
  assert.equal(proj.state().phase, 'blocked');
});

test('Stop: an unmarked BLOCKED.md gets one challenge, then is honoured if Claude insists', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  proj.write('.goal/BLOCKED.md', 'AC-1 verify command is malformed, auditor must fix it.');
  const first = runHook(proj, 'Stop', {});
  assert.equal(first.json.decision, 'block');
  assert.match(first.json.reason, /only for a blocker that needs the user/);
  assert.equal(proj.state().active, true);
  // Claude re-affirms by rewriting the file without doing any work: now it is honoured
  fs.utimesSync(proj.file('.goal/BLOCKED.md'), new Date(Date.now() + 5000), new Date(Date.now() + 5000));
  const second = runHook(proj, 'Stop', {});
  assert.match(second.json.systemMessage, /malformed/);
  assert.equal(proj.state().phase, 'blocked');
});

test('Stop: an unmarked BLOCKED.md is dismissed when Claude goes back to work', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  proj.write('.goal/BLOCKED.md', 'my own check is broken');
  assert.equal(runHook(proj, 'Stop', {}).json.decision, 'block');
  runHook(proj, 'PostToolUse', { tool_name: 'Read', tool_input: { file_path: proj.file('a') } });
  const r = runHook(proj, 'Stop', { stop_hook_active: true });
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /no acceptance criteria/);
  assert.equal(proj.state().active, true);
  assert.ok(!proj.exists('.goal/BLOCKED.md'));
  assert.ok(proj.exists('.goal/BLOCKED.md.dismissed'));
});

test('Stop: background tasks do not defer the check (a headless session never wakes up)', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  const r = runHook(proj, 'Stop', { background_tasks: [{ id: 'b1', type: 'shell', status: 'running' }] });
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /1 background task\(s\) are still running/);
  assert.equal(proj.state().active, true);
});

test('Stop: follows the built-in /goal — clear and impossible release, "met" does not', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  transcriptGoal(proj, { met: true, condition: 'make add() work and document it', reason: 'agent said done' });
  let r = runHook(proj, 'Stop', {});
  assert.equal(r.json.decision, 'block', 'evaluator "met" is not proof');
  assert.equal(proj.state().evaluator.verdict, 'met');
  assert.match(r.json.systemMessage, /evaluator said "met"/);
  assert.match(r.json.reason, /evaluator accepted the goal/);
  runHook(proj, 'PostToolUse', { tool_name: 'Read', tool_input: {} });
  assert.equal(runHook(proj, 'Stop', {}).json.systemMessage, undefined, 'the notice is shown once');
  transcriptGoal(proj, { met: true, sentinel: true, condition: 'make add() work and document it' });
  r = runHook(proj, 'Stop', {});
  assert.equal(r.json, null);
  assert.equal(proj.state().active, false);
  assert.match(proj.state().released.why, /cleared/);

  const p2 = tmpProject();
  t.after(p2.cleanup);
  startGoal(p2);
  transcriptGoal(p2, { met: false, failed: true, reason: 'needs hardware we do not have' });
  r = runHook(p2, 'Stop', {});
  assert.match(r.json.systemMessage, /impossible/);
  assert.equal(p2.state().active, false);
});

test('Stop: other sessions and disabled config are ignored', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  assert.equal(runHook(proj, 'Stop', { session_id: 'someone-else' }).json, null);
  assert.equal(runHook(proj, 'Stop', {}, { GOALPOST: 'off' }).json, null);
  fs.writeFileSync(proj.userCfg, JSON.stringify({ enabled: false }));
  assert.equal(runHook(proj, 'Stop', {}).json, null);
  assert.equal(runHook(proj, 'PreToolUse', W(proj, 'src/a.js')).json, null);
});

test('Stop: late activation from the transcript when UserPromptSubmit never saw /goal', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  transcriptGoal(proj, { met: false, sentinel: true, condition: 'all tests pass' });
  const r = runHook(proj, 'Stop', { session_id: `late-${Date.now()}` });
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /all tests pass/);
  assert.equal(proj.state().condition, 'all tests pass');
});

test('SessionStart: compaction and resume re-inject the plan; a stale goal is announced on startup', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  proj.write('.goal/SPEC.md', SPEC_OK);
  proj.write('.goal/PROGRESS.md', '# Progress\n- step 1 done, next AC-2\n');
  const c = runHook(proj, 'SessionStart', { source: 'compact' });
  const ctx = c.json.hookSpecificOutput.additionalContext;
  assert.match(ctx, /compacted/);
  assert.match(ctx, /AC-1: add\(2,3\) returns 5/);
  assert.match(ctx, /step 1 done/);
  assert.ok(ctx.length < 10000, 'stays under the 10k hook output cap');
  assert.match(runHook(proj, 'SessionStart', { source: 'resume' }).json.hookSpecificOutput.additionalContext, /resumed/);
  assert.match(runHook(proj, 'SessionStart', { source: 'startup', session_id: 'new' }).json.systemMessage, /unfinished goal/);
  assert.equal(runHook(proj, 'SessionStart', { source: 'clear', session_id: 'new' }).json, null);
});

test('verify.js: runs only the named criteria and reports manual ones', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  startGoal(proj);
  proj.write('.goal/SPEC.md', SPEC_OK + '- [ ] AC-3: looks nice\n  - Verify: manual — open the page\n');
  proj.write('src/add.js', 'module.exports=(a,b)=>a+b;');
  const v = runVerify(proj, ['AC-1', 'AC-3']);
  assert.equal(v.status, 0, v.stdout);
  assert.match(v.stdout, /AC-1 {2}PASS/);
  assert.match(v.stdout, /AC-3 {2}MANUAL/);
  assert.doesNotMatch(v.stdout, /AC-2 {2}/);
  assert.deepEqual(proj.evidence().filter((e) => e.kind === 'verify').map((e) => [e.id, e.exit]), [['AC-1', 0]]);
});

test('hooks are fast on the no-goal path', (t) => {
  const proj = tmpProject();
  t.after(proj.cleanup);
  const times = [];
  for (let i = 0; i < 5; i++) times.push(runHook(proj, 'PostToolUse', { tool_name: 'Read', tool_input: {} }).ms);
  times.sort((a, b) => a - b);
  const median = times[2];
  t.diagnostic(`median no-goal PostToolUse latency: ${median.toFixed(0)} ms (includes node startup)`);
  assert.ok(median < 1500, `too slow: ${median} ms`);
});

test('gp.js selftest drives the real hooks through block, fix, audit and done', () => {
  const { spawnSync } = require('child_process');
  const path = require('path');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'plugin', 'scripts', 'gp.js'), 'selftest'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal((r.stdout.match(/^PASS /gm) || []).length, 7, r.stdout);
  assert.doesNotMatch(r.stdout, /^FAIL /m);
});
