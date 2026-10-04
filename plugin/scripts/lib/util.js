'use strict';
// Small helpers shared by every goalpost script. Only Node built-ins: hooks must start fast.
const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    return '';
  }
}

function parseJSON(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function readText(file, fallback = null) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    return fallback;
  }
}

function mtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch (e) {
    return 0;
  }
}

// Write via a temp file + rename so a reader never sees half a file.
function writeFileAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    // Windows refuses to rename over a file another process holds open. Fall back to a plain write.
    fs.writeFileSync(file, text);
    try { fs.unlinkSync(tmp); } catch (_) { /* already gone */ }
  }
}

function writeJSONAtomic(file, obj) {
  writeFileAtomic(file, JSON.stringify(obj, null, 2) + '\n');
}

function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

// Path of `p` relative to `root`, with forward slashes. Starts with "../" when outside the root.
function relToRoot(root, p) {
  if (!p) return null;
  const abs = path.isAbsolute(p) ? p : path.resolve(root, p);
  return toPosix(path.relative(root, abs)) || '.';
}

function escapeRe(s) {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

const globCache = new Map();

// gitignore-flavoured globs: `**`, `*`, `?`, `{a,b}`. A pattern without "/" matches at any depth.
// A pattern ending in "/" matches everything under that directory.
function globToRegExp(glob) {
  if (globCache.has(glob)) return globCache.get(glob);
  const g = toPosix(String(glob).trim()).replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < g.length;) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 3; continue; }
        re += '.*'; i += 2; continue;
      }
      re += '[^/]*'; i += 1; continue;
    }
    if (c === '?') { re += '[^/]'; i += 1; continue; }
    if (c === '{') {
      const end = g.indexOf('}', i);
      if (end > i) {
        re += '(?:' + g.slice(i + 1, end).split(',').map(escapeRe).join('|') + ')';
        i = end + 1;
        continue;
      }
    }
    re += escapeRe(c);
    i += 1;
  }
  const trimmed = g.replace(/\/$/, '');
  if (!trimmed.includes('/')) re = '(?:.*/)?' + re;
  if (g.endsWith('/')) re += '.*';
  const rx = new RegExp('^' + re + '$', IS_WIN ? 'i' : '');
  globCache.set(glob, rx);
  return rx;
}

function matchAny(rel, globs) {
  if (!rel || !globs || !globs.length) return false;
  const r = toPosix(rel);
  return globs.some((g) => g && globToRegExp(g).test(r));
}

function samePath(a, b) {
  if (a == null || b == null) return false;
  const x = toPosix(a);
  const y = toPosix(b);
  return IS_WIN ? x.toLowerCase() === y.toLowerCase() : x === y;
}

function clip(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function lastLines(s, n) {
  const lines = String(s || '').replace(/\s+$/, '').split(/\r?\n/);
  return lines.slice(-n).join('\n');
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  IS_WIN,
  readStdin,
  parseJSON,
  readJSON,
  readText,
  mtimeMs,
  writeFileAtomic,
  writeJSONAtomic,
  toPosix,
  relToRoot,
  globToRegExp,
  matchAny,
  samePath,
  clip,
  lastLines,
  nowIso,
};
