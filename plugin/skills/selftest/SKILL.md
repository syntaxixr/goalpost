---
name: selftest
description: Prove goalpost enforces on this machine — runs the real hooks on a throwaway goal whose check fails first, and shows each block.
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/gp.js" selftest`

Show the output above to the user as is.
