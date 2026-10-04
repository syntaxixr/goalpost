# Examples

- [`SPEC.small-goal.md`](SPEC.small-goal.md) and [`AUDIT.small-goal.md`](AUDIT.small-goal.md): the
  `.goal/SPEC.md` and `.goal/AUDIT.md` that goalpost produced in a real headless run of
  `/goal src/slug.js exports slugify(str) … tests pass with node --test test/`.
  The agent wrote the assumptions and criteria itself, found that `node --test test/` fails on Node 24
  (a directory argument is treated as a module path), fixed that, re-ran every check and then passed the audit.
- [`goalpost.json`](goalpost.json): every setting with its default. Copy it to `~/.claude/goalpost.json`
  (all projects) or `<project>/.claude/goalpost.json` (one project) and delete what you don't change.

## A goal that works well

```text
/goal All legacyAuth() call sites use auth.verify(): `rg "legacyAuth\(" -t ts` prints nothing AND
`npm test` exits 0, without weakening any test. If blocked, stop and report the blocker.
```

goalpost doesn't need the condition to be perfect: it makes the agent turn it into criteria. A condition
that names the checks (as above) just saves a step. Pointing at a file works too:

```text
/goal Build what TASK.md describes. Everything in it must work.
```

The agent then has to map every requirement in `TASK.md` to a criterion, and the auditor checks that
none was skipped.

## Useful per-project settings

```json
{
  "testGlobs": ["**/*.test.*", "e2e/**"],
  "protectedPaths": ["scripts/grade.sh", "fixtures/**"],
  "maxMinutes": 90,
  "requireAudit": true
}
```

## Switching it off

```text
/goalpost:off            # for everything
GOALPOST=off claude      # for one run
/goalpost:release        # stop enforcing the current goal only
```
