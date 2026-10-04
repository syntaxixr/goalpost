'use strict';
// Anti-cheating rules for PreToolUse: which writes are not allowed while a goal is active.
const path = require('path');
const { relToRoot, matchAny, samePath, toPosix, readText, globToRegExp } = require('./util');
const { MANAGED, goalPaths } = require('./state');
const { parseSpec, tampered } = require('./spec');

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

function targetPath(toolInput) {
  return (toolInput && (toolInput.file_path || toolInput.notebook_path || toolInput.path)) || null;
}

// Existing test files found at goal start, minus the ones listed under SPEC "## Test changes".
// Declared changes stay allowed at any time: they are visible in SPEC.md and reviewed by the auditor.
function protectedList(state, spec, cfg) {
  const allowed = (spec && spec.testChanges) || [];
  const fromStart = cfg.protectExistingTests ? (state.protectedFiles || []) : [];
  const files = fromStart.filter((f) => !matchAny(f, allowed));
  const globs = [...(cfg.protectedPaths || []), ...((spec && spec.protected) || [])];
  return { files, globs };
}

function isProtected(rel, state, spec, cfg) {
  if (!rel || rel.startsWith('../')) return false;
  const { files, globs } = protectedList(state, spec, cfg);
  if (files.some((f) => samePath(f, rel))) return true;
  return matchAny(rel, globs);
}

function isManaged(rel) {
  return MANAGED.some((m) => samePath(m, rel));
}

// Content of the file after an Edit/MultiEdit/Write, so SPEC.md changes can be checked before they land.
function contentAfter(tool, input, current) {
  if (tool === 'Write') return input.content || '';
  if (tool === 'Edit') {
    const { old_string: oldS = '', new_string: newS = '', replace_all: all } = input;
    if (!oldS) return current;
    return all ? current.split(oldS).join(newS) : current.replace(oldS, () => newS);
  }
  if (tool === 'MultiEdit') {
    let text = current;
    for (const e of input.edits || []) {
      const oldS = e.old_string || '';
      if (!oldS) continue;
      text = e.replace_all ? text.split(oldS).join(e.new_string || '') : text.replace(oldS, () => e.new_string || '');
    }
    return text;
  }
  return current;
}

const VERIFY_RUN = /node\s+["']?(?:\.\/)?\.goal[\\/]verify\.js["']?/gi;

// Targets of `>`/`>>` redirects, ignoring fd duplication (2>&1) and null devices.
function redirectTargets(command) {
  const out = [];
  const re = /(^|[^<>&0-9])\d?>{1,2}(?!&)\s*(["']?)([^\s;&|"'<>()]+)\2/g;
  let m;
  while ((m = re.exec(command)) !== null) {
    const t = m[3];
    if (/^(\/dev\/null|nul|\$null|\/dev\/stderr|\/dev\/stdout)$/i.test(t)) continue;
    out.push(toPosix(t).replace(/^\.\//, ''));
  }
  return out;
}

// Heredoc bodies (bash `<<EOF` and PowerShell `@'…'@` / `@"…"@`) are data, not commands: keep only the
// opening line. Quoted strings that contain < or > are text too (e.g. "<pattern>"), not redirects.
function stripHeredocs(cmd) {
  return String(cmd || '')
    .replace(/<<-?\s*(['"]?)([\w-]+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\r?\n|$)/g, (m) => m.split('\n')[0])
    .replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, '@HERESTRING@')
    .replace(/"[^"\n]*[<>][^"\n]*"|'[^'\n]*[<>][^'\n]*'/g, '""');
}

const FILE_OPS = /^(rm|rmdir|unlink|mv|cp|tee|truncate|touch|patch|del|erase|remove-item|move-item|copy-item|rename-item|set-content|add-content|out-file|clear-content|new-item|ri|mi|cpi|sc|ac)$/i;

// Paths a shell command is about to write, delete or move. Best effort, by design conservative about
// what counts as a target: redirects, arguments of file commands, and paths inside writeFileSync-style calls.
function writeTargets(command) {
  const clean = stripHeredocs(String(command || '').replace(VERIFY_RUN, 'true'));
  const targets = redirectTargets(clean);
  const unq = (s) => toPosix(s.replace(/^['"`]+|['"`;,)]+$/g, '')).replace(/^\.\//, '');
  for (const seg of clean.split(/&&|\|\||;|\||\r?\n/)) {
    const toks = seg.trim().match(/"[^"]*"|'[^']*'|\S+/g) || [];
    while (toks.length && /^[A-Za-z_]\w*=/.test(toks[0])) toks.shift(); // FOO=bar cmd
    if (toks[0] === 'sudo') toks.shift();
    if (!toks.length) continue;
    const cmd = toks[0].toLowerCase();
    // Values are not paths: PowerShell variables/here-strings, and the argument after -Value/-InputObject.
    const raw = toks.slice(1);
    let args = raw.filter((t, i) => !/^-/.test(t) && !/^\d?>/.test(t) && !/^[$@]/.test(t)
      && !(i > 0 && /^-(value|inputobject|encoding|itemtype|type)$/i.test(raw[i - 1])));
    if (cmd === 'sed' || cmd === 'perl') {
      if (!toks.slice(1).some((t) => /^-[a-z]*i/i.test(t) || t === '--in-place')) continue;
      args = args.slice(1); // first non-flag arg is the script
    } else if (cmd === 'git') {
      if (!/^(checkout|restore|rm|mv|apply|reset|clean|stash)$/.test(args[0] || '')) continue;
      args = args.slice(1);
    } else if (!FILE_OPS.test(cmd)) {
      continue;
    } else if (cmd === 'cp' || cmd === 'copy-item' || cmd === 'cpi') {
      args = args.slice(-1);
    } else if (/^(set-content|add-content|out-file|clear-content|new-item|sc|ac)$/.test(cmd)) {
      // PowerShell: the path is -Path/-LiteralPath/-FilePath or the first positional; the rest is the value.
      const named = raw.findIndex((t) => /^-(path|literalpath|filepath)$/i.test(t));
      args = named >= 0 ? [raw[named + 1]].filter(Boolean) : args.slice(0, 1);
    }
    for (const a of args) targets.push(unq(a));
  }
  const callRe = /(?:writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream|renameSync|rename|unlinkSync|unlink|rmSync|copyFileSync|truncateSync)\(\s*['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = callRe.exec(clean)) !== null) targets.push(unq(m[1]));
  const pyRe = /open\(\s*['"]([^'"]+)['"]\s*,\s*['"][wax]/g;
  while ((m = pyRe.exec(clean)) !== null) targets.push(unq(m[1]));
  return targets.filter(Boolean);
}

function targetHits(t, rel) {
  const tl = t.toLowerCase();
  const rl = rel.toLowerCase();
  if (samePath(t, rel) || tl.endsWith('/' + rl)) return true;
  if (/[*?]/.test(t)) {
    const rx = globToRegExp(t);
    if (rx.test(rel) || rx.test(path.posix.basename(rel))) return true;
  }
  const base = path.posix.basename(rl);
  return base.length >= 6 && /[._-]/.test(base) && path.posix.basename(tl) === base;
}

// Heuristic: does this shell command change files on disk (other than .goal/ bookkeeping)?
function shellModifies(command) {
  return writeTargets(command).some((t) => !/(^|\/)\.goal\//i.test(t) && !/^(\/dev\/|nul$)/i.test(t));
}

// Heuristic: does this shell command write to `rel`?
function shellWritesTo(command, rel) {
  return writeTargets(command).some((t) => targetHits(t, rel));
}


// Returns a deny reason, or null to allow.
function checkTool(root, input, state, cfg) {
  const tool = input.tool_name;
  const ti = input.tool_input || {};
  const p = goalPaths(root);
  const specText = readText(p.spec, '') || '';
  const spec = parseSpec(specText);

  if (EDIT_TOOLS.has(tool)) {
    const rel = relToRoot(root, targetPath(ti));
    if (!rel) return null;
    if (isManaged(rel)) {
      return `${rel} is maintained by goalpost and can't be edited directly. Checks are recorded by running \`node .goal/verify.js\`; the audit is recorded when the ${cfg.auditAgent} subagent finishes.`;
    }
    if (samePath(rel, '.goal/SPEC.md') && state.frozenCriteria && cfg.freezeSpec) {
      const after = contentAfter(tool, ti, specText);
      const bad = tampered(state.frozenCriteria, parseSpec(after));
      if (bad.length) {
        const ids = bad.map((b) => `${b.id} (${b.kind})`).join(', ');
        return `The acceptance criteria froze when implementation started, and this edit would change ${ids}. New criteria can be added freely. To change or drop a frozen one, first add a line under "## Spec changes" that names it and says why; the auditor reviews those.`;
      }
      return null;
    }
    if (rel.startsWith('.goal/') || rel.startsWith('../')) return null;
    if (isProtected(rel, state, spec, cfg)) {
      return `${rel} is read-only while this goal runs (an existing test or a path under "## Protected" in .goal/SPEC.md). Make the code satisfy it instead. If the goal genuinely requires changing this test (for example an API migration), list it under "## Test changes" in .goal/SPEC.md with the reason; the auditor reviews every declared test change.`;
    }
    if (cfg.specFirst && !spec.criteria.length) {
      return `Spec first: .goal/SPEC.md has no acceptance criteria yet, so project files stay untouched for now. Fill in the goal, assumptions and criteria (each with a \`- Verify: \`<command>\`\` line), then continue with ${rel}.`;
    }
    return null;
  }

  if (SHELL_TOOLS.has(tool)) {
    const command = String(ti.command || '');
    for (const m of MANAGED) {
      if (shellWritesTo(command, m)) {
        return `${m} is maintained by goalpost; shell commands can't write to it. Run \`node .goal/verify.js\` to record checks.`;
      }
    }
    const { files } = protectedList(state, spec, cfg);
    for (const f of files) {
      if (shellWritesTo(command, f)) {
        return `This command looks like it changes ${f}, which is read-only while this goal runs (an existing test). Make the code satisfy the test instead, or list it under "## Test changes" in .goal/SPEC.md with the reason (the auditor reviews those).`;
      }
    }
    return null;
  }
  return null;
}

module.exports = {
  checkTool, isProtected, protectedList, contentAfter, targetPath,
  EDIT_TOOLS, SHELL_TOOLS, shellModifies, shellWritesTo, writeTargets, redirectTargets, stripHeredocs,
};
