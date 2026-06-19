---
title: review-gate non-blocking nits for 'install-ci-build-slice-tick-workflow' (Gate 2 approve)
date: 2026-06-15
status: open
reviewOf: install-ci-build-slice-tick-workflow
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'install-ci-build-slice-tick-workflow' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify the inherited tunable defaults baked into the emitted workflow: hourly cron (`0 * * * *`), merge-mode batch size `advance -n 10`, and `--arbiter origin`. Are these the right out-of-the-box values for the build/slice tick, or should any be surfaced as config rather than hard-coded?
  (All three are carried verbatim from the advance-loop seed (docs/ci/advance-loop.yml.template lines 58/179/161), so they are not novel inventions, but the slice spec did not call them out and they are user-visible defaults a repo owner inherits. They are easy to change (edit the emitted file / re-run install-ci), so this is a ratify-or-tune call, not a defect.)
- Ratify the choice to make `generateBuildSliceTickWorkflow(config)` config-independent (the `config` param is accepted for the CapabilityEmitter seam but unused, prefixed `_config`). Is a fully fixed shell correct, or is there per-config wiring (e.g. arbiter name, cron cadence) that should flow from the resolved config now rather than later?
  (The module doc justifies this via ADR §6 (all policy is env/config at runtime, so the artifact carries no config-derived policy) and the param exists for parity/future use. This is a reasonable, reversible design choice but it is an in-scope decision the slice did not specify and there is no Decisions block recording it.)
- Add a `## Decisions` block to the PR description for the in-scope choices above (fixed config-independent shell; inherited cron/-n/arbiter defaults). No such block exists (the commit body is empty).
  (Per the review protocol, non-obvious in-scope decisions should be recorded for human ratification. None of these is load-bearing-or-hard-to-reverse, so this does not block; it is a hygiene/traceability note so the next reader sees the choices were deliberate.)
- Pre-existing doc typo (NOT introduced by this slice, flagged only because this slice newly relies on the env-var contract): config.ts:86 documents `autoBuild` as resolving from `AGENT_RUNNER_AUTO_SLICE` (copy-paste; should be `AGENT_RUNNER_AUTO_BUILD`). Worth a follow-up fix so the documented precedence chain matches env-config.ts.
  (env-config.ts is correct (autoBuild => AGENT_RUNNER_AUTO_BUILD via the mechanical SCREAMING_SNAKE rule), and this workflow emits the correct var, so behaviour is fine. The stale comment predates this commit (config.ts last touched 2026-06-14). Out of scope for this review; noted to avoid confusing a future reader cross-referencing the two files.)
