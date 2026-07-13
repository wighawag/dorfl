# Observation: `prd-to-spec.test.ts` has a duplicate local `gitEnv()` that missed the `4fb7d87d` gc-auto-off fix

Date: 2026-07-13
Seen while executing task
`harden-run-test-claimed-done-flaky-under-full-suite`.

## What I saw

Running `pnpm -r build && pnpm -r test` 3× consecutively to check whether the
`run.test.ts` `claimed-done` flake still bites (it doesn't — 3/3 green for
THAT assertion, discharged by `4fb7d87d`), the SECOND run failed on a
different file with the SAME class of race:

```
FAIL  |parallel| test/prd-to-spec.test.ts > scanForLeaks — the acceptance GATE
      over the converted tree > is NON-VACUOUS: it FLAGS an un-migrated tree
      (forward lens)
Error: ENOTEMPTY: directory not empty,
       rmdir '/tmp/prd-to-spec-test-TMIemg/fixture-7Q0xsn/.git/objects'
```

## Root

`packages/dorfl/test/prd-to-spec.test.ts` line 47 defines its OWN local
`gitEnv()` (predating the shared helper's fix). It sets the identity +
`GIT_CONFIG_GLOBAL=/dev/null` + `GIT_CONFIG_SYSTEM=/dev/null` +
`GIT_CONFIG_NOSYSTEM=1`, but does NOT thread the
`GIT_CONFIG_COUNT` / `gc.auto=0` / `maintenance.auto=false` /
`gc.autoDetach=false` bundle that `4fb7d87d` added to the SHARED
`packages/dorfl/test/helpers/gitRepo.ts` `gitEnv()`. So background
`git gc --auto` / maintenance repack still races the recursive `rmdir` of
`.git/objects` in this test's fixtures under full-suite parallelism.

Same root cause as `4fb7d87d`, just a duplicate site that was not covered.
Likely one-line-ish fix: either delete the local copy and import `gitEnv` from
`./helpers/gitRepo.js` (same pattern as `run.test.ts`), or mirror the
`GIT_CONFIG_COUNT/KEY/VALUE` triple into the local `gitEnv` here.

Not in scope for the current task (that task is explicitly the `run.test.ts`
`claimed-done` line and the task explicitly says "do NOT expand scope; drop a
note").
