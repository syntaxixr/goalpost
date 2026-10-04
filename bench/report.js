#!/usr/bin/env node
'use strict';
// Turns bench/results/<round>/*.json into Markdown for docs/BENCHMARK.md.
//   node bench/report.js r1 r2 r3
const fs = require('fs');
const path = require('path');

const rounds = process.argv.slice(2);
const fmtMin = (s) => (s == null ? '—' : s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
const fmtUsd = (x) => (x == null ? '—' : `$${x.toFixed(2)}`);
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1).replace(/\.0$/, '')}%`);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function load(round) {
  const dir = path.join(__dirname, 'results', round);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.grade.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}
function invalid(round) {
  const dir = path.join(__dirname, 'results', round, 'invalid');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
}
const evaluatorSaid = (m) => {
  const ev = (m.evaluator || []).filter((e) => e.kind !== 'set');
  return ev.length ? ev[ev.length - 1].kind : 'none';
};
// A "false completion": the built-in evaluator said met, but hidden checks failed.
const falseDone = (r) => evaluatorSaid(r.metrics || {}) === 'met' && r.score < 1;

const all = rounds.flatMap((rd) => load(rd).map((r) => Object.assign(r, { round: rd })));
const groups = {};
for (const r of all) {
  const k = `${r.model}|${r.task}|${r.arm}`;
  (groups[k] = groups[k] || []).push(r);
}

console.log('### Summary by model, task and arm\n');
console.log('| Model | Task | Arm | Runs | Hidden checks (mean) | Worst run | Runs at 100% | "Done" while checks failed | Wall time (mean) | Cost (mean) |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const k of Object.keys(groups).sort()) {
  const rs = groups[k];
  const [model, task, arm] = k.split('|');
  const scores = rs.map((r) => r.score || 0);
  console.log(`| ${model} | ${task} | ${arm} | ${rs.length} | ${pct(mean(scores))} | ${pct(Math.min(...scores))} | ${rs.filter((r) => r.score === 1).length}/${rs.length} | ${rs.filter(falseDone).length}/${rs.length} | ${fmtMin(mean(rs.map((r) => r.wallSecs)))} | ${fmtUsd(mean(rs.map((r) => (r.metrics && r.metrics.costUsd) || 0)))} |`);
}

console.log('\n### Totals by model and arm\n');
console.log('| Model | Arm | Runs | Mean hidden-check score | Runs at 100% | "Done" while checks failed | Mean wall time | Mean cost |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
const byMA = {};
for (const r of all) (byMA[`${r.model}|${r.arm}`] = byMA[`${r.model}|${r.arm}`] || []).push(r);
for (const k of Object.keys(byMA).sort()) {
  const rs = byMA[k];
  const [model, arm] = k.split('|');
  console.log(`| ${model} | ${arm} | ${rs.length} | ${pct(mean(rs.map((r) => r.score || 0)))} | ${rs.filter((r) => r.score === 1).length}/${rs.length} | ${rs.filter(falseDone).length}/${rs.length} | ${fmtMin(mean(rs.map((r) => r.wallSecs)))} | ${fmtUsd(mean(rs.map((r) => (r.metrics && r.metrics.costUsd) || 0)))} |`);
}

console.log('\n### Every run\n');
console.log('| Round | Model | Task | Arm | Rep | Hidden checks | Evaluator said | goalpost end | Blocks / denies / audits | Wall | Cost | Tool calls |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of all.sort((a, b) => (a.round + a.model + a.task + a.arm + a.rep).localeCompare(b.round + b.model + b.task + b.arm + b.rep))) {
  const m = r.metrics || {};
  const g = m.goalpost;
  const end = g && g.end ? (g.end.kind === 'done' ? 'done' : `released: ${g.end.why}`) : '—';
  console.log(`| ${r.round} | ${r.model} | ${r.task} | ${r.arm} | ${r.rep} | ${r.checks} | ${evaluatorSaid(m)} | ${end} | ${g ? `${g.blocks} / ${g.denies} / ${g.audits.join(',') || '—'}` : '—'} | ${fmtMin(r.wallSecs)} | ${fmtUsd(m.costUsd)} | ${m.toolCalls} |`);
}

console.log('\n### Hidden checks that failed\n');
for (const r of all) {
  const fails = ((r.grade && r.grade.results) || []).filter((x) => !x.ok);
  if (!fails.length) continue;
  console.log(`- **${r.round} ${r.model} ${r.task} / ${r.arm} #${r.rep}**: ${fails.map((f) => `${f.title}${f.passes ? ` (passed ${f.passes}/${f.of})` : ''}`).join('; ')}`);
}

const inv = rounds.flatMap((rd) => invalid(rd).map((f) => `${rd}/${f}`));
if (inv.length) {
  console.log('\n### Runs thrown out\n');
  console.log('These runs were stopped from outside (not by the agent), so they say nothing about either arm. Where the limit allowed they were re-run; the rest are simply missing from the tables above.\n');
  for (const f of inv) {
    const [rd, file] = f.split('/');
    let why = '';
    try { why = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', rd, 'invalid', file), 'utf8')).reason || ''; } catch (e) { /* ignore */ }
    if (!why) why = /ratelimited/.test(file) ? 'cut off by the account rate limit' : '';
    console.log(`- ${rd} ${file.split('.')[0]}: ${why}`);
  }
}
