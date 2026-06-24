---
title: Observation triage re-fires every tick when a task for the observation already exists — it loses the create CAS, never marks the observation resolved
type: observation
status: spotted
spotted: 2026-06-22
needsAnswers: true
---

## What was seen

On a CI `advance-lifecycle` run (propose mode), the triage leg for an observation
failed with exit code 2:

```
dorfl advance "obs:integratelock-is-in-process-only-cross-ci-job-merge-relies-on-cas-retry-cap-2026-06-21" --propose --watch --arbiter origin
>> 'work/tasks/todo/integratelock-...-2026-06-21.md' already exists on origin/main — the new item lost the create race (or the slug is taken). Back off.
>> promote observation:integratelock-...: the new item ... lost the create CAS (...) — backing off, the observation is left unresolved for a retry.
Error: Process completed with exit code 2.
```

Investigation (this repo, 2026-06-22):

- The triage rung (`observationTriage: auto` in `.dorfl.json`) promotes an
  untriaged observation into a new task, guarded by a create CAS (the new
  `work/tasks/todo/<slug>.md` must not already exist on `<arbiter>/main`).
- A task for this observation ALREADY EXISTS on `origin/main`:
  `work/tasks/todo/integratelock-is-in-process-only-cross-ci-job-merge-relies-on-cas-retry-cap-2026-06-21.md`
  (and a matching `work/questions/task-integratelock-...md` sidecar). So the
  observation was already triaged in a previous run.
- But the observation is STILL enumerated into the triage pool (it is still an
  untriaged observation as far as the lifecycle gather is concerned), so EVERY tick
  re-runs `promote obs:<slug>`, re-loses the create CAS, and exits 2. The promote
  code's own message says it "is left unresolved for a retry" — but the retry can
  never succeed, because the task it would create already exists.

## Why it matters

This is an IDEMPOTENCY gap: a successful prior triage leaves no marker that stops
the observation being re-triaged, so it reds CI on every tick FOREVER (until a
human deletes/edits the observation). The "back off ... left unresolved for a
retry" message is misleading: the situation is terminal-by-existence, not a
transient race that a retry resolves. Same red-CI-noise cost as the held-lock and
stale-snapshot observations — it trains the operator to ignore red.

## The idea (NOT decided here)

At the triage create-CAS step, distinguish "lost a genuine concurrent create race"
(transient — retry is right) from "a task for THIS observation already exists"
(terminal — the observation is already triaged, stop re-firing):

- If the target task slug already exists ANYWHERE terminal/non-terminal on `main`
  (`tasks/todo|backlog|done|cancelled/`) AND it is provably the task minted FROM
  this observation (slug derivation / a back-reference), treat the observation as
  ALREADY-TRIAGED: skip it (exit 0 / tolerated code), do NOT red CI, and ideally
  record the resolution so it leaves the triage pool on the next gather (e.g. an
  observation `triaged:` marker, or the gather excluding observations whose minted
  task already exists).
- Keep the LOUD failure only for a true concurrent-create race (two ticks racing to
  mint the same new task at once) where a retry actually helps.

To weigh: how the triage pool decides "already triaged" (a marker written into the
observation frontmatter — see the existing `triaged: keep` convention in
`build-slice-advance-may-waste-a-build-before-losing-at-inner-claim-2026-06-19.md` —
vs deriving it from the minted task's existence); whether the observation should be
auto-marked or left for a human; and the exit-code/skip semantics (consistent with
the sibling already-done / held-lock observations, which also want a benign skip
rather than exit 2).

## Provenance / refs

- `.github/workflows/advance-lifecycle.yml` (the `enumerate` job's
  `lifecycle.triage[]` → `obs:<slug>` legs; `advance "obs:<slug>" --propose`).
- `src/advancing-lock.ts:527` (the create-CAS "already exists on <arbiter>/main —
  the new item lost the create race (or the slug is taken). Back off." message).
- The promote/triage path that maps a lost create CAS to "left unresolved for a
  retry" (the `promote observation:<slug>` reporting in the run log).
- The lifecycle gather that enumerates untriaged observations:
  `src/lifecycle-gather.ts` (`gatherLifecycleInPlace`) → `src/lifecycle-pools.ts`
  (`buildLifecyclePools`, the triage sub-pool).
- The already-existing task + sidecar proving prior triage:
  `work/tasks/todo/integratelock-is-in-process-only-cross-ci-job-merge-relies-on-cas-retry-cap-2026-06-21.md`,
  `work/questions/task-integratelock-...-2026-06-21.md`.
- Sibling CI-noise observations:
  `work/notes/observations/advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md`,
  `work/notes/observations/advance-matrix-enumerates-held-locked-items-so-legs-fail-every-tick-2026-06-22.md`.

## Note on scope

Idempotency / CI-noise defect (a re-fired triage that can never succeed), not a
correctness bug (no double-mint: the CAS correctly refuses the duplicate). A human
decides whether to slice a task and how "already triaged" is detected + recorded.
