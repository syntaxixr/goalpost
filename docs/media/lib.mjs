// Reads real benchmark runs (stream-json + transcript + .goal/ files + grader result) so every line in
// the video comes from an actual session. `need()` throws when an expected line isn't found, so the
// video can't silently show something that didn't happen.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function need(value, what) {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) {
    throw new Error(`video data: could not find ${what} in the real run`);
  }
  return value;
}

// Ordered events of the main conversation: {kind:'text'|'tool', ...}
export function readStream(file) {
  const events = [];
  const byId = new Map();
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    let r;
    try { r = JSON.parse(l); } catch { continue; }
    if (r.parent_tool_use_id) continue;
    if (r.type === 'assistant') {
      for (const c of r.message.content || []) {
        if (c.type === 'text' && c.text.trim()) events.push({ kind: 'text', text: c.text });
        if (c.type === 'tool_use') {
          const ev = { kind: 'tool', id: c.id, name: c.name, input: c.input || {}, result: null, isError: false };
          byId.set(c.id, ev);
          events.push(ev);
        }
      }
    }
    if (r.type === 'user' && Array.isArray(r.message && r.message.content)) {
      for (const c of r.message.content) {
        if (c.type !== 'tool_result') continue;
        const ev = byId.get(c.tool_use_id);
        if (!ev) continue;
        ev.result = typeof c.content === 'string' ? c.content : (c.content || []).map((x) => x.text || '').join('\n');
        ev.isError = !!c.is_error;
      }
    }
    if (r.type === 'system' && r.subtype === 'hook_response') events.push({ kind: 'hook', name: r.hook_name, stdout: r.stdout || '' });
  }
  return events;
}

export function transcriptFor(sessionId) {
  const root = path.join(os.homedir(), '.claude', 'projects');
  for (const d of fs.readdirSync(root)) {
    const f = path.join(root, d, `${sessionId}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// Messages Claude Code injected into the main conversation (Stop hook feedback etc.)
export function metaMessages(transcript) {
  const out = [];
  for (const l of fs.readFileSync(transcript, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    let r;
    try { r = JSON.parse(l); } catch { continue; }
    if (r.isSidechain) continue;
    if (r.type === 'user' && typeof r.message?.content === 'string') out.push({ ts: r.timestamp, text: r.message.content, meta: !!r.isMeta });
    if (r.type === 'attachment' && r.attachment?.type === 'goal_status') out.push({ ts: r.timestamp, goal: r.attachment });
  }
  return out;
}

export const cmdOf = (ev) => String(ev.input.command || '').replace(/^cd\s+[^;&]+(;|&&)\s*/, '').trim();
export const firstLine = (s) => String(s || '').split(/\r?\n/).find((x) => x.trim()) || '';
export function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
