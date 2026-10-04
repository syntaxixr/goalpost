# Credits

goalpost contains no code copied from other projects. It does build on ideas that other people
worked out first, and they deserve the credit:

| Idea in goalpost | Where it comes from |
| --- | --- |
| Design the loop before running it; programmatic checks first, judge second; several termination guards at once (iteration cap, no-progress stop, budget) | [Looper](https://github.com/ksimback/looper) by Kevin Simback (MIT) |
| Spec frozen before code; vague goals turned into explicit criteria; cheap mechanical checks before semantic review | [Ouroboros](https://github.com/Q00/ouroboros) by Q00 (MIT) |
| A Stop hook that keeps a goal alive; a runaway cap; pause/clear semantics; the audit must not be self-certified | [claude-goal](https://github.com/jthack/claude-goal) by Joseph Thacker (MIT) |
| "Easy-outs" a lazy model takes (delete instead of fix, pass on a subset, game the gate, claim without running); "do not weaken, skip, or edit the checks"; control arms must not be able to read the plugin from disk | [goal-prompt](https://skills.sh/trailofbits/skills/goal-prompt) by Trail of Bits (CC-BY-SA-4.0, ideas only) |
| Status line every turn so progress is visible | [goal-mode](https://www.skills.sh/gg2gg/agent_eng_skills/goal-mode) by gg2gg (ideas only) |
| Catalog of corner-cutting tactics; "N items in → N items out" coverage rule | [Super-Spec](https://github.com/wlj103/super-spec) by wlj103 (MIT) |
| "No completion claims without fresh verification evidence"; review by a subagent with a clean context | [Superpowers](https://github.com/obra/superpowers) by Jesse Vincent (MIT) |
| Plan and progress in files; the 3-strike rule for repeated errors | [claude-code-workflow](https://github.com/kaina404/claude-code-workflow) by kaina404 (no license, ideas only) |
| Arms that each change one mechanism when benchmarking early stopping | [harbor PR #2390](https://github.com/harbor-framework/harbor/pull/2390) by Dariush Wahdany |
| A judge gate after the validator passes; plugin state files the agent can't write | [goalkeeper](https://github.com/bonfire-systems/goalkeeper) by bonfire-systems (MIT) |
| Escalation through a file; re-checking already-green items before the end | [Goalkeeper](https://github.com/Mikhail-Za/Goalkeeper-Claude-skill) by Mikhail-Za (MIT) |

The hook mechanics are documented by Anthropic in the
[Claude Code hooks reference](https://code.claude.com/docs/en/hooks) and the
[`/goal` docs](https://code.claude.com/docs/en/goal). What goalpost relies on beyond the docs
was measured and is written up in [docs/MECHANICS.md](docs/MECHANICS.md).
