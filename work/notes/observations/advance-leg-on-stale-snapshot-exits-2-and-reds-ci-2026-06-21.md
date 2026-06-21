---
title: A stale-snapshot `advance` leg (item already done/removed) exits 2 and REDS CI — a benign lost race shown as a failure; also conflated with a genuine wrong-slug
type: observation
status: spotted
spotted: 2026-06-21
needsAnswers: true
---

## What was seen

A CI `advance-lifecycle` run (push-triggered) had a matrix leg run:

```
agent-runner advance "task:work-layout-guard-catch-absolute-prefix-path-literals" --propose --watch --arbiter origin
```

and FAILED with exit code 2:

```
>> 'work/tasks/todo/work-layout-guard-catch-absolute-prefix-path-literals.md' not
   found on origin/main (already done/removed, or wrong slug).
error: ... not found on origin/main (already done/removed, or wrong slug).
Error: Process completed with exit code 2.
```

Investigation (this repo, 2026-06-21):

- The task is DONE: it rests at
  `work/tasks/done/work-layout-guard-catch-absolute-prefix-path-literals.md` on
  `origin/main`, integrated in commit `598d5da` (PR #185) at 06:28:43.
- The CI workflow (`.github/workflows/advance-lifecycle.yml`) is a DYNAMIC MATRIX:
  an `enumerate` job runs `agent-runner scan --json | jq '... select(.eligibility
  .eligible == true) | "task:" + .slug ...'` to snapshot eligible ids, then fans
  out one `advance "task:<slug>" --propose` leg per id (line ~274).
- TIMELINE = the enumerate-then-fan-out RACE: `enumerate` snapshotted `main` while
  the task was still in `tasks/todo/` (eligible) → emitted a `task:<slug>` leg →
  meanwhile #185 merged the `todo/ → done/` move → by the time the leg ran, the
  task was gone from the pool on `origin/main` → the leg's pre-claim pool check
  failed → exit 2.

This is EXACTLY the case ADR `ci-config-policy-and-gate-family` §7 anticipates:
"a matrix is safe but occasionally WASTES a runner on a lost race, never a
correctness risk." Nothing was double-built or corrupted. The ONLY symptom is a RED
CI job for a KNOWN-BENIGN outcome.

## The two distinct defects

1. **Benign lost-race paints CI red.** The "item already gone from the pool"
   outcome is, per the ADR, EXPECTED and harmless (the snapshot staled between
   enumerate and fan-out). Exiting non-zero (2) makes a normal, designed race show
   up as a FAILED GitHub Action — noise that trains the operator to ignore red,
   and can fail the whole workflow run. A leg that finds its item already
   advanced should arguably exit 0 with a clear SKIP message ("already
   done/removed — nothing to advance"), not 2.

2. **"already done/removed" and "wrong slug" are CONFLATED** — same message, same
   exit. The message + exit are produced at `src/claim-cas.ts:270` and `:332`
   (dry-run + real claim paths), BOTH returning `{exitCode: 2, outcome: 'lost'}`
   with the literal string `'<backlog>' not found on <arbiter>/main (already
   done/removed, or wrong slug).` `do.ts` maps `outcome: 'lost'` → exit 2
   (`do.ts` ~L553). So a STALE RACE (item legitimately moved to `done/` — benign)
   and a real USER ERROR (typo'd a slug that never existed — should stay loud) are
   INDISTINGUISHABLE in both the message and the exit code. A check of whether the
   slug exists ANYWHERE on `main` (`tasks/done/`, `tasks/cancelled/`, …) would
   separate "already terminal" (benign) from "no such slug" (genuine error).

## Why it matters

CI is meant to surface REAL failures; a benign, by-design race rendered as a red
job erodes that signal. And the conflated message means an operator who DID typo a
slug gets the same output as a harmless race, so neither case is diagnosed well.
Both are small, well-scoped, and improve the autonomous CI experience the
`runner-in-ci` PRD is building.

## The idea (NOT decided here)

Distinguish, at the claim-cas pool-check, three outcomes instead of one:

- slug resides in a TERMINAL folder (`tasks/done/`, `tasks/cancelled/`; brief
  `tasked/`/`dropped/`) ⇒ "already <terminal> — nothing to advance" ⇒ exit 0
  (benign skip), so a stale-snapshot matrix leg does NOT red CI;
- slug resides in STAGING (`tasks/backlog/`) but not the pool ⇒ a distinct
  "exists but not claimable (staged; promote it first)" message;
- slug found NOWHERE on `main` ⇒ keep the LOUD "no such slug" error (exit 2) — a
  genuine user error stays a failure.

To weigh: which exit code the matrix LEG should carry so the workflow run is green
on a pure benign-race (exit 0 leg vs a leg that records a skip but the job stays
green); whether `--propose` callers and interactive callers want the same mapping
(an interactive human typing a slug wants the loud error; a CI leg wants the quiet
skip — possibly a `--quiet-if-gone`/exit-mapping flag the workflow sets, rather
than changing the default for everyone). This is the real design residue and the
reason this is captured for a human, not fixed inline.

## Provenance / refs

- `.github/workflows/advance-lifecycle.yml` (`enumerate` job ~L174–223, the
  `scan --json | jq` snapshot; the `advance-propose` matrix leg ~L274).
- `src/claim-cas.ts:270` + `:332` (the message + `{exitCode: 2, outcome:'lost'}`);
  `src/do.ts` ~L553 (`outcome:'lost'` → exit 2 mapping).
- ADR `docs/adr/ci-config-policy-and-gate-family.md` §7 ("the claim CAS, not the
  matrix, is the safety mechanism"; "wastes a runner on a lost race, never a
  correctness risk").
- The completed task: `work/tasks/done/work-layout-guard-catch-absolute-prefix-path-literals.md`
  (#185, `598d5da`).
- Related conflation flagged earlier this session in the diagnosis of the same run.

## Note on scope

CI-noise + diagnosability signal, not a correctness bug (the race is benign by
design; the repo + the done task are fine). A human decides whether to slice a task
and what the exit-code semantics should be (especially CI-leg vs interactive).
