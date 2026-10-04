'use strict';
// Reads the built-in /goal's own bookkeeping from the session transcript (JSONL).
// /goal writes `attachment.type === "goal_status"` records (see docs/MECHANICS.md):
//   set      {met:false, sentinel:true}
//   cleared  {met:true,  sentinel:true}      (user ran /goal clear)
//   met      {met:true}                      (evaluator: condition holds)
//   failed   {failed:true}                   (evaluator: impossible)
//   not_met  {met:false} without sentinel    (evaluator: keep going)
// The format is internal to Claude Code, so everything here is best effort and fails soft.
const fs = require('fs');

function classify(att) {
  if (!att || att.type !== 'goal_status') return null;
  if (att.failed) return 'failed';
  if (att.sentinel && att.met) return 'cleared';
  if (att.sentinel) return 'set';
  if (att.met) return 'met';
  return 'not_met';
}

// Returns { records: [{kind, condition, reason, ts}], offset } for the bytes after `fromOffset`.
function scanGoalStatus(transcriptPath, fromOffset = 0, maxBytes = 64 * 1024 * 1024) {
  const out = { records: [], offset: fromOffset || 0 };
  if (!transcriptPath) return out;
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    let start = fromOffset || 0;
    if (start > size) start = 0; // file was replaced
    if (size - start > maxBytes) start = size - maxBytes;
    const len = size - start;
    if (len <= 0) return Object.assign(out, { offset: size });
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    // Only consume whole lines; the writer may be mid-line.
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl < 0) return Object.assign(out, { offset: start });
    const text = buf.slice(0, lastNl + 1).toString('utf8');
    out.offset = start + lastNl + 1;
    for (const line of text.split('\n')) {
      if (!line.includes('"goal_status"')) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch (e) {
        continue;
      }
      const att = rec && rec.attachment;
      const kind = classify(att);
      if (!kind) continue;
      out.records.push({ kind, condition: att.condition || null, reason: att.reason || null, ts: rec.timestamp || null });
    }
  } catch (e) {
    /* missing or unreadable transcript: nothing to report */
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* ignore */ }
  }
  return out;
}

module.exports = { scanGoalStatus, classify };
