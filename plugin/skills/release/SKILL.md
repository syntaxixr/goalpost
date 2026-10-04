---
name: release
description: Stop goalpost from enforcing the current goal (the built-in /goal itself is not touched).
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/gp.js" release`

Tell the user the result above in one line. Do not continue working on the goal unless the user asks.
