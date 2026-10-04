'use strict';
// "Is this goal really done?" — computed from files on disk, never from what the model says.
const { goalPaths } = require('./state');
const { parseSpec, tampered } = require('./spec');
const { readEvidence, criteriaStatus } = require('./evidence');
const { readText, mtimeMs, clip, lastLines } = require('./util');

const VERIFY_CMD = 'node .goal/verify.js';

function computeStatus(root, state, cfg) {
  const p = goalPaths(root);
  const specText = readText(p.spec, '');
  const spec = parseSpec(specText);
  const evidence = readEvidence(root);
  const st = criteriaStatus(spec.criteria, evidence, state);
  const problems = [];
  const criteria = spec.criteria;

  if (!criteria.length) {
    problems.push({
      kind: 'no_spec',
      msg: 'No acceptance criteria in .goal/SPEC.md yet. Add them: `- [ ] AC-1: <observable outcome>` with an indented `- Verify: `<command that exits 0 only when it holds>`` line under each.',
    });
  }
  if (spec.duplicates.length) {
    problems.push({ kind: 'duplicate', msg: `Duplicate criterion ids in SPEC.md: ${spec.duplicates.join(', ')}. Give each criterion its own id.` });
  }
  if (state.frozenCriteria) {
    for (const t of tampered(state.frozenCriteria, spec)) {
      const f = t.frozen;
      problems.push({
        kind: 'tampered',
        id: t.id,
        msg: `${t.id} was ${t.kind === 'removed' ? 'removed' : 'changed'} after the spec froze. Restore it as "${clip(f.text, 160)}"${f.verify ? ` with Verify: \`${clip(f.verify, 120)}\`` : ''}, or add a line under "## Spec changes" that names ${t.id} and says why.`,
      });
    }
  }

  const byKind = { noverify: [], fail: [], never: [], changed: [], stale: [], manual: [], pass: [] };
  for (const c of criteria) byKind[st[c.id].status].push(c);
  for (const c of byKind.noverify) {
    problems.push({ kind: 'noverify', id: c.id, msg: `${c.id} has no Verify line. Add \`- Verify: \`<command>\`\` (or \`- Verify: manual — <what to check>\`).` });
  }
  for (const c of byKind.fail) {
    const r = st[c.id].rec;
    const tail = r && r.tail ? `\n    last output: ${clip(lastLines(r.tail, 3).replace(/\n/g, ' | '), 300)}` : '';
    problems.push({ kind: 'fail', id: c.id, msg: `${c.id} fails its check (exit ${r.exit}): "${clip(c.text, 100)}". Fix it, then run \`${VERIFY_CMD} ${c.id}\`.${tail}` });
  }
  for (const c of byKind.never) {
    problems.push({ kind: 'never', id: c.id, msg: `${c.id} has not been checked yet: "${clip(c.text, 100)}". When it's built, run \`${VERIFY_CMD} ${c.id}\`.` });
  }
  for (const c of byKind.changed) {
    problems.push({ kind: 'changed', id: c.id, msg: `${c.id}: its Verify command changed after the last check. Run \`${VERIFY_CMD} ${c.id}\` again.` });
  }
  if (byKind.stale.length) {
    const ids = byKind.stale.map((c) => c.id);
    problems.push({ kind: 'stale', ids, msg: `${ids.join(', ')} passed before the latest code edit, so the result is out of date. Run \`${VERIFY_CMD}\` again.` });
  }

  const automated = criteria.filter((c) => !c.manual && c.verify);
  const passing = byKind.pass.length;
  const allAutomatedPass = criteria.length > 0 && byKind.pass.length === automated.length && automated.length + byKind.manual.length === criteria.length;

  // PROGRESS.md discipline.
  const progressMtime = mtimeMs(p.progress);
  const progressTouched = progressMtime > (state.startedMs || 0) || (state.progressUpdatedAt || 0) > (state.startedMs || 0);
  if (state.edits > 0 && !progressTouched) {
    problems.push({ kind: 'progress', msg: '.goal/PROGRESS.md has not been updated since the goal started. Add what is done, what is next and any blockers.' });
  } else if (cfg.progressEveryEdits > 0 && state.editsSinceProgress >= cfg.progressEveryEdits) {
    problems.push({ kind: 'progress', msg: `.goal/PROGRESS.md is behind: ${state.editsSinceProgress} file edits since the last update.` });
  }

  // Fresh-eyes audit, only once everything else is green.
  let auditOk = !cfg.requireAudit;
  if (cfg.requireAudit && allAutomatedPass && problems.length === 0) {
    const a = state.audit;
    if (!a) {
      problems.push({ kind: 'audit', msg: `All ${automated.length} automated checks pass. Last step: an independent audit. Launch the auditor subagent (Agent tool, subagent_type "${cfg.auditAgent}") and ask it to audit .goal/SPEC.md. Stopping is allowed once it returns VERDICT: PASS.` });
    } else if ((a.atMs || 0) < (state.lastEditAt || 0)) {
      problems.push({ kind: 'audit', msg: `Code changed after the last audit. Run the auditor again (subagent_type "${cfg.auditAgent}").` });
    } else if (a.verdict !== 'PASS') {
      problems.push({ kind: 'audit_fail', msg: `The auditor did not pass the work (verdict: ${a.verdict || 'none'}). Its findings:\n${clip(a.findings || a.summary || '', 1500)}\nFix these, run \`${VERIFY_CMD}\`, then run the auditor again.` });
    } else {
      auditOk = true;
    }
  } else if (cfg.requireAudit && state.audit && state.audit.verdict === 'PASS' && (state.audit.atMs || 0) >= (state.lastEditAt || 0)) {
    auditOk = true;
  }

  const done = passing + (auditOk ? byKind.manual.length : 0);
  return {
    spec,
    criteria,
    statusById: st,
    problems,
    done,
    total: criteria.length,
    passing,
    automated: automated.length,
    manual: byKind.manual.length,
    complete: problems.length === 0 && criteria.length > 0,
  };
}

function statusLine(s) {
  if (!s.total) return 'no acceptance criteria yet';
  const parts = s.criteria.map((c) => {
    const k = s.statusById[c.id].status;
    const mark = k === 'pass' ? '✓' : k === 'fail' ? '✗' : k === 'manual' ? '?' : k === 'stale' ? '~' : '·';
    return `${c.id}${mark}`;
  });
  return `${s.done}/${s.total} verified — ${parts.join(' ')}`;
}

module.exports = { computeStatus, statusLine, VERIFY_CMD };
