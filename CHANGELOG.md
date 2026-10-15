# Changelog

## 2026-10-01 — first release

- Hooks for the built-in `/goal`: `UserPromptSubmit` (start + protocol), `PreToolUse`
  (spec first, frozen criteria, read-only tests and goalpost files), `PostToolUse` /
  `PostToolUseFailure` (evidence log, repeated-error detection, anti-drift checkpoints),
  `Stop` (completion gate with loop guards), `SubagentStop` (audit verdict), `SessionStart`
  (re-inject the plan after compaction and resume).
- `.goal/verify.js`: runs the Verify commands from SPEC.md and records exit codes.
- `goalpost:auditor` subagent for the final fresh-eyes review.
- `/goalpost:status`, `/goalpost:on`, `/goalpost:off`, `/goalpost:release`.
- One config file (`~/.claude/goalpost.json` or `.claude/goalpost.json`) and the `GOALPOST=off` switch.
- Test suite (Node built-in test runner), CI on Linux, macOS and Windows.
- Benchmark harness with three tasks and hidden graders (`bench/`).

## 2026-10-03

- Fix: PowerShell here-strings, `$variables`, `-Value` arguments and quoted text with `<`/`>` were
  taken for write targets, so updating `.goal/PROGRESS.md` from PowerShell marked every check stale.
  Found by a Haiku benchmark run on Windows.
- Shell write detection looks only at real targets (redirects, file-command arguments,
  `writeFileSync`-style calls); heredoc bodies are ignored.
- Declared "Test changes" count at any time and are reviewed by the auditor (migrations need them).
- One-time notice when the built-in evaluator says "met" while checks are still open.
- `install.bat` / `uninstall.bat` (Windows) and `install.sh` / `uninstall.sh`, tested end to end.
- Benchmark: 26 valid runs on Sonnet 5.5 and Haiku 4.5, strict 3× grading, results in docs/BENCHMARK.md.

## 2026-10-04

- Fix: an unmarked `.goal/BLOCKED.md` is challenged once instead of ending the goal; only a blocker starting
  with `USER:` stops at once. Found when a Haiku run used it to escape its own broken check.
- Fix: running background tasks no longer defer the Stop check (a headless `claude -p` session never wakes up,
  so deferring silently ended an unfinished goal).
- Benchmark: 33 valid runs; per-task means so arms with unequal run counts compare fairly.
- Demo video built from two real runs (docs/media, `node docs/media/make-video.mjs`).
- README banner and teaser GIF (`node docs/media/make-banner.mjs`).

## 2026-10-07

- Fewer tokens: `.goal/PROGRESS.md` is a hint now, never a reason to keep the session going (every extra turn
  re-reads the whole context); no per-reply status line; a shorter protocol and SPEC template; `verify.js`
  is run once after a batch of edits.
- The auditor batches its work: reads in one message, `node .goal/verify.js` and `git` in one shell call, and
  a re-audit starts from the previous FAIL lines instead of from scratch.
- `auditMinCriteria` (default 0 = always audit) skips the audit for small goals, unless a criterion is manual
  or tests are declared under "## Test changes".
- `bench/audit-probe.js`: a half-done repository where every check is green (the auditor must FAIL) and a
  done control (it must PASS). Results in docs/BENCHMARK.md.
- docs/BENCHMARK.md: run-to-run spread, and how much of the Haiku gain comes from one task.

## 2026-10-10

- `/goalpost:selftest` (`node plugin/scripts/gp.js selftest`): proves the hooks enforce on this machine by driving
  them through a throwaway goal whose check fails first. Suggested by a reader on r/SideProject.
- Criteria whose check never failed during the goal are named by `verify.js` and `/goalpost:status`, and the
  auditor decides whether those checks could fail at all. A hint, never a blocker. Asked on r/LLMDevs.


## 2026-10-15

- The plugin no longer copies the whole environment into the processes it starts. `verify.js` sets one flag
  on its own process instead of building an env object from `process.env`, and `selftest` points its own
  process at the throwaway project. The directory scanner read the copy as "reads a credential from the
  user's machine"; nothing was sent anywhere, and the plugin still opens no network connection.
- `hooks/hooks.json` is only the `hooks` map (no extra top-level `description`).
- docs/BENCHMARK.md: follow-up round on the spreadsheet task with Haiku 5.5 (Claude Code's `haiku` alias moved off
  4.5). Bare 99.3% (one "met" at 71/73), goalpost 100% on 3 runs, but goalpost released early in 2 of them. Kept
  separate from the 4.5 tables.
