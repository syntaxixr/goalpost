'use strict';
// One config for everything. Lookup order (later wins):
//   built-in defaults -> ~/.claude/goalpost.json -> <project>/.claude/goalpost.json -> GOALPOST env switch.
const os = require('os');
const path = require('path');
const { readJSON } = require('./util');

const DEFAULTS = Object.freeze({
  // Master switch. Also: env GOALPOST=off, or /goalpost:off.
  enabled: true,
  // Block code edits until SPEC.md has at least one acceptance criterion.
  specFirst: true,
  // Freeze criteria at the first project-file edit; afterwards they can be added, not removed/reworded.
  freezeSpec: true,
  // Require a fresh-eyes audit by the goalpost:auditor subagent before the goal may stop.
  requireAudit: true,
  auditAgent: 'goalpost:auditor',
  // Skip the audit for goals with fewer criteria than this, unless a criterion is manual or tests are
  // declared under "## Test changes" (0 = always audit). Saves a subagent run on small goals.
  auditMinCriteria: 0,
  // Loop safety. A "no-progress" block is one where Claude used no tool since the previous block.
  maxNoProgressBlocks: 3,
  // Total Stop blocks per goal before goalpost gives up and lets Claude stop (0 = unlimited).
  maxBlocks: 80,
  // Wall-clock budget per goal in minutes (0 = unlimited).
  maxMinutes: 0,
  // Suggest a PROGRESS.md update after this many file edits without one (a hint, never a blocker).
  progressEveryEdits: 15,
  // Anti-drift reminder of the remaining criteria every N tool calls (0 = off).
  reminderEveryToolCalls: 25,
  // Same error this many times in a row -> require a change of approach.
  sameErrorThreshold: 3,
  // Existing test files become read-only while a goal is active.
  protectExistingTests: true,
  testGlobs: [
    '**/test/**', '**/tests/**', '**/__tests__/**', '**/spec/**', '**/specs/**',
    '**/*.test.*', '**/*.spec.*', '**/*_test.*', '**/test_*.py', '**/conftest.py',
    '**/*Test.java', '**/*Tests.java', '**/*Test.kt', '**/*Tests.cs', '**/*_spec.rb',
  ],
  // Extra globs that are always read-only while a goal is active (on top of SPEC.md "## Protected").
  protectedPaths: [],
  // Directories skipped when looking for existing tests.
  ignoreDirs: ['node_modules', '.git', '.goal', 'dist', 'build', 'out', 'target', 'vendor', '.venv', 'venv',
    '__pycache__', '.next', '.nuxt', 'coverage', '.cache', '.tox', '.mypy_cache', '.pytest_cache', '.claude'],
  // Upper bound for the existing-test scan (files visited).
  scanLimit: 20000,
  // Timeout for one Verify command run by .goal/verify.js, seconds.
  verifyTimeoutSec: 900,
  // Shell for Verify commands: "auto" (bash where available, else the OS shell), "bash", "sh", "cmd", "powershell".
  verifyShell: 'auto',
});

function userConfigPath() {
  return process.env.GOALPOST_USER_CONFIG || path.join(os.homedir(), '.claude', 'goalpost.json');
}

function projectConfigPath(root) {
  return path.join(root, '.claude', 'goalpost.json');
}

function loadConfig(root) {
  const user = readJSON(userConfigPath(), {}) || {};
  const proj = (root && readJSON(projectConfigPath(root), {})) || {};
  const cfg = Object.assign({}, DEFAULTS, user, proj);
  const env = String(process.env.GOALPOST || '').trim().toLowerCase();
  if (['off', '0', 'false', 'no', 'disabled', 'disable'].includes(env)) cfg.enabled = false;
  if (['on', '1', 'true', 'yes', 'enabled', 'enable'].includes(env)) cfg.enabled = true;
  return cfg;
}

module.exports = { DEFAULTS, loadConfig, userConfigPath, projectConfigPath };
