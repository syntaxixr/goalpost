'use strict';
// Everything goalpost says to Claude. Written as plain project facts, not as "system" orders:
// the hooks docs warn that out-of-band command phrasing can trip prompt-injection defenses.
const { clip, readText } = require('./util');
const { goalPaths } = require('./state');
const { statusLine, VERIFY_CMD } = require('./status');

function protocol({ condition, protectedFiles, cfg, resumed }) {
  const tests = protectedFiles || [];
  const testNote = cfg.protectExistingTests && tests.length
    ? `the ${tests.length} test file(s) that existed when the goal started (e.g. ${tests.slice(0, 3).join(', ')})`
    : 'any test files listed in SPEC.md';
  const lines = [
    `goalpost (a Claude Code plugin the user installed) is ${resumed ? 'still ' : ''}active for this /goal. Its files live in .goal/ at the project root.`,
    `Goal: ${clip(condition, 600)}`,
    '',
    'How goals run in this project:',
    '1. Spec before code. .goal/SPEC.md has a template: the goal verbatim, written assumptions (an open question gets a reasonable decision written down, not a question to the user), milestones for bigger work, and acceptance criteria. Each criterion is an observable outcome plus a command that exits 0 only when it holds, for example:',
    '   - [ ] AC-1: GET /health returns 200 with {"ok":true}',
    '     - Verify: `npm test -- health`',
    '   The criteria cover every requirement in the goal and in any file the goal points to, one criterion per requirement. A check that needs human judgment is written `- Verify: manual — <what to look at>`; the auditor judges those.' +
      (cfg.specFirst ? ' Edits to project files are blocked until SPEC.md has at least one criterion.' : ''),
    cfg.freezeSpec
      ? '2. The spec freezes at the first project-file edit. After that, criteria can be added but not removed or reworded unless "## Spec changes" names the criterion and says why.'
      : '2. Criteria are kept stable; any change is explained under "## Spec changes".',
    `3. Checks run through \`${VERIFY_CMD}\` (all) or \`${VERIFY_CMD} AC-2 AC-5\`. It runs the Verify commands, records exit codes in .goal/evidence.log and ticks or unticks the boxes in SPEC.md. A criterion counts as done only when its latest check passed after the latest code edit. evidence.log, state.json, verify.js and AUDIT.md are written by goalpost only. For a slow suite, give the Bash call a long timeout.`,
    `4. Read-only while the goal runs: ${testNote}, plus anything under "## Protected" in SPEC.md. An existing test that the goal really must change (an API migration, a removed feature) is listed under "## Test changes" with the reason; the auditor reviews those changes. A check passed by editing, skipping or special-casing a test, or by hardcoding the expected output, counts as not done.`,
    '5. After each meaningful step: one line in .goal/PROGRESS.md (done / next / blockers), and the reply ends with a status line such as `STATUS 3/7 verified — next: AC-4`.',
    cfg.requireAudit
      ? `6. When every criterion passes, the auditor subagent (Agent tool, subagent_type "${cfg.auditAgent}") reviews the work with fresh eyes. Stopping is blocked until it returns VERDICT: PASS for the current code.`
      : '6. Before finishing, every criterion is re-checked against the current code.',
    `7. When the same error comes back ${cfg.sameErrorThreshold} times, the approach changes: a different strategy, a smaller step, or reading the source/docs.`,
    '8. A blocker only the user can remove (credentials, access, a product decision) goes into .goal/BLOCKED.md, starting with a line "USER: <what you need>". That is the one way to stop early. A check that cannot pass as written, a failing audit or a spec problem is not a blocker: fix the Verify command (recorded under "## Spec changes") or the code. Everything else is decided and recorded as an assumption.',
  ];
  return lines.join('\n');
}

function specTemplate(condition) {
  return `# Goal

${condition}

## Assumptions

<!-- Open questions answered with a reasonable decision. One line each. -->

## Milestones

<!-- For bigger goals: M1, M2, ... each ending in something you can check. -->

## Acceptance criteria

<!-- One per requirement. Each has an observable outcome and a Verify command that exits 0 only when it holds.
- [ ] AC-1: <observable outcome>
  - Verify: \`<command>\`
-->

## Protected

<!-- Paths/globs that must not change while the goal runs (existing tests are protected automatically). -->

## Test changes

<!-- Existing tests this goal legitimately has to change, one per line with the reason. The auditor reviews them. -->

## Spec changes

<!-- After the freeze: why a criterion was reworded or dropped, naming its id. -->
`;
}

function progressTemplate(condition) {
  return `# Progress

Goal: ${clip(condition, 300)}

<!-- One line per step: what was done, what is next, blockers. Newest at the bottom. -->
`;
}

function recap(root, state, status, cfg, why) {
  const p = goalPaths(root);
  const spec = readText(p.spec, '') || '(SPEC.md is missing)';
  const progress = readText(p.progress, '') || '';
  const parts = [
    `goalpost: the /goal below is still in progress (${why}). This is its current plan and state from .goal/.`,
    `Goal: ${clip(state.condition, 600)}`,
    `Status: ${statusLine(status)}`,
  ];
  if (status.problems.length) {
    parts.push('Open items:');
    for (const pr of status.problems.slice(0, 6)) parts.push(`- ${clip(pr.msg, 400)}`);
  }
  parts.push('', '--- .goal/SPEC.md ---', clip(spec, 4500));
  if (progress.trim()) parts.push('', '--- .goal/PROGRESS.md (latest) ---', progress.length > 1800 ? '…' + progress.slice(-1800) : progress);
  parts.push('', `Rules in short: checks run via \`${VERIFY_CMD}\`; criteria are frozen; existing tests are read-only; finish with the ${cfg.auditAgent} audit; real blockers go to .goal/BLOCKED.md.`);
  return clip(parts.join('\n'), 9500);
}

function blockReason(status, state, cfg) {
  const head = status.total
    ? `goalpost: the goal is not finished yet (${statusLine(status)}).`
    : 'goalpost: the goal has no acceptance criteria yet.';
  const items = status.problems.slice(0, 8).map((pr) => `- ${pr.msg}`);
  const more = status.problems.length > 8 ? [`- …and ${status.problems.length - 8} more (see \`${VERIFY_CMD}\`).`] : [];
  const tail = 'Keep going with the first item. If something truly needs the user, write it to .goal/BLOCKED.md and stop.';
  return [head, 'Remaining:', ...items, ...more, tail].join('\n');
}

function reminder(status) {
  const open = status.problems.slice(0, 4).map((pr) => `- ${clip(pr.msg, 240)}`);
  return [
    `goalpost checkpoint: ${statusLine(status)}.`,
    open.length ? 'Still open:' : 'Nothing open: run the audit if it has not run yet.',
    ...open,
    'Work in progress is checked against .goal/SPEC.md; anything outside it is drift.',
  ].join('\n');
}

function repeatedError(streak, cfg) {
  return [
    `goalpost: the same error has now come back ${streak.count} times in a row:`,
    `  ${clip(streak.sample || streak.sig, 300)}`,
    'Repeating the same fix is unlikely to work. Change the approach: re-read the full error and the code it points to, check the assumption with a minimal reproduction, read the library source or docs, or try a different design.',
    'If it cannot be solved here, note it in .goal/PROGRESS.md and move to another criterion; a blocker only the user can remove goes into .goal/BLOCKED.md.',
  ].join('\n');
}

function blockedChallenge(cfg) {
  return [
    'goalpost: .goal/BLOCKED.md was written. That file is only for a blocker that needs the user: credentials, access, or a product decision.',
    'A check that cannot pass as written, a failing audit or a spec problem is yours to fix: correct the Verify command (record why under "## Spec changes") or fix the code, then run `node .goal/verify.js`.',
    'If the blocker really needs the user, start .goal/BLOCKED.md with a line "USER: <what you need from them>" and stop.',
  ].join('\n');
}

module.exports = {
  blockedChallenge,
  protocol, specTemplate, progressTemplate, recap, blockReason, reminder, repeatedError };
