'use strict';
// .goal/evidence.log: one JSON object per line. goalpost appends; nobody edits.
const fs = require('fs');
const { goalPaths } = require('./state');
const { normalize } = require('./spec');

function appendEvidence(root, rec) {
  const line = JSON.stringify(Object.assign({ t: new Date().toISOString() }, rec)) + '\n';
  try {
    fs.mkdirSync(goalPaths(root).dir, { recursive: true });
    fs.appendFileSync(goalPaths(root).evidence, line);
  } catch (e) {
    /* evidence is best effort; never break the hook */
  }
}

function readEvidence(root) {
  let text = '';
  try {
    text = fs.readFileSync(goalPaths(root).evidence, 'utf8');
  } catch (e) {
    return [];
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch (e) {
      /* skip a torn line */
    }
  }
  return out;
}

// Status of each criterion from the evidence. Only `verify` records written by verify.js count.
//   pass     latest check passed, started after the latest code edit, same command as now
//   fail     latest check failed
//   stale    latest check passed but code changed after it started
//   changed  the Verify command was edited after the latest check
//   never    never checked
//   manual   judged by the auditor
//   noverify criterion has no Verify line
function criteriaStatus(criteria, evidence, state) {
  const lastEditAt = (state && state.lastEditAt) || 0;
  const startedMs = (state && state.startedMs) || 0;
  const latest = {};
  for (const r of evidence) {
    if (r.kind !== 'verify' || !r.id) continue;
    const started = Date.parse(r.start || r.t) || 0;
    if (started < startedMs) continue; // from an earlier goal
    latest[r.id] = r;
  }
  const result = {};
  for (const c of criteria) {
    if (c.manual) { result[c.id] = { status: 'manual' }; continue; }
    if (!c.verify) { result[c.id] = { status: 'noverify' }; continue; }
    const r = latest[c.id];
    if (!r) { result[c.id] = { status: 'never' }; continue; }
    if (normalize(r.cmd) !== normalize(c.verify)) { result[c.id] = { status: 'changed', rec: r }; continue; }
    if (r.exit !== 0) { result[c.id] = { status: 'fail', rec: r }; continue; }
    const started = Date.parse(r.start || r.t) || 0;
    if (started < lastEditAt) { result[c.id] = { status: 'stale', rec: r }; continue; }
    result[c.id] = { status: 'pass', rec: r };
  }
  return result;
}

module.exports = { appendEvidence, readEvidence, criteriaStatus };
