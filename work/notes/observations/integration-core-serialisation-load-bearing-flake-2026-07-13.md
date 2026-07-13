---
needsAnswers: true
---

# integration-core "serialisation is load-bearing" test intermittently flakes

Date: 2026-07-13

While running the full `pnpm --filter dorfl test` during the
`skills-add-cli-command` task, `test/integration-core.test.ts` line ~746 failed:

> `expected 2 to be less than 2`
> "WITHOUT the lock AND WITHOUT the retry, two same-base concurrent merges do
> NOT both cleanly land (serialisation is load-bearing)"

The test tries to *demonstrate* the race by disabling serialisation and
asserting `landed.length < 2`, but on this CI runner both concurrent merges
happened to land — i.e. the race did not fire in this scheduling. It is a
negative/observational assertion on a genuine race, so it is inherently
scheduling-sensitive. Re-running in isolation passes.

Out of scope for this task (no code change on the integration path here).
