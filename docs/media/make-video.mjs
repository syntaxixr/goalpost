#!/usr/bin/env node
// Renders docs/media/goalpost.mp4 from REAL benchmark runs.
//   before: bare /goal            (default r3/B-textkit-bare-2)
//   after:  /goal + goalpost      (default r3/B-textkit-goalpost-2)
// Same model (Haiku 4.5), same task, same prompt, same hidden grader. Every terminal line, verdict, score and
// cost comes from the stream logs, .goal/ files and grader results of those two runs (see lib.mjs: need()
// fails the build when an expected line can't be found, so the video can't show something that didn't happen).
//
//   node docs/media/make-video.mjs [--before r3/..] [--after r3/..] [--fps 30] [--only 0-60]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { need, readStream, cmdOf, firstLine, clip } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const RUNS = process.env.BENCH_WORK || 'C:/gpbench/runs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const FPS = Number(arg('fps', 30));
const BEFORE = arg('before', 'r3/B-textkit-bare-2');
const AFTER = arg('after', 'r3/B-textkit-goalpost-2');

const loadRun = (id) => {
  const [round, name] = id.split('/');
  const res = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench', 'results', round, `${name}.json`), 'utf8'));
  return { res, stream: readStream(path.join(RUNS, round, `${name}.stream.jsonl`)), dir: path.join(RUNS, round, name) };
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MODEL = (m) => (m === 'haiku' ? 'Haiku 4.5' : 'Sonnet 5.5');
const usd = (v) => `$${v.toFixed(2)}`;
const pctS = (v) => `${(v * 100).toFixed(1).replace(/\.0$/, '')}%`;

const before = loadRun(BEFORE);
const after = loadRun(AFTER);
need(before.res.model === after.res.model || null, 'both runs on the same model');
need(before.res.task === after.res.task || null, 'both runs on the same task');
const taskDir = path.join(ROOT, 'bench', 'tasks', before.res.task);
const prompt = fs.readFileSync(path.join(taskDir, 'prompt.txt'), 'utf8').trim().replace(/^\/goal\s+/, '');

// ---------- line helpers ----------
const P = (at, text, prefix = '<span class="ch">› </span>') => ({ at, text, cps: 60, cls: 'prompt', prefix });
const SAY = (at, text, mark) => ({ at, text, cls: 'say', rich: `<span class="b">●</span> ${esc(text)}`, mark });
const STRONG = (at, text, mark) => ({ at, text, cls: 'say', rich: `<span class="b">●</span> <span class="strong">${esc(text)}</span>`, mark });
const TOOL = (at, name, a) => ({ at, text: `${name}(${a})`, cls: 'tool', rich: `<span class="b">●</span> <span class="n">${esc(name)}</span>(${esc(a)})` });
const OUT = (at, text, cls = 'out', mark) => ({ at, text, cls, rich: `  ⎿  ${esc(text)}`, mark });
const GOAL = (at, text, mark) => ({ at, text, cls: 'goal', rich: `◎ ${esc(text)}`, mark });
const GP = (at, text, mark, cls = 'gp') => ({ at, text, cls, rich: `<span class="tag">GOALPOST</span>${esc(text)}`, mark });
const BLANK = (at) => ({ at, text: ' ', cls: 'out' });

// ================= BEFORE: bare /goal =================
const B = before.stream;
const bTools = B.filter((e) => e.kind === 'tool');
const bOk = (e) => e && !e.isError;
const num = (s, re) => Number((String(s || '').match(re) || [])[1]);
const testRuns = bTools.filter((e) => /npm test/.test(cmdOf(e)) && /ℹ (pass|fail) \d+/.test(e.result || ''));
const firstFail = need(testRuns.find((e) => num(e.result, /ℹ fail (\d+)/) > 0), 'the first failing npm test');
const failNames = need([...firstFail.result.matchAll(/^✖ (.+?) \(/gm)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i), 'failing test names');
const failCount = num(firstFail.result, /ℹ fail (\d+)/);
const failPass = num(firstFail.result, /ℹ pass (\d+)/);
const lastGreen = need([...testRuns].reverse().find((e) => num(e.result, /ℹ fail (\d+)/) === 0), 'the final passing npm test');
const greenPass = num(lastGreen.result, /ℹ pass (\d+)/);
const issuesRead = need(bTools.find((e) => e.name === 'Read' && /ISSUES\.md$/.test(e.input.file_path || '') && bOk(e)), 'the Read of ISSUES.md');
const issueNames = need([...issuesRead.result.matchAll(/## #(\d+) (\w+)/g)].map((m) => m[2]), 'issue titles');
const srcEdits = bTools.filter((e) => ['Edit', 'Write'].includes(e.name) && bOk(e) && /[\\/]src[\\/]/.test(e.input.file_path || ''));
const editFiles = [...new Set(srcEdits.map((e) => e.input.file_path.replace(/\\/g, '/').split('/src/')[1]))];
need(editFiles.length || null, 'edits of src/ files');
const finalText = need(before.res.metrics.lastText, 'the final message');
const claim = need((finalText.match(/^(?:\w+!\s*)?[^.!\n]*(?:passing|complete)[^.!\n]*[.!]/i) || [])[0], 'the "all passing" claim').replace(/\*\*/g, '').trim();
const finalLines = finalText.split(/\r?\n/);
const ticks = need(finalLines.filter((l) => /^\s*\d+\.\s*✅/.test(l)).length || null, 'the ✅ checklist in the final message');
const finalLine = need(finalLines.map((l) => l.replace(/[*`✅]/g, '').trim()).filter(Boolean).pop(), 'the last line of the final message');
const evalMet = need(before.res.metrics.evaluator.find((e) => e.kind === 'met'), 'the evaluator verdict "met"');
const bFails = before.res.grade.results.filter((r) => !r.ok);
const [bPass, bTotal] = before.res.checks.split('/').map(Number);
const failedIssues = [...new Set(bFails.map((r) => (r.req.match(/#(\d+)/) || [])[1]).filter(Boolean))];
const claimedBroken = failedIssues.filter((n) => new RegExp(`#${n}\\b`).test(finalText));
need(claimedBroken.length || null, 'issues the agent ticked ✅ that the hidden grader found broken');

// ================= AFTER: /goal + goalpost =================
const A = after.stream;
const aTools = A.filter((e) => e.kind === 'tool');
const spec = fs.readFileSync(path.join(after.dir, '.goal', 'SPEC.md'), 'utf8');
const crit = [...spec.matchAll(/^\s*[-*]\s*\[[ xX]\]\s*\**(AC-\d+)\**\s*[:.)-]?\s*(.+)$/gm)].map((m) => ({ id: m[1], text: m[2].replace(/[`*]/g, '').trim() }));
need(crit.length || null, 'acceptance criteria in SPEC.md');
const verifyRuns = aTools.filter((e) => /verify\.js/.test(cmdOf(e)) && /^AC-\d+\s+(PASS|FAIL)/m.test(e.result || ''));
need(verifyRuns.length || null, 'runs of verify.js');
const vLines = (ev) => (ev.result || '').split('\n').filter((l) => /^AC-\d+\s+(PASS|FAIL)/.test(l.trim())).map((l) => l.trim().replace(/\s{2,}/g, '  '));
const failVerify = verifyRuns.find((v) => vLines(v).some((l) => /FAIL/.test(l)));
const lastVerify = verifyRuns[verifyRuns.length - 1];
const lastLs = vLines(lastVerify);
const lastPass = lastLs.filter((l) => /PASS/.test(l)).length;
const denies = aTools.filter((e) => e.isError && /goalpost:/.test(e.result || ''));
const auditText = fs.readFileSync(path.join(after.dir, '.goal', 'AUDIT.md'), 'utf8');
const auditLines = auditText.split('\n').map((l) => l.trim()).filter((l) => /^(Coverage|Gaming|VERDICT)\b/.test(l));
const verdict = need(auditLines.find((l) => /^VERDICT/.test(l)), 'the audit verdict');
const evAfter = fs.readFileSync(path.join(after.dir, '.goal', 'evidence.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const done = need(evAfter.find((r) => r.kind === 'done'), 'the goalpost "done" record');
const [aPass, aTotal] = after.res.grade.results.length ? [after.res.grade.checksPassed, after.res.grade.checksTotal] : [0, 0];
need(aPass === aTotal || null, 'the after run to pass every hidden check');
const fixedNow = after.res.grade.results.filter((r) => r.ok && bFails.some((b) => b.title === r.title));
need(fixedNow.length || null, 'checks that went from failing to passing');

// ================= aggregate numbers (every valid run in bench/results) =================
const rows = (model, arm) => {
  const out = [];
  for (const round of fs.readdirSync(path.join(ROOT, 'bench', 'results')).filter((d) => /^r\d/.test(d))) {
    const dir = path.join(ROOT, 'bench', 'results', round);
    for (const f of fs.readdirSync(dir).filter((y) => y.endsWith('.json') && !y.endsWith('.grade.json'))) {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (r.model === model && r.arm === arm) out.push(r);
    }
  }
  return out;
};
const saidMet = (r) => (r.metrics.evaluator || []).some((e) => e.kind === 'met');
const stat = (rs) => ({
  n: rs.length, perfect: rs.filter((r) => r.score === 1).length,
  falseDone: rs.filter((r) => saidMet(r) && r.score < 1).length,
  cost: rs.reduce((s, r) => s + (r.metrics.costUsd || 0), 0) / (rs.length || 1),
  // mean of per-task means, so an arm with fewer runs on one task isn't compared against a different task mix
  mean: (() => { const by = {}; for (const r of rs) (by[r.task] = by[r.task] || []).push(r.score || 0); const m = Object.values(by).map((a) => a.reduce((x, y) => x + y, 0) / a.length); return m.reduce((x, y) => x + y, 0) / (m.length || 1); })(),
});
const SB = stat(rows('sonnet', 'bare')), SG = stat(rows('sonnet', 'goalpost')), HB = stat(rows('haiku', 'bare')), HG = stat(rows('haiku', 'goalpost'));
const allBare = [...rows('sonnet', 'bare'), ...rows('haiku', 'bare')];
const metCount = allBare.filter(saidMet).length;
const brokenCount = allBare.filter((r) => saidMet(r) && r.score < 1).length;
const taskCount = new Set(allBare.map((r) => r.task)).size;
const nRuns = SB.n + SG.n + HB.n + HG.n;

export const facts = {
  model: MODEL(before.res.model), task: before.res.task,
  before: { run: BEFORE, checks: before.res.checks, cost: before.res.metrics.costUsd, wall: before.res.wallSecs, failNames, greenPass, claim, ticks, claimedBroken },
  after: { run: AFTER, checks: after.res.checks, cost: after.res.metrics.costUsd, wall: after.res.wallSecs, criteria: crit.length, verifyRuns: verifyRuns.length, denies: denies.length, audit: verdict },
  aggregate: { runs: nRuns, bareRuns: allBare.length, bareSaidMet: metCount, bareBroken: brokenCount, haiku: { bare: HB, goalpost: HG }, sonnet: { bare: SB, goalpost: SG } },
};
console.log(JSON.stringify(facts, null, 2));

// ================= timeline =================
const S = [], C = [], CAP = [], PAN = [];
const cap = (at, until, html) => CAP.push({ at, until, html });
let t = 0;

// 0. hook
C.push({ at: t, until: t + 3.0, html: `<h1>You typed <span class="mono o">/goal</span>.</h1><p data-at="0.9">Then you walked away.</p>` });
t += 3.0;
C.push({ at: t, until: t + 4.4, html: `<h2>Claude: <span class="q">“${esc(finalLine)}”</span></h2><h1 data-at="1.5" class="r" style="margin-top:34px">${ticks} of ${issueNames.length} issues ticked ✅.<br>${claimedBroken.length} were still broken.</h1>` });
t += 4.4;

// 1. before
const s1 = { id: 'before', at: t, title: 'claude  ·  ~/textkit', pill: 'Without goalpost', pillColor: 'red', sub: `Claude Code  /goal  ·  ${MODEL(before.res.model)}  ·  real run`, lines: [] };
let x = 0.4;
s1.lines.push(P(x, `/goal ${prompt}`)); x += 2.3;
s1.lines.push(GOAL(x, `Goal set: ${clip(prompt, 72)}`)); x += 0.6;
s1.lines.push(TOOL(x, 'Read', 'ISSUES.md')); x += 0.35;
s1.lines.push(OUT(x, `${issueNames.length} open issues: ${issueNames.slice(0, 4).join(', ')}…`)); x += 0.6;
s1.lines.push(TOOL(x, 'Bash', 'npm test')); x += 0.5;
for (const n of failNames.slice(0, 3)) { s1.lines.push(OUT(x, `✖ ${n}`, 'bad')); x += 0.22; }
s1.lines.push(OUT(x, `${failPass} passing, ${failCount} failing`, 'bad')); x += 0.8;
for (const f of editFiles.slice(0, 5)) { s1.lines.push(TOOL(x, 'Edit', `src/${f}`)); x += 0.3; }
if (editFiles.length > 5) { s1.lines.push(OUT(x, `… ${editFiles.length - 5} more edits`)); x += 0.3; }
x += 0.2;
s1.lines.push(TOOL(x, 'Bash', 'npm test')); x += 0.5;
s1.lines.push(OUT(x, `${greenPass} passing, 0 failing`, 'ok', { from: 0.1, to: 2.4, color: 'green' }));
cap(s1.at + x, s1.at + x + 2.6, 'Tests are green. The agent declares victory.');
x += 2.6;
s1.lines.push(BLANK(x));
s1.lines.push(STRONG(x, claim, { from: 0.1, to: 3.0, color: 'red' })); x += 0.5;
const tickLines = finalText.split('\n').filter((l) => /✅/.test(l)).map((l) => l.replace(/[*`]/g, '').replace(/^\s*\d+\.\s*/, '').trim());
for (const l of tickLines.slice(0, 3)) { s1.lines.push({ at: x, text: l, cls: 'say', rich: `    ${esc(clip(l, 82))}` }); x += 0.3; }
s1.lines.push({ at: x, text: '…', cls: 'say', rich: `    … ${tickLines.length - 3} more ✅` }); x += 1.0;
s1.lines.push(GOAL(x, `/goal  ✓ met — “${clip(evalMet.reason.replace(/[`✔ℹ]/g, '').replace(/s+/g, ' ').replace(/'/g, ''), 96)}”`, { from: 0.1, to: 4, color: 'red' }));
cap(s1.at + x + 0.2, s1.at + x + 3.4, 'The /goal judge only reads the chat. <span class="r">It believed it.</span>');
x += 3.6;
PAN.push({
  at: s1.at + x, until: s1.at + x + 7.0, title: 'Hidden test suite', sub: `the agent never sees it · agent ticked ${claimedBroken.map((n) => '#' + n).join(' ')} ✅`, score: bPass, of: bTotal, color: 'var(--red)',
  items: bFails.slice(0, 6).map((r) => ({ ok: false, text: `${r.req.split(' ')[0]} ${r.title}`, note: '' })),
});
x += 7.2;
s1.until = s1.at + x;
S.push(s1);
t = s1.until;

// 2. stat card
C.push({ at: t, until: t + 5.4, html: `<h2>We ran bare <span class="mono o">/goal</span> ${allBare.length} times on ${taskCount} projects.</h2><h2 data-at="1.2" style="margin-top:22px">The judge said <span class="c">“done”</span> ${metCount} times.</h2><h1 data-at="2.5" class="r" style="margin-top:30px">${brokenCount} of them were broken.</h1><div class="fine" data-at="3.2">Sonnet 5.5 + Haiku 4.5 · hidden graders · every run graded 3× · all data in the repo</div>` });
t += 5.4;

// 3. install
const s3 = { id: 'install', at: t, title: 'PowerShell', pill: 'goalpost', pillColor: 'orange', sub: 'one install · then keep typing /goal', height: 430, lines: [] };
x = 0.4;
s3.lines.push(P(x, 'claude plugin marketplace add syntaxixr/goalpost', '<span class="ch">PS&gt; </span>')); x += 1.5;
s3.lines.push(OUT(x, '✔ Successfully added marketplace: goalpost', 'ok')); x += 0.7;
s3.lines.push(P(x, 'claude plugin install goalpost@goalpost', '<span class="ch">PS&gt; </span>')); x += 1.3;
s3.lines.push(OUT(x, '✔ Successfully installed plugin: goalpost@goalpost (scope: user)', 'ok')); x += 0.8;
s3.lines.push(BLANK(x));
s3.lines.push({ at: x + 0.1, text: '# or double-click install.bat · remove with uninstall.bat', cls: 'out' });
cap(s3.at + 0.6, s3.at + x + 2.6, 'Install once. <em>Nothing else changes</em> — you still just type /goal.');
x += 2.8;
s3.until = s3.at + x;
S.push(s3);
t = s3.until;

// 4. after
const s4 = { id: 'after', at: t, title: 'claude  ·  ~/textkit', pill: 'With goalpost', pillColor: 'green', sub: `same task · same model (${MODEL(after.res.model)}) · real run`, lines: [] };
x = 0.4;
s4.lines.push(P(x, `/goal ${prompt}`)); x += 2.3;
s4.lines.push(GP(x, 'spec first → .goal/SPEC.md: every requirement becomes a check that can fail')); x += 0.9;
cap(s4.at + x, s4.at + x + 3.6, `First a spec: <em>${crit.length} acceptance criteria</em>, each with a command that can fail.`);
for (const c of crit.slice(0, 6)) { s4.lines.push(OUT(x, `${c.id}  ${clip(c.text, 84)}`)); x += 0.28; }
s4.lines.push(OUT(x, `… ${crit.length - 6} more`)); x += 1.2;
if (failVerify) {
  s4.lines.push(TOOL(x, 'Bash', 'node .goal/verify.js')); x += 0.5;
  const ls = vLines(failVerify);
  for (const l of ls.filter((q) => /FAIL/.test(q)).slice(0, 3)) { s4.lines.push(OUT(x, clip(l, 100), 'bad')); x += 0.25; }
  x += 0.5;
}
if (denies.length) {
  const reason = firstLine(denies[0].result).replace(/^.*?goalpost:\s*/, '');
  s4.lines.push(GP(x, `denied: ${clip(reason, 100)}`, { from: 0.1, to: 3.6, color: 'orange' }));
  cap(s4.at + x, s4.at + x + 3.8, 'Changing a frozen check needs <em>a written reason</em>.');
  x += 3.8;
}
s4.lines.push(TOOL(x, 'Bash', 'node .goal/verify.js')); x += 0.5;
s4.lines.push(OUT(x, `${lastPass}/${lastLs.length} criteria PASS — every check ran after the last code edit`, 'ok')); x += 0.9;
s4.lines.push(TOOL(x, 'Agent', 'goalpost:auditor — fresh context, re-runs every check')); x += 0.8;
for (const l of auditLines) { s4.lines.push(OUT(x, clip(l, 100), /FAIL/.test(l) ? 'bad' : 'ok')); x += 0.35; }
cap(s4.at + x - 1.0, s4.at + x + 2.6, 'Then an auditor with <em>fresh context</em> checks coverage and looks for cheating.');
x += 1.2;
s4.lines.push(GP(x, `done — ${done.criteria}/${done.criteria} criteria verified, audit ${done.audit}`, { from: 0.1, to: 5, color: 'green' }, 'gp ok')); x += 2.0;
PAN.push({
  at: s4.at + x, until: s4.at + x + 6.6, title: 'Same hidden test suite', sub: `was ${bPass}/${bTotal} without goalpost · graded 3×`, score: aPass, of: aTotal, color: 'var(--green)',
  items: fixedNow.slice(0, 5).map((r) => ({ ok: true, text: `${r.req.split(' ')[0]} ${r.title}`, note: 'was failing' })),
});
cap(s4.at + x + 0.4, s4.at + x + 6.4, 'Same model. Same task. <span class="g">Everything works.</span>');
x += 6.8;
s4.until = s4.at + x;
S.push(s4);
t = s4.until;

// 5. results card
C.push({ at: t, until: t + 9.0, html: `<h2>Real runs. Hidden graders.</h2>
<table class="res" data-at="0.6">
<tr><th></th><th>bare /goal</th><th>/goal + goalpost</th></tr>
<tr><td>Haiku 4.5 — hidden checks passed (mean over 4 tasks)</td><td class="num lo">${pctS(HB.mean)}</td><td class="num hl">${pctS(HG.mean)}</td></tr>
<tr><td>Sonnet 5.5 — runs fully correct</td><td class="num">${SB.perfect}/${SB.n}</td><td class="num hl">${SG.perfect}/${SG.n}</td></tr>
<tr><td>Sonnet 5.5 — “done” but broken</td><td class="num lo">${SB.falseDone}/${SB.n}</td><td class="num hl">${SG.falseDone}/${SG.n}</td></tr>
<tr><td>Cost per run (Sonnet / Haiku)</td><td class="num">${usd(SB.cost)} / ${usd(HB.cost)}</td><td class="num">${usd(SG.cost)} / ${usd(HG.cost)}</td></tr>
</table>
<div class="fine" data-at="1.4">It costs about 2× a bare run. The two runs shown are one pair — this table counts all ${nRuns} runs.<br>Full data and the hidden graders are in the repo.</div>` });
t += 9.0;

// 6. outro
C.push({ at: t, until: t + 7.5, html: `<div class="logo">goalpost<span class="dotg">.</span></div>
<p data-at="0.5" style="color:#fff;font-weight:700;font-size:44px">Makes Claude Code’s <span class="o mono">/goal</span> actually finish the job.</p>
<div class="cmd" data-at="1.2"><span class="p">$</span> claude plugin marketplace add syntaxixr/goalpost<br><span class="p">$</span> claude plugin install goalpost@goalpost</div>
<div class="fine" data-at="1.8">github.com/syntaxixr/goalpost · MIT · Node only · Windows · macOS · Linux</div>` });
t += 7.5;
const total = t;

const DATA = { total, sessions: S, cards: C, captions: CAP, panels: PAN };
fs.writeFileSync(path.join(HERE, 'video-data.json'), JSON.stringify({ facts, total, sessions: S.map((s) => ({ id: s.id, at: s.at, until: s.until, lines: s.lines.map((l) => l.text) })) }, null, 2));

// ================= render =================
const only = arg('only', null);
const [fromS, toS] = only ? only.split('-').map(Number) : [0, total];
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(HERE, 'stage.html')).href);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((d) => window.setup(d), DATA);
  const frames = path.join(HERE, 'frames');
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });
  const n0 = Math.floor(fromS * FPS), n1 = Math.ceil(Math.min(toS, total) * FPS);
  for (let i = n0; i < n1; i++) {
    await page.evaluate((tt) => window.render(tt), i / FPS);
    await page.screenshot({ path: path.join(frames, `${String(i - n0).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 95 });
    if ((i - n0) % 300 === 0) console.log(`frame ${i - n0}/${n1 - n0}`);
  }
  const out = path.join(HERE, only ? 'preview.mp4' : 'goalpost.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'),
    '-vf', 'scale=in_range=pc:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', out]);
  if (!only) {
    // poster frame: the moment the hidden score appears after goalpost
    const posterT = S[2].until - 4.5;
    await page.evaluate((tt) => window.render(tt), posterT);
    await page.screenshot({ path: path.join(HERE, 'poster.png'), type: 'png' });
  }
  console.log(`${path.basename(out)}: ${(n1 - n0)} frames, ${total.toFixed(1)} s total, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
  if (!only) fs.rmSync(frames, { recursive: true, force: true });
} finally {
  await browser.close();
}
