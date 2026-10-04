# Name options

The working name is **goalpost**. It is the thing a goal is measured against, and it plays on the
usual complaint about agents ("they keep moving the goalposts"): here the posts are frozen.

| Name | Why | Collisions found on GitHub (2026-10-01) |
| --- | --- | --- |
| **goalpost** (current) | Short, memorable, says what it does: the goal stays where it was set. Works as a verb ("goalposted it") | Only unrelated projects (a Go queue, a hockey image detector, a social-post tracker). Nothing in the Claude Code space |
| **holdline** | "Hold the line": the Stop hook refuses to let the agent leave early | Several tiny unrelated repos (a phone-call tool, a climbing-gym API); nothing for Claude Code |
| **finishline** | Plain, says "until the end" | Many unrelated repos with this name; harder to find |

Not usable: **goalkeeper** is already taken by two Claude Code projects
([bonfire-systems/goalkeeper](https://github.com/bonfire-systems/goalkeeper) and
[Mikhail-Za/Goalkeeper-Claude-skill](https://github.com/Mikhail-Za/Goalkeeper-Claude-skill)), and
users would confuse the two.

To rename: change `name` in `plugin/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`,
the `goalpost:auditor` string in `plugin/scripts/lib/config.js`, `plugin/hooks/hooks.json`
(`^goalpost:auditor$`), the tests, and the README install lines.
