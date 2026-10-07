#!/usr/bin/env node
'use strict';
// goalpost hook entry point: `node hook.js <EventName>` with the hook JSON on stdin.
// Every handler fails open: an internal error never blocks Claude, it only skips enforcement.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readStdin, parseJSON, relToRoot, samePath, clip, nowIso, readText, mtimeMs, writeFileAtomic, toPosix } = require('./lib/util');
const { loadConfig } = require('./lib/config');
const { projectRoot, goalPaths, loadState, saveState, newState, isLive, release, archiveGoal } = require('./lib/state');
const { parseSpec, snapshot, normalize } = require('./lib/spec');
const { appendEvidence } = require('./lib/evidence');
const { scanGoalStatus } = require('./lib/transcript');
const { computeStatus, statusLine } = require('./lib/status');
const { findTests } = require('./lib/scan');
const { checkTool, targetPath, EDIT_TOOLS, SHELL_TOOLS, shellModifies } = require('./lib/protect');
const texts = require('./lib/texts');

const CLEAR_WORDS = new Set(['clear', 'stop', 'off', 'reset', 'none', 'cancel']);
const GOAL_RE = /^\s*\/goal(?:\s+([\s\S]*?))?\s*$/;

// ---------- shared pieces ----------

function verifyShim() {
  const target = path.join(__dirname, 'verify.js');
  return [
    '#!/usr/bin/env node',
    '// Written by goalpost. Runs the Verify commands from .goal/SPEC.md and records results in evidence.log.',
    '// Usage: node .goal/verify.js            (all criteria)',
    '//        node .goal/verify.js AC-1 AC-3  (some)',
    "process.env.GOALPOST_ROOT = require('path').resolve(__dirname, '..');",
    `const target = ${JSON.stringify(target)};`,
    "if (!require('fs').existsSync(target)) {",
    "  console.error('goalpost: the plugin was moved or updated; start a new Claude Code session so this file is refreshed.');",
    '  process.exit(2);',
    '}',
    'require(target);',
    '',
  ].join('\n');
}

function writeVerifyShim(root) {
  const p = goalPaths(root);
  const text = verifyShim();
  if (readText(p.verify, '') !== text) {
    fs.mkdirSync(p.dir, { recursive: true });
    writeFileAtomic(p.verify, text);
  }
}

function activate(root, input, cfg, condition) {
  const p = goalPaths(root);
  let st = loadState(root);
  let resumed = false;
  if (st && st.active && st.sessionId === (input.session_id || null) && normalize(st.condition) === normalize(condition)) {
    resumed = true;
  } else {
    // An earlier goal's files go to .goal/archive/. A SPEC.md written by hand (no state.json yet) is kept.
    if (st) archiveGoal(root);
    fs.mkdirSync(p.dir, { recursive: true });
    const tests = cfg.protectExistingTests ? findTests(root, cfg) : [];
    st = newState({ sessionId: input.session_id, condition, protectedFiles: tests });
    if (!fs.existsSync(p.spec)) fs.writeFileSync(p.spec, texts.specTemplate(condition));
    if (!fs.existsSync(p.progress)) fs.writeFileSync(p.progress, texts.progressTemplate(condition));
    try {
      st.transcriptOffset = input.transcript_path ? fs.statSync(input.transcript_path).size : 0;
    } catch (e) {
      st.transcriptOffset = 0;
    }
    appendEvidence(root, { kind: 'start', condition, session: input.session_id || null, protectedFiles: tests.length });
    // Content written before the first save counts as the template, not as a PROGRESS update.
    st.startedMs = Date.now();
    st.startedAt = new Date(st.startedMs).toISOString();
  }
  writeVerifyShim(root);
  saveState(root, st);
  return { st, resumed };
}

// Follow the built-in /goal's own records: cleared by the user, judged impossible, or "met".
function syncTranscript(st, input) {
  if (!input.transcript_path) return;
  const r = scanGoalStatus(input.transcript_path, st.transcriptOffset || 0);
  st.transcriptOffset = r.offset;
  for (const rec of r.records) {
    if (rec.kind === 'set') {
      if (normalize(rec.condition) === normalize(st.condition)) st.evaluator = null;
      continue;
    }
    if (rec.kind === 'not_met') continue;
    st.evaluator = { verdict: rec.kind, at: rec.ts, reason: rec.reason || null };
    if (rec.kind === 'met' && !st.evaluatorMetAt) st.evaluatorMetAt = rec.ts || nowIso();
  }
}

function maybeFreeze(root, st, cfg) {
  if (!cfg.freezeSpec || st.frozenAt) return;
  const spec = parseSpec(readText(goalPaths(root).spec, '') || '');
  if (!spec.criteria.length) return;
  st.frozenAt = nowIso();
  st.frozenCriteria = snapshot(spec);
  st.frozenTestChanges = spec.testChanges;
  st.phase = 'build';
  appendEvidence(root, { kind: 'freeze', criteria: st.frozenCriteria.map((c) => c.id), testChanges: spec.testChanges });
}

function isAuditor(agentType, cfg) {
  return !!agentType && String(agentType).toLowerCase() === String(cfg.auditAgent).toLowerCase();
}

function parseExit(error) {
  const m = String(error || '').match(/Exit code (-?\d+)/i);
  return m ? Number(m[1]) : 1;
}

// A stable fingerprint of an error, so "the same error again" survives changing line numbers and paths.
function errorSignature(tool, error) {
  const text = String(error || '');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const telling = lines.filter((l) => /error|exception|fail|cannot|can't|not found|undefined|traceback|denied|refused|invalid|unexpected|missing/i.test(l) && !/^exit code/i.test(l));
  const pick = (telling.length ? telling.slice(0, 2) : lines.filter((l) => !/^exit code/i.test(l)).slice(0, 2)).join(' | ') || lines[0] || '';
  const sig = pick
    .toLowerCase()
    .replace(/[a-z]:[\\/][^\s:'"]*/gi, '<path>')
    .replace(/(?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+/g, '<path>')
    .replace(/0x[0-9a-f]+/g, '<hex>')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  return { sig: `${tool}:${clip(sig, 240)}`, sample: clip(pick, 300) };
}

function normCmd(ti) {
  return normalize(ti && (ti.command || ti.file_path || ''));
}

function offsetCacheFile(sessionId) {
  return path.join(os.tmpdir(), 'goalpost', `${String(sessionId).replace(/[^\w-]/g, '_')}.offset`);
}

// ---------- handlers ----------

function onUserPromptSubmit(root, input, cfg) {
  const prompt = String(input.prompt || '');
  const m = prompt.match(GOAL_RE);
  if (m) {
    const args = (m[1] || '').trim();
    if (!args) return null; // `/goal` alone only shows status
    if (CLEAR_WORDS.has(args.toLowerCase())) {
      const st = loadState(root);
      if (isLive(st, input)) release(root, st, 'the user cleared the goal (/goal clear)');
      return null;
    }
    const { st, resumed } = activate(root, input, cfg, args);
    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: texts.protocol({ condition: args, protectedFiles: st.protectedFiles, cfg, resumed }),
      },
    };
  }
  // A normal prompt in the middle of a goal: follow /goal clear, otherwise remind where things stand.
  if (!fs.existsSync(goalPaths(root).state)) return null;
  const st = loadState(root);
  if (!isLive(st, input)) return null;
  syncTranscript(st, input);
  if (st.evaluator && st.evaluator.verdict === 'cleared') {
    release(root, st, 'the user cleared the goal (/goal clear)');
    return null;
  }
  saveState(root, st);
  const status = computeStatus(root, st, cfg);
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `goalpost: the /goal "${clip(st.condition, 160)}" is still active — ${statusLine(status)}. Its plan is in .goal/SPEC.md and .goal/PROGRESS.md.`,
    },
  };
}

function onPreToolUse(root, input, cfg) {
  if (!fs.existsSync(goalPaths(root).state)) return null;
  const st = loadState(root);
  if (!isLive(st, input)) return null;
  const reason = checkTool(root, input, st, cfg);
  if (!reason) return null;
  appendEvidence(root, { kind: 'deny', tool: input.tool_name, target: clip(targetPath(input.tool_input) || (input.tool_input && input.tool_input.command) || '', 200), agent: input.agent_type || undefined });
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `goalpost: ${reason}`,
    },
  };
}

function onPostTool(root, input, cfg, failed) {
  if (!fs.existsSync(goalPaths(root).state)) return null;
  const st = loadState(root);
  if (!isLive(st, input)) return null;
  const tool = input.tool_name;
  const ti = input.tool_input || {};
  const fromAuditor = isAuditor(input.agent_type, cfg);
  const ctx = [];
  st.toolCalls = (st.toolCalls || 0) + 1;

  const markEdit = () => {
    if (fromAuditor) return;
    st.edits += 1;
    st.editsSinceProgress += 1;
    st.lastEditAt = Date.now();
    maybeFreeze(root, st, cfg);
  };

  if (EDIT_TOOLS.has(tool) && !failed) {
    const rel = relToRoot(root, targetPath(ti));
    if (rel && samePath(rel, '.goal/PROGRESS.md')) {
      st.editsSinceProgress = 0;
      st.progressUpdatedAt = Date.now();
    }
    else if (rel && !rel.startsWith('.goal/')) markEdit();
  }
  if (SHELL_TOOLS.has(tool)) {
    const cmd = String(ti.command || '');
    appendEvidence(root, {
      kind: 'cmd',
      tool,
      cmd: clip(cmd, 600),
      exit: failed ? parseExit(input.error) : 0,
      ms: input.duration_ms,
      agent: input.agent_type || undefined,
    });
    if (shellModifies(cmd)) markEdit();
    if (/>{1,2}\s*["']?(\.\/)?\.goal[\\/]PROGRESS\.md/i.test(cmd)) {
      st.editsSinceProgress = 0;
      st.progressUpdatedAt = Date.now();
    }
  }

  // Same error again and again -> ask for a different approach.
  const streak = st.failureStreak || { sig: null, count: 0 };
  if (failed && !input.is_interrupt) {
    const { sig, sample } = errorSignature(tool, input.error);
    if (streak.sig === sig) {
      streak.count += 1;
    } else {
      streak.sig = sig;
      streak.count = 1;
      streak.sample = sample;
      streak.cmd = normCmd(ti);
    }
    const n = cfg.sameErrorThreshold;
    if (n > 0 && streak.count >= n && (streak.count - n) % n === 0) {
      ctx.push(texts.repeatedError(streak, cfg));
      appendEvidence(root, { kind: 'loop', sig, count: streak.count });
    }
  } else if (!failed && streak.cmd && normCmd(ti) === streak.cmd) {
    streak.sig = null;
    streak.count = 0;
    streak.cmd = null;
  }
  st.failureStreak = streak;

  // Anti-drift checkpoints (main conversation only).
  if (!input.agent_id) {
    if (cfg.reminderEveryToolCalls > 0 && st.toolCalls - (st.lastReminderAt || 0) >= cfg.reminderEveryToolCalls) {
      st.lastReminderAt = st.toolCalls;
      ctx.push(texts.reminder(computeStatus(root, st, cfg)));
    } else if (cfg.progressEveryEdits > 0 && st.editsSinceProgress === cfg.progressEveryEdits) {
      ctx.push(`goalpost: ${st.editsSinceProgress} file edits since .goal/PROGRESS.md was last updated. A one-line update (done / next / blockers) keeps the plan recoverable after compaction.`);
    }
  }
  saveState(root, st);
  if (!ctx.length) return null;
  return { hookSpecificOutput: { hookEventName: failed ? 'PostToolUseFailure' : 'PostToolUse', additionalContext: ctx.join('\n\n') } };
}

// Fallback for surfaces where UserPromptSubmit might not see `/goal`: notice the goal in the transcript.
function lateActivation(root, input, cfg) {
  if (!input.transcript_path || !input.session_id) return null;
  const cache = offsetCacheFile(input.session_id);
  let offset = 0;
  try { offset = Number(fs.readFileSync(cache, 'utf8')) || 0; } catch (e) { /* first time */ }
  const r = scanGoalStatus(input.transcript_path, offset);
  try {
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, String(r.offset));
  } catch (e) { /* cache is optional */ }
  let live = null;
  for (const rec of r.records) {
    if (rec.kind === 'set' && rec.condition) live = rec.condition;
    else if (rec.kind !== 'not_met') live = null;
  }
  if (!live) return null;
  const old = loadState(root);
  if (old && old.sessionId === input.session_id && normalize(old.condition) === normalize(live)) return null; // ours, already handled
  const { st } = activate(root, input, cfg, live);
  st.stopBlocks = 1;
  st.lastBlockToolCalls = st.toolCalls;
  saveState(root, st);
  return { decision: 'block', reason: texts.protocol({ condition: live, protectedFiles: st.protectedFiles, cfg, resumed: false }) + '\n\nStart with .goal/SPEC.md.' };
}

function onStop(root, input, cfg) {
  if (!fs.existsSync(goalPaths(root).state)) return lateActivation(root, input, cfg);
  const st = loadState(root);
  if (!isLive(st, input)) return lateActivation(root, input, cfg);
  const p = goalPaths(root);
  syncTranscript(st, input);
  const ev = st.evaluator && st.evaluator.verdict;
  if (ev === 'cleared') {
    appendEvidence(root, { kind: 'release', why: 'cleared' });
    release(root, st, 'the user cleared the goal (/goal clear)');
    return null;
  }
  if (ev === 'failed') {
    appendEvidence(root, { kind: 'release', why: 'impossible' });
    release(root, st, `the /goal evaluator judged the goal impossible: ${clip(st.evaluator.reason, 300)}`);
    return { systemMessage: `goalpost: released — the /goal evaluator judged the goal impossible (${clip(st.evaluator.reason, 200)}).` };
  }
  const bg = Array.isArray(input.background_tasks) ? input.background_tasks.length : 0;
  const blocked = (readText(p.blocked, '') || '').trim();
  if (blocked && mtimeMs(p.blocked) > (st.startedMs || 0)) {
    // BLOCKED.md is the one early exit. It is for things only the user can fix. A broken check, a failing
    // audit or a spec problem is the agent's to fix, so the first time it gets one challenge before we let go.
    const confirmed = st.blockedChallenge && mtimeMs(p.blocked) > st.blockedChallenge.atMs;
    const userMarked = /^\s*USER:/m.test(blocked);
    if (!st.blockedChallenge && !userMarked) {
      st.blockedChallenge = { atMs: Date.now() };
      st.stopBlocks += 1;
      st.lastBlockToolCalls = st.toolCalls || 0;
      saveState(root, st);
      appendEvidence(root, { kind: 'block', n: st.stopBlocks, why: 'blocked-challenge' });
      return { decision: 'block', reason: texts.blockedChallenge(cfg) };
    }
    if (st.blockedChallenge && !confirmed && !userMarked && (st.toolCalls || 0) > (st.lastBlockToolCalls == null ? -1 : st.lastBlockToolCalls)) {
      // The agent went back to work after the challenge without re-affirming the blocker: keep enforcing.
      st.blockedChallenge = null;
      try { fs.renameSync(p.blocked, p.blocked + '.dismissed'); } catch (e) { /* ignore */ }
    } else {
      appendEvidence(root, { kind: 'release', why: 'blocked' });
      release(root, st, 'Claude reported a blocker in .goal/BLOCKED.md', { phase: 'blocked' });
      return { systemMessage: `goalpost: stopped on a blocker that needs you (from .goal/BLOCKED.md):\n${clip(blocked, 900)}` };
    }
  }

  const status = computeStatus(root, st, cfg);
  if (status.complete) {
    appendEvidence(root, { kind: 'done', criteria: status.total, audit: st.audit && st.audit.verdict });
    release(root, st, 'all criteria verified' + (status.needsAudit ? ' and audited' : ''), { phase: 'done' });
    return { systemMessage: `goalpost: done — ${statusLine(status)}${status.needsAudit ? ', audit PASS' : ''}.` };
  }

  // Loop safety: give up gracefully instead of being overridden by Claude Code's own cap.
  const progressed = (st.toolCalls || 0) > (st.lastBlockToolCalls == null ? -1 : st.lastBlockToolCalls);
  st.noProgressBlocks = st.stopBlocks > 0 && !progressed ? (st.noProgressBlocks || 0) + 1 : 0;
  const open = status.problems.slice(0, 5).map((pr) => `- ${clip(pr.msg, 220)}`).join('\n');
  const giveUp = (why) => {
    appendEvidence(root, { kind: 'release', why });
    try {
      fs.appendFileSync(p.progress, `\n- goalpost released the goal (${nowIso()}): ${why}. Open items:\n${open}\n`);
    } catch (e) { /* ignore */ }
    release(root, st, why);
    return { systemMessage: `goalpost: released the goal — ${why}. ${statusLine(status)}. Open items:\n${open}` };
  };
  if (cfg.maxNoProgressBlocks > 0 && st.noProgressBlocks >= cfg.maxNoProgressBlocks) {
    return giveUp(`no progress after ${st.noProgressBlocks} reminders in a row (no tool use in between)`);
  }
  if (cfg.maxBlocks > 0 && st.stopBlocks >= cfg.maxBlocks) return giveUp(`block budget of ${cfg.maxBlocks} used up`);
  if (cfg.maxMinutes > 0 && Date.now() - (st.startedMs || 0) > cfg.maxMinutes * 60000) return giveUp(`time budget of ${cfg.maxMinutes} min used up`);

  st.stopBlocks += 1;
  st.lastBlockToolCalls = st.toolCalls || 0;
  // The built-in evaluator already accepted the goal: say so once, to the user and to Claude.
  let notice = null;
  let reason = texts.blockReason(status, st, cfg);
  if (bg) reason += `\nNote: ${bg} background task(s) are still running. Wait for them and read their output (a headless session does not wake up by itself), then run \`node .goal/verify.js\`.`;
  if (ev === 'met') {
    reason = `The built-in /goal evaluator accepted the goal from the conversation, but the files say otherwise.\n${reason}`;
    if (!st.metNoticeShown) {
      st.metNoticeShown = true;
      notice = `goalpost: the /goal evaluator said "met", but ${status.problems.length} item(s) are still open (${statusLine(status)}). Keeping the session going.`;
    }
  }
  saveState(root, st);
  appendEvidence(root, {
    kind: 'block',
    n: st.stopBlocks,
    evaluator: ev || null,
    open: status.problems.map((pr) => pr.kind + (pr.id ? `:${pr.id}` : '')).slice(0, 20),
  });
  const out = { decision: 'block', reason };
  if (notice) out.systemMessage = notice;
  return out;
}

function onSubagentStop(root, input, cfg) {
  if (!isAuditor(input.agent_type, cfg)) return null;
  if (!fs.existsSync(goalPaths(root).state)) return null;
  const st = loadState(root);
  if (!isLive(st, input)) return null;
  const msg = String(input.last_assistant_message || '');
  const m = msg.match(/VERDICT\s*[:=]\s*\**\s*(PASS|FAIL)/i);
  const verdict = m ? m[1].toUpperCase() : 'UNKNOWN';
  const findings = msg
    .split(/\r?\n/)
    .filter((l) => /\b(FAIL|MISSING|NOT MET|GAMING|CHEAT|STUB|TODO)\b|✗/i.test(l))
    .join('\n');
  st.audits = (st.audits || 0) + 1;
  st.audit = { at: nowIso(), atMs: Date.now(), verdict, findings: clip(findings || msg, 2500), summary: clip(msg, 4000) };
  const p = goalPaths(root);
  try {
    writeFileAtomic(p.audit, `# goalpost audit #${st.audits}\n\nWhen: ${st.audit.at}\nVerdict: ${verdict}\nAuditor: ${input.agent_type}\n\n${msg}\n`);
  } catch (e) { /* ignore */ }
  appendEvidence(root, { kind: 'audit', verdict, n: st.audits });
  saveState(root, st);
  return null;
}

function onSessionStart(root, input, cfg) {
  if (!fs.existsSync(goalPaths(root).state)) return null;
  const st = loadState(root);
  if (!st || !st.active) return null;
  const src = input.source;
  const ours = !st.sessionId || !input.session_id || st.sessionId === input.session_id;
  if ((src === 'compact' || src === 'resume') && ours) {
    writeVerifyShim(root);
    const status = computeStatus(root, st, cfg);
    return {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: texts.recap(root, st, status, cfg, src === 'compact' ? 'the context was just compacted' : 'the session was resumed'),
      },
    };
  }
  if (src === 'startup' && !ours) {
    return { systemMessage: `goalpost: .goal/ holds an unfinished goal from an earlier session: "${clip(st.condition, 140)}". Resume that session (claude --continue) to keep enforcing it, or start a new /goal.` };
  }
  return null;
}

const HANDLERS = {
  UserPromptSubmit: onUserPromptSubmit,
  PreToolUse: onPreToolUse,
  PostToolUse: (root, input, cfg) => onPostTool(root, input, cfg, false),
  PostToolUseFailure: (root, input, cfg) => onPostTool(root, input, cfg, true),
  Stop: onStop,
  SubagentStop: onSubagentStop,
  SessionStart: onSessionStart,
};

function run(event, input) {
  const root = projectRoot(input);
  const cfg = loadConfig(root);
  if (!cfg.enabled) return null;
  const handler = HANDLERS[event];
  return handler ? handler(root, input, cfg) : null;
}

if (require.main === module) {
  const input = parseJSON(readStdin(), {}) || {};
  const event = process.argv[2] || input.hook_event_name;
  let out = null;
  try {
    out = run(event, input);
  } catch (e) {
    process.stderr.write(`goalpost ${event} hook error (ignored): ${e && e.stack ? e.stack : e}\n`);
    out = null;
  }
  if (out) process.stdout.write(JSON.stringify(out));
  process.exitCode = 0;
}

module.exports = { run, errorSignature, verifyShim, GOAL_RE, CLEAR_WORDS };
