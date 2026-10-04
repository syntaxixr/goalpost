// Logs hook stdin to <cwd>/probe-events.jsonl. Optional control file <cwd>/probe-control.json:
// {"stopBlocks": N, "stopReason": "...", "stopMode": "block"|"context"}
const fs = require('fs');
const path = require('path');
let raw = '';
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw); } catch (e) { input = { parseError: String(e), raw }; }
  const cwd = process.env.PROBE_DIR || input.cwd || process.cwd();
  const ev = process.argv[2] || input.hook_event_name;
  const rec = { t: new Date().toISOString(), argEvent: ev, input };
  try { fs.appendFileSync(path.join(cwd, 'probe-events.jsonl'), JSON.stringify(rec) + '\n'); } catch (e) {}
  if (ev === "UserPromptSubmit") {
    let ctl = {};
    try { ctl = JSON.parse(fs.readFileSync(path.join(cwd, "probe-control.json"), "utf8")); } catch (e) {}
    if (ctl.upsContext) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ctl.upsContext } }));
  }
  if (ev === 'Stop') {
    let ctl = {};
    try { ctl = JSON.parse(fs.readFileSync(path.join(cwd, 'probe-control.json'), 'utf8')); } catch (e) {}
    const cntFile = path.join(cwd, 'probe-stopcount.txt');
    let n = 0; try { n = +fs.readFileSync(cntFile, 'utf8') || 0; } catch (e) {}
    if (ctl.stopBlocks && n < ctl.stopBlocks) {
      fs.writeFileSync(cntFile, String(n + 1));
      const reason = (ctl.stopReason || 'PROBE block #{n}: reply with the single word BANANA{n} and nothing else.').replace(/\{n\}/g, n + 1);
      if (ctl.stopMode === 'context') {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: reason } }));
      } else {
        process.stdout.write(JSON.stringify({ decision: 'block', reason }));
      }
    }
  }
  process.exit(0);
});
