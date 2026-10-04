# goalpost: make /goal finish the job

Claude Code's built-in `/goal` ends when a small judge model reads the conversation and says "met". The judge never runs a command or opens a file, so a confident "all done, tests pass" can fool it.

This plugin keeps typing `/goal` exactly as before and adds hooks around it. Every goal becomes a spec with acceptance criteria, and each criterion has a command that exits 0 only when it holds. Claude can't stop while a criterion has no fresh passing check, and a check only counts if it ran after the latest edit. Tests that existed when the goal started are read-only, so they can't be edited to fit the code. When everything passes, a fresh-eyes auditor agent re-runs the checks and hunts for stubs, skipped tests and hardcoded answers. Only a clean audit lets the goal end. After context compaction the spec and progress are put back.

## Use

Type `/goal <what you want>` like always. Check where it stands with `/goalpost:status`. Pause it with `/goalpost:off` and turn it back on with `/goalpost:on`. `/goalpost:release` stops enforcing the current goal.

It needs Node.js 18 or newer and works on Windows, macOS and Linux. There are no other dependencies, no network calls and no telemetry. The checks are commands in your own project, run in your own shell.

## What it costs

In a benchmark of 33 runs with hidden graders, goalpost took about twice the time and money of a bare `/goal`. Sonnet 5.5 finished 9 of 9 runs with every hidden check green (8 of 9 without it). It improved Haiku 4.5 from 79.8% to 89.7% of the hidden checks, but did not make it reliable. Use it for goals that matter, and switch it off for small ones.

## More

Benchmark, mechanics and the full list of settings are in the main repository: https://github.com/syntaxixr/goalpost

MIT license.
