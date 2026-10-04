# Prior art: who already fights "the agent stopped halfway"

Checked on 2026-10-01. Every project below was cloned or read in full (`research/analogs/`).
Stars are from the GitHub API on that date.

## Comparison

| Project | What it does well | Weak spot (for our problem) | What goalpost takes from it | License |
| --- | --- | --- | --- | --- |
| [ksimback/looper](https://github.com/ksimback/looper) (711★) | Designs the loop *before* it runs. Rubrics for goal quality, programmatic-first verification, a reviewer from another model family, explicit guards: max iterations, revision caps, no-progress stop, budget | It's a design coach. It interviews you (`disable-model-invocation: true`), writes `loop.yaml`, and hands the session a prompt. Nothing enforces the loop once it runs, and it can't run unattended in `-p` mode | Ordered checks (programmatic first, then a judge), several termination guards at once, a no-progress stop | MIT |
| [Q00/ouroboros](https://github.com/Q00/ouroboros) (6.2k★) | Socratic interview with an ambiguity score (gate at ≤ 0.2), an immutable "seed" spec with acceptance criteria, a 3-stage evaluation (mechanical → semantic → consensus), drift and stagnation detection | A whole "Agent OS": Python ≥ 3.12, uv, an MCP server, its own `ooo` commands. Works next to `/goal` rather than inside it. Heavy for "I just want /goal to finish" | The spec is frozen once work starts. Checks are cheap-and-mechanical first. Vague goals are turned into explicit assumptions | MIT |
| [jthack/claude-goal](https://github.com/jthack/claude-goal) (113★) | Codex-style `/goal` with persistent state (SQLite), pause/resume/clear, a Stop hook that blocks while a goal is active, a "completion audit" checklist | Completion is self-certified: the agent runs `claude_goal.py complete` itself. No evidence check, no protection for tests. Default cap is 500 continuations. It predates the built-in `/goal` and now competes with it for the name | Pause/clear semantics and a runaway cap. Also shows that the audit must not be run by the same agent | MIT |
| [trailofbits goal-prompt](https://skills.sh/trailofbits/skills/goal-prompt) (skill in trailofbits/skills) | The best public guide to writing a `/goal` condition: end state not activity, a stated check, invariants ("do not weaken, skip, or edit the checks"), a stop bound. Closes "easy-outs" (delete instead of fix, pass on a subset, game the gate, claim without running). Has ablation evals showing +0.69 | Helps write the *condition* once. Nothing during the run checks that the agent kept to it | The easy-out catalog becomes protocol rules and auditor checks. Their eval lesson too: the control arm must not be able to read the plugin from disk | CC-BY-SA-4.0 (ideas only, no text copied) |
| [gg2gg goal-mode](https://www.skills.sh/gg2gg/agent_eng_skills/goal-mode) | Wraps `/goal` with progress heartbeats (every 5 min) and desktop notifications | A skill the model has to choose to follow. 1 install. No license | The status line at the end of each turn (for people *and* for the evaluator) | none stated (ideas only) |
| [wlj103/super-spec](https://github.com/wlj103/super-spec) (1★) | A detailed catalog of how models cut corners: "Full" (N items in → N items out), "at least N" treated as a ceiling, vague "verification applied", 10 "Yes" filled in one second, … | A 7-gate document pipeline driven by a long prompt. No enforcement mechanism | The corner-cutting catalog feeds the auditor checklist. Coverage rule: every requirement in the goal maps to a criterion | MIT |
| [obra/superpowers](https://github.com/obra/superpowers) (294k★) | `verification-before-completion`: "NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE". Subagent-driven review | A skill: advice that the model may skip. Its only hook is SessionStart, which injects skill instructions | **Fresh** evidence. A check counts only if it ran after the last code edit. Also a separate reviewer subagent with a clean context | MIT |
| [kaina404/claude-code-workflow](https://github.com/kaina404/claude-code-workflow) (0★) | Planning with files (`task_plan.md`, `progress.md`), "3-strike error protocol", re-read the plan before decisions | Rules in CLAUDE.md and skills. Nothing enforces them. **No license file** | The 3-strike idea: the same error 3 times means change the approach. Also re-reading the plan every N steps | none (ideas only) |
| [harbor PR #2390](https://github.com/harbor-framework/harbor/pull/2390) | A clean ablation design for early stopping: prompt suffix vs `--continue` loop vs native `/goal` vs forced compaction | Closed without merge. The author called it "not a serious PR (yet)". **No results published** | Benchmark shape: compare arms that each change one mechanism, and count cost per arm | (PR, ideas only) |
| [bonfire-systems/goalkeeper](https://github.com/bonfire-systems/goalkeeper) (13★) — *found during research* | Contract (`contract.md`) with a Definition of Done, validator command, subagent judge gate, auto-pause after 5 rejections, a PreToolUse guard against editing its own state files | Replaces `/goal` with its own skill (`/goalkeeper:goal` plus aliases). The loop is kept alive by the skill's instructions, not a Stop hook. Hooks need `python3`, which plain Windows doesn't have | A judge gate after the validator passes, a rejection counter, and plugin state files the agent can't write to | MIT |
| [Mikhail-Za/Goalkeeper-Claude-skill](https://github.com/Mikhail-Za/Goalkeeper-Claude-skill) (4★) — *found during research* | A thorough orchestrator: a done-contract with per-item checks, an independent verifier that inspects the diff for gamed checks, item-stuck/no-progress/oscillation stops in code, `ESCALATION.md` | A separate workflow engine (`goalkeeper.workflow.js`) that you run instead of `/goal`. Lots of moving parts | Escalation through a file (our `BLOCKED.md`). A regression re-check of items that were already green before the final audit | MIT |

## What nobody does (our niche)

1. **Strengthen the built-in `/goal` itself.** Each project above either replaces `/goal`
   (claude-goal, bonfire goalkeeper), runs next to it as a separate workflow (Looper, Ouroboros,
   Mikhail-Za, Super-Spec), or only helps write the condition (Trail of Bits). goalpost
   attaches to the native command through hooks. You keep typing `/goal …`.
2. **Enforce through hooks, not instructions.** In skills, "verify before claiming done" is
   advice. In goalpost it's a Stop hook that checks files on disk (frozen spec, passing check
   records newer than the last edit, an audit by a fresh subagent) and blocks the stop with a
   concrete reason.
3. **Cover the evaluator's blind spot.** The `/goal` evaluator reads only the transcript
   ([MECHANICS.md](MECHANICS.md)). If it is talked into "met", the built-in goal clears.
   goalpost's Stop hook runs in parallel and keeps the session alive until the files agree.
4. **Zero dependencies.** Node.js only, which Claude Code users already have. No Python, uv,
   MCP server or database.

## What we deliberately did not take

* **Interviews before work** (Looper, Ouroboros, bonfire `/goal-prep`). `/goal` is for
  unattended runs, so stopping to ask questions defeats it. goalpost asks the agent to write
  assumptions down instead and lets the auditor check them.
* **Cross-vendor reviewer models** (Looper). Useful, but they add accounts and keys. The
  auditor is a fresh Claude subagent. Swapping it for another model later is one file.
* **Reset-to-last-good on regression** (Mikhail-Za). Too invasive for a hook that runs inside
  someone's working tree.

## Licensing

goalpost copies **no code** from any of these projects. Ideas are credited in
[CREDITS.md](../CREDITS.md). Projects with no license or with CC-BY-SA were used for ideas only.
