# goalpost: make /goal finish the job

Claude Code's built-in `/goal` ends when a small judge model reads the conversation and says "met". The judge never runs a command or opens a file, so a confident "all done, tests pass" can fool it.

This plugin keeps typing `/goal` exactly as before and adds hooks around it. Every goal becomes a spec with acceptance criteria, and each criterion has a command that exits 0 only when it holds. Claude can't stop while a criterion has no fresh passing check, and a check only counts if it ran after the latest edit. Tests that existed when the goal started are read-only, so they can't be edited to fit the code. When everything passes, a fresh-eyes auditor agent re-runs the checks and hunts for stubs, skipped tests and hardcoded answers. Only a clean audit lets the goal end. After context compaction the spec and progress are put back.

## Use

Type `/goal <what you want>` like always. Check where it stands with `/goalpost:status`. Pause it with `/goalpost:off` and turn it back on with `/goalpost:on`. `/goalpost:release` stops enforcing the current goal.

It needs Node.js 18 or newer and works on Windows, macOS and Linux. There are no other dependencies, no network calls and no telemetry. The checks are commands in your own project, run in your own shell.

## What it costs

In a benchmark of 33 runs with hidden graders, goalpost took about twice the time and money of a bare `/goal`. Sonnet 5.5 finished 9 of 9 runs with every hidden check green (8 of 9 without it). It improved Haiku 4.5 from 79.8% to 89.7% of the hidden checks, but did not make it reliable. Use it for goals that matter, and switch it off for small ones.

## What it runs and touches

Everything is plain Node.js from this plugin's `scripts/` folder, with no dependencies, no network access and nothing downloaded at run time.

- **Seven hooks**, each `node ${CLAUDE_PLUGIN_ROOT}/scripts/hook.js <Event>`: SessionStart, UserPromptSubmit, PreToolUse (only for Write, Edit, MultiEdit, NotebookEdit, Bash and PowerShell), PostToolUse, PostToolUseFailure, Stop, and SubagentStop for the goalpost auditor only. They read the hook input, decide, and print a JSON answer.
- **Files they read:** `.goal/` in the project, the session transcript Claude Code passes them (to follow the built-in `/goal` records: set, met, cleared), the list of existing test files when a goal starts, and `~/.claude/goalpost.json` or `.claude/goalpost.json` if you created one.
- **Files they write:** `.goal/` in the project (SPEC.md and PROGRESS.md templates, state.json, evidence.log, AUDIT.md, verify.js), and a small offset file under the system temp folder (`goalpost/<session>.offset`).
- **Commands:** the only commands goalpost runs are the Verify commands Claude writes into `.goal/SPEC.md`, through `node .goal/verify.js`, in the project folder, in your shell, with a timeout. On Windows verify.js looks for Git Bash (`where git`).
- **Skills** `status`, `on`, `off`, `release` and `selftest` run `node scripts/gp.js`. `on` and `off` write `enabled` to `~/.claude/goalpost.json`; `selftest` works in a throwaway folder under the temp folder and deletes it.
- **Agent:** `auditor`, with Read, Grep, Glob and Bash, told not to modify files.

## More

Benchmark, mechanics and the full list of settings are in the main repository: https://github.com/syntaxixr/goalpost

MIT license.
