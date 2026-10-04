'use strict';
// Parser for .goal/SPEC.md. The format is plain Markdown so people and models can both write it:
//
//   ## Acceptance criteria
//   - [ ] AC-1: GET /health returns 200
//     - Verify: `npm test -- health`
//   - [ ] AC-2: README explains setup
//     - Verify: manual — open README.md and follow the steps
//
//   ## Protected            (read-only while the goal runs)
//   - test/fixtures/**
//
//   ## Test changes         (existing tests the goal is allowed to edit; fixed at freeze time)
//   - test/legacy.test.js: the API it covers is being removed on purpose
//
//   ## Spec changes         (why a frozen criterion was reworded or dropped)
//   - AC-3: the client confirmed CSV is enough, JSON export dropped

const CRIT_RE = /^(\s*[-*]\s*\[)( |x|X)(\]\s*)\**(AC-\d+)\**\s*[:.)\-–—]?\s*(.*)$/;
const VERIFY_RE = /^\s*(?:[-*]\s*)?\**verify\**\s*:\s*(.*)$/i;
const INLINE_VERIFY_RE = /^(.*?)\s*(?:[-–—|]\s*)?\**verify\**\s*:\s*(.+)$/i;

// HTML comments (template hints) are invisible to the parser; line numbers are kept.
function maskComments(text) {
  return String(text || '').replace(/<!--[\s\S]*?(-->|$)/g, (m) => m.replace(/[^\r\n]/g, ' '));
}

function normalize(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function parseVerify(raw) {
  const text = String(raw || '').trim();
  if (!text) return { verify: null, manual: false };
  if (/^manual\b/i.test(text) || /^`?manual\b/i.test(text)) return { verify: text.replace(/`/g, ''), manual: true };
  const whole = text.match(/^`+([^`]+)`+\s*\.?$/);
  if (whole) return { verify: whole[1].trim(), manual: false };
  const first = text.match(/`([^`]+)`/);
  if (first) return { verify: first[1].trim(), manual: false };
  return { verify: text, manual: false };
}

function listItem(line) {
  const m = line.match(/^\s*[-*]\s+(.+?)\s*$/);
  if (!m) return null;
  let item = m[1];
  // Drop trailing explanations: "path: why", "path — why", "path # why".
  item = item.split(/\s+[#—–]\s+|\s+-\s+|:\s+/)[0];
  item = item.replace(/^`+|`+$/g, '').trim();
  return item || null;
}

function parseSpec(text) {
  const lines = maskComments(text).split(/\r?\n/);
  const criteria = [];
  const sections = {};
  let section = null;
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (h) {
      section = h[1].toLowerCase().replace(/[`*_]/g, '').trim();
      sections[section] = sections[section] || [];
      cur = null;
      continue;
    }
    if (section !== null) sections[section].push(line);
    const m = line.match(CRIT_RE);
    if (m) {
      let body = m[5];
      let verifyRaw = null;
      const inline = body.match(INLINE_VERIFY_RE);
      if (inline) {
        body = inline[1];
        verifyRaw = inline[2];
      }
      cur = {
        id: m[4].toUpperCase(),
        checked: m[2].toLowerCase() === 'x',
        text: normalize(body.replace(/\*\*/g, '')),
        verify: null,
        manual: false,
        line: i,
        verifyLine: null,
      };
      if (verifyRaw !== null) {
        Object.assign(cur, parseVerify(verifyRaw));
        cur.verifyLine = i;
      }
      criteria.push(cur);
      continue;
    }
    if (cur && cur.verify === null) {
      const v = line.match(VERIFY_RE);
      if (v) {
        Object.assign(cur, parseVerify(v[1]));
        cur.verifyLine = i;
        continue;
      }
    }
    // A non-indented line that is not part of the criterion ends it.
    if (cur && /^\S/.test(line) && !/^\s*$/.test(line)) cur = null;
  }

  const pick = (...names) => {
    for (const n of names) {
      const key = Object.keys(sections).find((k) => k === n || k.startsWith(n));
      if (key) return sections[key];
    }
    return [];
  };
  const items = (arr) => arr.map(listItem).filter(Boolean);

  const ids = criteria.map((c) => c.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  const goalLines = pick('goal');
  return {
    criteria,
    duplicates: [...new Set(duplicates)],
    protected: items(pick('protected')),
    testChanges: items(pick('test changes', 'allowed test changes')),
    specChanges: pick('spec changes', 'spec change log').join('\n'),
    goal: normalize(goalLines.join(' ')),
    sections,
  };
}

// A frozen snapshot is what the criteria looked like when implementation started.
function snapshot(spec) {
  return spec.criteria.map((c) => ({ id: c.id, text: c.text, verify: c.verify || null }));
}

// Frozen criteria that were removed or reworded without a "## Spec changes" entry naming them.
function tampered(frozen, spec) {
  const out = [];
  const changes = spec.specChanges || '';
  const explained = (id) => new RegExp(`\\b${id}\\b`, 'i').test(changes);
  for (const f of frozen || []) {
    const now = spec.criteria.find((c) => c.id === f.id);
    if (!now) {
      if (!explained(f.id)) out.push({ id: f.id, kind: 'removed', frozen: f });
      continue;
    }
    const textChanged = normalize(now.text) !== normalize(f.text);
    const verifyChanged = normalize(now.verify) !== normalize(f.verify);
    if ((textChanged || verifyChanged) && !explained(f.id)) {
      out.push({ id: f.id, kind: textChanged ? 'reworded' : 'verify-changed', frozen: f, now: { text: now.text, verify: now.verify } });
    }
  }
  return out;
}

// Rewrite the checkbox of each criterion id in `marks` ({ 'AC-1': true, ... }); everything else untouched.
function setChecks(text, marks) {
  const lines = String(text).split(/(\r?\n)/);
  const masked = maskComments(text).split(/(\r?\n)/);
  for (let i = 0; i < lines.length; i += 2) {
    const m = masked[i] && masked[i].match(CRIT_RE);
    if (!m) continue;
    const id = m[4].toUpperCase();
    if (!(id in marks)) continue;
    const box = marks[id] ? 'x' : ' ';
    lines[i] = m[1] + box + lines[i].slice(m[1].length + 1);
  }
  return lines.join('');
}

module.exports = { parseSpec, snapshot, tampered, setChecks, normalize, parseVerify, maskComments };
