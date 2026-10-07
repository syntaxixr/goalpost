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
  const small = cfg.auditMinCriteria > 0 ? ` A goal with fewer than ${cfg.auditMinCriteria} criteria, none of them manual and no test changes, needs no audit.` : '';
  const lines = [
    `goalpost (a Claude Code plugin the user installed) is ${resumed ? 'still ' : ''}active for this /goal. Its files live in .goal/ at the project root.`,
    `Goal: ${clip(condition, 600)}`,
    '',
    'How goals run in this project:',
    '1. Spec first. Fill in .goal/SPEC.md: assumptions (an open question gets a reasonable decision, not a question to the user) and acceptance criteria, one per requirement in the goal and in any file it points to. Each criterion is an observable outcome plus a command that exits 0 only when it holds:',
    '   - [ ] AC-1: GET /health returns 200 with {"ok":true}',
    '     - Verify: `npm test -- health`',
    '   Use `- Verify: manual — <what to look at>` only for what no command can check; the auditor judges those. Keep the spec short: one line per criterion, no prose.' +
      (cfg.specFirst ? ' Project files stay locked until SPEC.md has at least one criterion.' : ''),
    cfg.freezeSpec
      ? '2. The criteria freeze at the first project-file edit. After that they can be added, not removed or reworded, unless "## Spec changes" names the criterion and says why.'
      : '2. Criteria are kept stable; any change is explained under "## Spec changes".',
    `3. \`${VERIFY_CMD}\` runs every check in one call and records the results (\`${VERIFY_CMD} AC-2\` for one). A criterion counts only if its latest check passed after the latest code edit, so run it after a batch of edits, not after each one. goalpost writes evidence.log, state.json, verify.js and AUDIT.md itself. Give a slow suite a long Bash timeout.`,
    `4. Read-only while the goal runs: ${testNote}, plus anything under "## Protected" in SPEC.md. An existing test the goal really must change (an API migration, a removed feature) goes under "## Test changes" with the reason; the auditor reviews it. A check passed by editing, skipping or special-casing a test, or by hardcoding the expected output, does not count.`,
    '5. .goal/PROGRESS.md is for picking the work up again after a context compaction. A line at each milestone is enough.',
    cfg.requireAudit
      ? `6. When every criterion passes, run the auditor subagent once (Agent tool, subagent_type "${cfg.auditAgent}") with a one-line prompt such as "Audit .goal/SPEC.md". Stopping is blocked until it returns VERDICT: PASS for the current code.${small}`
      : '6. Before finishing, every criterion is re-checked against the current code.',
    `7. When the same error comes back ${cfg.sameErrorThreshold} times, change the approach: a different strategy, a smaller step, or the source and docs.`,
    '8. A blocker only the user can remove (credentials, access, a product decision) goes into .goal/BLOCKED.md, starting with a line "USER: <what you need>". That is the one way to stop early. A check that cannot pass as written, a failing audit or a spec problem is yours to fix (record a changed Verify command under "## Spec changes").',
  ];
  return lines.join('\n');
}

function specTemplate(condition) {
  return `# Goal

${condition}

## Assumptions

<!-- One line per decision. -->

## Acceptance criteria

<!-- - [ ] AC-1: <observable outcome>
       - Verify: \`<command that exits 0 only when it holds>\` -->

## Protected

## Test changes

## Spec changes
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
