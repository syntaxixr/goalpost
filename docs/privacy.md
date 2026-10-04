# Privacy

goalpost collects nothing.

- **No data leaves your machine.** The hooks are small Node scripts that run locally. There are no network calls, no analytics, no telemetry, no accounts and no keys.
- **What it writes.** In a project where you use `/goal`, it creates a `.goal/` folder with `SPEC.md`, `PROGRESS.md`, `evidence.log`, `state.json`, `verify.js` and, when something needs you, `BLOCKED.md`. These are your specs and logs. Delete the folder whenever you like. The only file outside the project is the optional config `~/.claude/goalpost.json`, and you create that yourself.
- **What it runs.** The Verify commands in `.goal/SPEC.md` are written by Claude, are visible in the spec, and are run by `node .goal/verify.js` in your own shell with a timeout (900 seconds by default). They have the same permissions as any other command Claude runs for you in that project.
- **The auditor.** The `goalpost:auditor` agent is an ordinary Claude Code subagent of your session. It goes to the same model provider as the rest of your session. goalpost adds no other destination.

Questions: open an issue at https://github.com/syntaxixr/goalpost/issues
