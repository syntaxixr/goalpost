// Usage: node show.js <expdir>  — prints hook events (probe) and goal-related transcript records.
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const ev = fs.readFileSync(path.join(dir, 'probe-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const tps = [...new Set(ev.map(e => e.input.transcript_path).filter(Boolean))];
console.log('== hook events');
for (const r of ev) {
  const i = { ...r.input };
  for (const k of ['transcript_path', 'session_id', 'cwd', 'scratchpad_dir', 'prompt_id', 'permission_mode', 'effort', 'background_tasks', 'session_crons', 'tool_use_id']) delete i[k];
  if (i.tool_response) i.tool_response = JSON.stringify(i.tool_response).slice(0, 80);
  if (i.last_assistant_message) i.last_assistant_message = i.last_assistant_message.slice(0, 120);
  console.log(r.t.slice(11, 19), r.argEvent, JSON.stringify(i).slice(0, 400));
}
for (const tp of tps) {
  console.log('== transcript', tp);
  try { fs.copyFileSync(tp, path.join(dir, 'transcript-' + path.basename(tp))); } catch (e) {}
  for (const l of fs.readFileSync(tp, 'utf8').trim().split('\n')) {
    const r = JSON.parse(l);
    const a = r.attachment && r.attachment.type;
    if (a && /goal/.test(a)) console.log(r.timestamp.slice(11, 19), 'ATTACH', JSON.stringify(r.attachment).slice(0, 500));
    else if (r.type === 'system' && r.subtype !== 'local_command') console.log(r.timestamp && r.timestamp.slice(11, 19), 'SYSTEM', r.subtype, JSON.stringify(r).slice(0, 600));
    else if (r.type === 'system') console.log(r.timestamp.slice(11, 19), 'LOCALCMD', (r.content || '').slice(0, 300));
    else if (r.type === 'user' && typeof r.message.content === 'string') console.log(r.timestamp.slice(11, 19), 'USER', r.isMeta ? '(meta)' : '', r.message.content.slice(0, 300).replace(/\n/g, ' '));
    else if (r.type === 'user') { for (const c of r.message.content) if (c.type === 'text') console.log(r.timestamp.slice(11, 19), 'USERTXT', r.isMeta ? '(meta)' : '', c.text.slice(0, 300).replace(/\n/g, ' ')); }
    else if (r.type === 'assistant') { for (const c of r.message.content) { if (c.type === 'text') console.log(r.timestamp.slice(11, 19), 'ASSIST', c.text.slice(0, 160).replace(/\n/g, ' ')); else if (c.type === 'tool_use') console.log(r.timestamp.slice(11, 19), 'TOOL', c.name, JSON.stringify(c.input).slice(0, 100)); } }
    else if (!['attachment', 'queue-operation', 'atis-latch', 'last-prompt', 'cost-state'].includes(r.type)) console.log('OTHER', r.type, JSON.stringify(r).slice(0, 200));
  }
}
