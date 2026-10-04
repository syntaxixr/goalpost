# How `/goal` works under the hood (measured, not guessed)

Everything below was checked on **Claude Code 2.1.285** (Windows 10, Node 24) with a probe
plugin that logs every hook event to a file (`research/probe-plugin`). The raw logs and
transcripts of each experiment are in `research/experiments/e*/`. Experiments ran in
non-interactive mode (`claude -p`), which the docs say runs the same `/goal` loop
("Setting a goal with `-p` runs the loop to completion in a single invocation").

Docs used: [goal](https://code.claude.com/docs/en/goal), [hooks](https://code.claude.com/docs/en/hooks),
[hooks guide](https://code.claude.com/docs/en/hooks-guide), [plugins](https://code.claude.com/docs/en/plugins).
Snapshots are in `research/docs/`.

## TL;DR

| Question | Answer | Evidence |
| --- | --- | --- |
| Does `UserPromptSubmit` fire for `/goal <condition>`? | **Yes.** `prompt` holds the full text, e.g. `"/goal a file named hello.txt exists …"` | e1b, e2, e9 |
| Does `UserPromptSubmit` fire for `/goal clear` or bare `/goal`? | **No.** These are local commands that never reach the model, so no hook sees them | e6, e7 |
| Does `UserPromptExpansion` (matcher `goal` or empty) fire for `/goal`? | **No**, never. `/goal` is a built-in, not a prompt-type command | e1b–e9 |
| Does `additionalContext` from `UserPromptSubmit` reach the model on a `/goal` turn? | **Yes.** The model followed an injected rule from its very first reply | e9 |
| Where is goal state visible to a hook? | In the session transcript (`transcript_path`) as `attachment.type == "goal_status"` records | all |
| Does our Stop hook run together with the `/goal` evaluator? | **Yes, in parallel**, on the same stop. Both are listed in one `stop_hook_summary` (`hookCount: 2`) | e2 |
| If the evaluator says "met" but our hook blocks? | The goal is cleared **and** Claude keeps working because of our block. After that only our hook is left | e2, e3, e4 |
| Block cap | 8 consecutive blocks are honored; the 9th is overridden. **The counter resets when Claude uses a tool**, so a working agent is not capped | e3 (cap hit), e4 (14 blocks honored) |
| Goal after compaction | Survives. Claude Code re-writes a `goal_status` "set" record right after `compact_boundary` | e8 |
| Goal after resume | Restored (`/goal` status: `Goal active … (not yet evaluated)`) | e6, e8 |

## 1. `UserPromptSubmit` sees `/goal <condition>`

Probe output for `claude -p "/goal a file named hello.txt exists … verified by printing it with cat"`:

```
SessionStart      {"source":"startup"}
UserPromptSubmit  {"prompt":"/goal a file named hello.txt exists in the current directory containing exactly the word hi, verified by printing it with cat"}
PreToolUse        Bash  printf 'hi' > hello.txt && cat hello.txt
PostToolUse       Bash  ...
Stop              {"stop_hook_active":false, ...}
```

The condition text is right there, so a plugin can activate itself on a normal `/goal`.
No wrapper command is needed.

`/goal clear` and bare `/goal` are different: with a resumed session that had an active
goal, neither produced a `UserPromptSubmit` event (only `SessionStart`/`SessionEnd`).
They are handled locally and print `Goal cleared: …` / `Goal active: …`. So a hook can't
catch them directly. It can only notice the result in the transcript (section 3).

**Windows gotcha (cost us one experiment):** Git Bash rewrites a leading `/goal` argument
into a path. `claude -p "/goal …"` from Git Bash arrived as
`"C:/Program Files/Git/goal …"`, so no goal was set at all (e1). Use
`MSYS_NO_PATHCONV=1`, PowerShell or cmd. The benchmark runner sets it.

## 2. `UserPromptExpansion` does not fire for `/goal`

Two handlers were registered: one with no matcher and one with `matcher: "goal"`.
Neither fired in any run. The docs describe this event for "skill and custom commands"
and MCP prompts. `/goal` is a built-in that sets a session hook.

## 3. Detecting goal state: `goal_status` records in the transcript

`/goal` writes `attachment` records of type `goal_status` into the session JSONL:

| Event | Record |
| --- | --- |
| Goal set (`/goal X`) | `{"type":"goal_status","met":false,"sentinel":true,"condition":"X"}` |
| Evaluator: met | `{"type":"goal_status","met":true,"condition":"X","reason":"…","iterations":1,"durationMs":…,"tokens":…}` |
| Evaluator: impossible | `{"type":"goal_status","met":false,"failed":true,"condition":"X","reason":"…"}` |
| User ran `/goal clear` | `{"type":"goal_status","met":true,"sentinel":true,"condition":"X"}` + local output `Goal cleared: X` |
| After compaction | a fresh "set" record (`sentinel:true, met:false`) right after `compact_boundary` |

The injected directive Claude Code sends to the model when a goal is set (meta user
message) is:

> A session-scoped Stop hook is now active with condition: "X". Briefly acknowledge the goal,
> then immediately start (or continue) working toward it — treat the condition itself as your
> directive and do not pause to ask the user what to do. The hook will block stopping until the
> condition holds. It auto-clears once the condition is met …

Reliable detection, then:

* **Goal started:** `UserPromptSubmit` with a prompt matching `^/goal\s+(?!clear|stop|off|reset|none|cancel)\S`.
  As a fallback, the latest `goal_status` record is a "set" sentinel.
* **Goal cleared by the user:** latest record has `sentinel:true, met:true`.
* **Achieved (per evaluator):** latest record has `met:true` and no `sentinel`.
* **Impossible:** latest record has `failed:true`.
* **`/clear`:** starts a new session (`SessionStart` with `source:"clear"`, new `session_id`),
  and the docs say it removes the goal. Keying plugin state by `session_id` handles it.

Caveats. The transcript format is internal and undocumented, so the plugin treats it as a
hint and falls back safely if it changes. The docs also warn the transcript "is written
asynchronously and may lag": the evaluator's verdict for the *current* stop is not on disk
yet when Stop hooks run (they run in parallel). Records from earlier turns are.

## 4. Our Stop hook vs the built-in evaluator

`/goal` is a session-scoped *prompt* Stop hook. Ours is a *command* Stop hook. Claude Code
runs all matching hooks in parallel, and the transcript shows both in one summary:

```json
{"subtype":"stop_hook_summary","hookCount":2,"hookInfos":[
  {"command":"node ${CLAUDE_PLUGIN_ROOT}/scripts/log.js Stop","durationMs":61},
  {"command":"a file named hello.txt exists …","promptText":"a file named hello.txt exists …","durationMs":2590}]}
```

e2 is the key experiment. Our hook blocked twice; the evaluator said **met** on the first
stop:

```
ASSIST   `hello.txt` now exists … so the goal is met.
USER     Stop hook feedback: PROBE block #1: reply with the single word BANANA1 …
ATTACH   goal_status met:true  (goal cleared by Claude Code)
ASSIST   BANANA1                     <- still working, because of OUR block
USER     Stop hook feedback: PROBE block #2 …
ASSIST   BANANA2
(stop allowed, session ends)
```

What follows from that:

1. Any blocking hook wins: if either the evaluator or our hook says "continue", Claude continues.
2. When the evaluator gets fooled and says "met" early, the built-in goal is gone, but
   **our hook can still hold the line**. This is the plugin's main lever.
3. Our hook can't see the evaluator's verdict for the same stop. It runs at the same time.
4. Our block reasons stay in the transcript as `Stop hook feedback: …`. The evaluator reads
   the transcript on later turns, so our concrete "AC-3 has no passing check" messages
   also make the evaluator harder to fool.

### `stop_hook_active` and the block cap

* `stop_hook_active` is `false` on the first stop of a turn chain and `true` on every stop
  that follows a hook-forced continuation (e2, e3, e4).
* e3: hook blocks forever, Claude only answers with text. Claude Code honored 8 blocks and
  overrode the 9th: `A hook blocked the turn from ending 9 consecutive times — overriding
  and ending turn … Set CLAUDE_CODE_STOP_HOOK_BLOCK_CAP to raise this limit.`
* e4: hook blocks 14 times and each time Claude runs one Bash command. **All 14 blocks
  were honored.** The "consecutive" counter only counts continuations without tool use,
  which matches the docs ("eight times in a row without progress") and the `/goal` page
  ("no tool use for several turns in a row").

So the native cap protects against text-only ping-pong and doesn't limit real work.
A plugin still needs its own guards: a smaller no-progress cap (so we release before
Claude Code overrides us with a warning) and a total cap per goal.

## 5. Compaction and resume

e8: goal set → session cut by `--max-turns 1` → `claude -p "/compact" --resume <id>` →
`claude -p "continue" --resume <id>`:

```
SessionStart  {"source":"resume", ...}
PreCompact    {"trigger":"manual"}
SubagentStop  {"agent_type":"", ...}        <- compaction itself runs as a subagent
SessionStart  {"source":"compact"}
PostCompact   {"trigger":"manual","compact_summary":"..."}
...
SessionStart  {"source":"resume"}
UserPromptSubmit {"prompt":"continue"}
Stop          -> evaluator: met
```

* After compaction the goal is still active (`goal_status` set-sentinel right after the boundary).
* `SessionStart` fires with `source: "compact"` after compaction and `"resume"` on resume,
  so it's the right place to re-inject SPEC/PROGRESS.
* **Gotcha:** compaction fires `SubagentStop` with an empty `agent_type`. A `SubagentStop`
  handler must check the agent type.

## 6. Other facts the design relies on (from the docs)

* Hook output caps: `additionalContext` and plain stdout are cut at 10,000 characters.
  Longer text is saved to a file and only a 2,000-char preview reaches Claude.
* `additionalContext` should read as factual project information. Text framed as
  out-of-band system commands "can trigger Claude's prompt-injection defenses".
* `PreToolUse` `permissionDecision: "deny"` blocks a tool call, in any permission mode.
  Hooks from plugins also run inside subagents. Tool events then carry `agent_id`/`agent_type`.
* Exit code 2 or `decision: "block"` on `Stop` keeps Claude going. On `PostToolUse` and
  `PostToolUseFailure`, `additionalContext` lands next to the tool result.
* Exec form (`"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/…"]`) avoids shell
  quoting and works on Windows, macOS and Linux. `node.exe` is a real binary.
* `/goal` is unavailable when `disableAllHooks` is true, so plugin hooks and `/goal` live
  and die together.

## 7. End-to-end checks of the finished plugin

| Check | Setup | Result |
| --- | --- | --- |
| Small goal, plugin loaded with `--plugin-dir` | `/goal src/slug.js exports slugify(str) …` on 2.1.286 | SPEC with 3 criteria and assumptions, spec froze at first edit, stale checks re-run, `goalpost:auditor` → PASS, goal closed. 49 s vs 29 s bare |
| **Installed with `install.bat`** in a normal session (user settings, 29 other plugins enabled, no `--plugin-dir`) | `/goal hello.js prints exactly 'hello goalpost' …` | `.goal/` created, check passed, audit PASS, done. Then `uninstall.bat` removed plugin and marketplace, and `claude plugin list` no longer shows it |
| **Compaction and resume** | Goal cut by `--max-turns 4`, then `claude -p "/compact" --resume <id>` | `SessionStart:resume` and `SessionStart:compact` both returned the recap ("the /goal below is still in progress (the context was just compacted)…" + SPEC.md + PROGRESS.md + open items). The resume recap is in the transcript; the compact one is attached to the next model request |
| **Fallback without `UserPromptSubmit`** (hook removed from a copy of the plugin) | `/goal greet.js exports greet(name) …` on 2.1.287 | First Stop found the goal's "set" record in the transcript, activated goalpost and blocked with the protocol. Claude then wrote the SPEC, verified 2/2, audit PASS, done |

The last row is why goalpost doesn't depend on `UserPromptSubmit` seeing `/goal` on every surface
(interactive TUI, IDE, desktop): the transcript record is written by `/goal` itself.

## 8. Design decisions this leads to

| Need | Mechanism chosen | Why |
| --- | --- | --- |
| Activate on plain `/goal` | `UserPromptSubmit` regex on `prompt` + transcript `goal_status` fallback | Verified to fire. The fallback covers surfaces we couldn't test (IDE, desktop) |
| Know when the user cleared the goal | Read the newest `goal_status` record before every block | `/goal clear` fires no hook |
| Keep going when the evaluator is fooled | Deterministic command Stop hook that checks files, not words | Runs in parallel and keeps the session alive after a false "met" |
| Don't fight the user | Release on `/goal clear`, on "impossible", on a written blocker | Matches `/goal` semantics |
| Loop safety | Own no-progress cap (3) below Claude Code's cap (8), plus a total cap | Native cap resets on tool use, so it never stops a busy but stuck agent |
| Survive compaction/resume | `SessionStart` matcher `compact|resume` re-injects SPEC + PROGRESS | Verified event order |
| Wrapper command? | Not needed | Direct interception works, so the user keeps typing `/goal` |
