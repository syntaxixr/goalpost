'use strict';
// Where goalpost keeps things, and the per-goal state machine.
const fs = require('fs');
const path = require('path');
const { readJSON, writeJSONAtomic, nowIso, toPosix } = require('./util');

const GOAL_DIR = '.goal';

function projectRoot(input) {
  return process.env.CLAUDE_PROJECT_DIR || (input && input.cwd) || process.cwd();
}

function goalPaths(root) {
  const dir = path.join(root, GOAL_DIR);
  return {
    dir,
    spec: path.join(dir, 'SPEC.md'),
    progress: path.join(dir, 'PROGRESS.md'),
    evidence: path.join(dir, 'evidence.log'),
    state: path.join(dir, 'state.json'),
    verify: path.join(dir, 'verify.js'),
    audit: path.join(dir, 'AUDIT.md'),
    blocked: path.join(dir, 'BLOCKED.md'),
    archive: path.join(dir, 'archive'),
  };
}

// Files only goalpost itself may write (relative to the project root).
const MANAGED = ['.goal/state.json', '.goal/evidence.log', '.goal/verify.js', '.goal/AUDIT.md'];

function loadState(root) {
  return readJSON(goalPaths(root).state, null);
}

function saveState(root, st) {
  st.updatedAt = nowIso();
  fs.mkdirSync(goalPaths(root).dir, { recursive: true });
  writeJSONAtomic(goalPaths(root).state, st);
}

function newState({ sessionId, condition, protectedFiles }) {
  const now = Date.now();
  return {
    version: 1,
    active: true,
    phase: 'spec', // spec -> build -> done | released
    sessionId: sessionId || null,
    condition,
    startedAt: new Date(now).toISOString(),
    startedMs: now,
    frozenAt: null,
    frozenCriteria: null,
    frozenTestChanges: [],
    protectedFiles: protectedFiles || [],
    toolCalls: 0,
    edits: 0,
    lastEditAt: 0,
    editsSinceProgress: 0,
    lastReminderAt: 0,
    stopBlocks: 0,
    noProgressBlocks: 0,
    lastBlockToolCalls: -1,
    failureStreak: { sig: null, count: 0, cmd: null },
    audits: 0,
    audit: null,
    transcriptOffset: 0,
    evaluator: null,
    released: null,
  };
}

// Is this state the live goal of this session?
function isLive(st, input) {
  if (!st || !st.active) return false;
  if (!st.sessionId || !input || !input.session_id) return true;
  return st.sessionId === input.session_id;
}

function release(root, st, why, extra = {}) {
  st.active = false;
  st.phase = extra.phase || 'released';
  st.released = { at: nowIso(), why };
  saveState(root, st);
}

// Move an old .goal/ goal into .goal/archive/<stamp>/ so a new /goal starts clean.
function archiveGoal(root) {
  const p = goalPaths(root);
  if (!fs.existsSync(p.dir)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(p.archive, stamp);
  let moved = 0;
  for (const f of ['SPEC.md', 'PROGRESS.md', 'evidence.log', 'state.json', 'AUDIT.md', 'BLOCKED.md']) {
    const src = path.join(p.dir, f);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(dest, { recursive: true });
    fs.renameSync(src, path.join(dest, f));
    moved += 1;
  }
  return moved ? toPosix(path.relative(root, dest)) : null;
}

module.exports = { GOAL_DIR, MANAGED, projectRoot, goalPaths, loadState, saveState, newState, isLive, release, archiveGoal };
