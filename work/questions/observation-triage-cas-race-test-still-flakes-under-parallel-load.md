<!-- agent-runner-sidecar: item=observation:triage-cas-race-test-still-flakes-under-parallel-load type=observation slug=triage-cas-race-test-still-flakes-under-parallel-load allAnswered=false -->

## Q1

**How should this observation be dispositioned: promote it to a task that deterministically fixes the residual flake of the same-slug promote CAS-race test in `test/advance-triage.test.ts` (option (a) — serialise the test, mirroring the sibling `serialise-review-gate-test-under-parallel-load` precedent; or option (b) — further tighten the injected-contention model so the loser's CAS lease is provably stale before its push), keep it open for more evidence, or drop it?**

> Source: `work/notes/observations/triage-cas-race-test-still-flakes-under-parallel-load.md`.
>
> Observation reports the test `advance — answered triage dispositions flow through the apply path > a same-slug new-item race ⇒ exactly one promote creates, the loser fails CAS` FAILED with `expected [...] to have a length of 1 but got 2` under full-suite parallel load, while passing 11/11 in isolation and green on two consecutive full-suite re-runs. The product CAS (`applyTransition --force-with-lease`, per-attempt nonce — see `work/tasks/done/cas-create-nonce-authoritative-same-identity.md`) is structurally sound; the flake is in the TEST's contention model.
>
> Reality check vs current tree:
> - PR #90 / `work/tasks/done/triage-cas-race-test-models-real-contention.md` already attempted option (b) (tighten the injected-contention model) and the flake SURVIVED full parallel load — so option (b) has a failed precedent on this exact test.
> - The sibling slice `serialise-review-gate-test-under-parallel-load` is a clean template for option (a) on a structurally identical 'green logic, racy under load' test.
> - The observation already carries an in-body `## Applied answers 2026-06-22` block answering q1 as `promote-slice, option (a)` — but it still sits in `work/notes/observations/` (no promoted task exists yet, and `needsAnswers: false`). The known observation `answered-observation-body-block-is-invisible-to-promote-path-needs-sidecar` documents exactly this gap: an in-body applied answer is not picked up by the promote path, so the disposition needs to land in a sidecar to actually advance. This surface is the engine's chance to put that disposition where the promote path can see it.
> - A flaky acceptance-gate test erodes Gate-1 trust, which is a recurring theme in the repo's other 'serialise under parallel load' slices — argues for fixing deterministically rather than keeping/deferring.

_Suggested default: promote-task, option (a) — serialise this specific test (e.g. `describe.sequential` or run outside the parallel pool), mirroring the `serialise-review-gate-test-under-parallel-load` precedent. Rationale: option (b) was already tried in PR #90 and the flake survived; option (a) has a working precedent on a structurally identical case; product CAS is sound so this is a test-only concern. This carries over the in-body Applied-answer verbatim so the engine sees it via the sidecar._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):
