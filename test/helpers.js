'use strict';
// Test helpers: a throwaway project dir and a way to fire hook events exactly like Claude Code does
// (spawn `node hook.js <Event>` with the JSON on stdin).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'plugin', 'scripts', 'hook.js');
const VERIFY = path.join(__dirname, '..', 'plugin', 'scripts', 'verify.js');

function tmpProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goalpost-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  const userCfg = path.join(dir, '.test-user-goalpost.json');
  return {
    dir,
    userCfg,
    file: (rel) => path.join(dir, rel),
    read: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8'),
    write: (rel, content) => {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    },
    exists: (rel) => fs.existsSync(path.join(dir, rel)),
    state: () => JSON.parse(fs.readFileSync(path.join(dir, '.goal', 'state.json'), 'utf8')),
    setState: (patch) => {
      const f = path.join(dir, '.goal', 'state.json');
      const st = JSON.parse(fs.readFileSync(f, 'utf8'));
      fs.writeFileSync(f, JSON.stringify(Object.assign(st, patch), null, 2));
    },
    evidence: () => fs.readFileSync(path.join(dir, '.goal', 'evidence.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function runHook(proj, event, input, env = {}) {
  const payload = Object.assign({
    session_id: 'sess-1',
    transcript_path: path.join(proj.dir, '.test-transcript.jsonl'),
    cwd: proj.dir,
    hook_event_name: event,
  }, input);
  const t0 = process.hrtime.bigint();
  const res = spawnSync(process.execPath, [HOOK, event], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: proj.dir, GOALPOST_USER_CONFIG: proj.userCfg, GOALPOST: '' }, env),
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  let json = null;
  if (res.stdout && res.stdout.trim()) json = JSON.parse(res.stdout);
  return { json, stdout: res.stdout, stderr: res.stderr, status: res.status, ms };
}

function runVerify(proj, args = []) {
  const res = spawnSync(process.execPath, [path.join(proj.dir, '.goal', 'verify.js'), ...args], {
    encoding: 'utf8',
    cwd: proj.dir,
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: proj.dir, GOALPOST_USER_CONFIG: proj.userCfg }),
  });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status };
}

// Append a /goal record to the fake transcript, the way Claude Code writes it.
function transcriptGoal(proj, attachment) {
  const line = JSON.stringify({ type: 'attachment', attachment: Object.assign({ type: 'goal_status' }, attachment), timestamp: new Date().toISOString() });
  fs.appendFileSync(path.join(proj.dir, '.test-transcript.jsonl'), line + '\n');
}

const SPEC_OK = `# Goal

Make add() work

## Acceptance criteria

- [ ] AC-1: add(2,3) returns 5
  - Verify: \`node -e "process.exit(require('./src/add.js')(2,3)===5?0:1)"\`
- [ ] AC-2: README mentions add
  - Verify: \`node -e "process.exit(require('fs').readFileSync('README.md','utf8').includes('add')?0:1)"\`
`;

module.exports = { tmpProject, runHook, runVerify, transcriptGoal, SPEC_OK, HOOK, VERIFY };
