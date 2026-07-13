---
title: A healthy `agent-stopped` refusal (task drifted / stale premise / empty diff) exits 1 and reds the CI matrix identically to a real gate failure, so the autonomous loop is hard to read at a glance
type: observation
status: superseded
spotted: 2026-07-12
needsAnswers: false
---

## SUPERSEDED 2026-07-12 — folded into a spec

The A/B/C decision below is SUBSUMED by the proposed spec `work/specs/proposed/surface-stuck-as-questions-and-retire-stuck-lock-state.md`. That spec's deeper fix (a bounce/`agent-stopped` SURFACES a question sidecar on `main` and RELEASES the lock, retiring the `stuck` state) turns a healthy refusal from a raw exit-1 red into a legible surfaced-question state, which dissolves this legibility problem at the root rather than papering it with a summary. The raw A-vs-B-vs-C exit-code question survives only as open question #1 in that spec (re-asked in the new frame: is a cleanly-surfaced bounced leg a benign exit-0, or does it stay non-zero so the run flags "a human owes an answer"). Do NOT decide A/B/C standalone; decide it inside the spec. Kept below for the record.

## What was seen

On lifecycle run `29206312575`, 3 of the 9 failed `advance-propose` legs were NOT bugs, they were the engine working as designed, DELIBERATELY refusing to fabricate a change:

- `exempt-work-questions-sidecars-from-prd-word-leak-scan`: premise stale (fix already landed in `970ceb`); agent stopped and suggested moving the task to `done`.
- `provenance-file-basenames-widened-criterion-and-expiry-guard`: the observation it was told to edit was already discharged-by-deletion; agent surfaced a real convention collision instead of guessing.
- `sweep-prose-prd-colon-from-live-maintained-docs-2026-07-12`: empty diff vs main (nothing to sweep).

All three exited via the `agent-stopped` outcome (`saveAgentStop` in `src/do.ts`), which is EXPLICITLY the "deliberate, benign, work preserved, surfaced to needs-attention, gate + Gate-2 NEVER run" path (see the doc comment at `do.ts` ~L1571 and the union member at `do.ts:131`). Yet `agent-stopped` returns `exitCode: 1` (`do.ts` ~L1608), so the GitHub Actions matrix leg goes RED, visually identical to the legs that failed on a genuine red acceptance gate (`tests-failed` / `acceptance gate failed (exit 1)`).

## Why it matters (legibility of the autonomous loop)

For someone adopting dorfl in another project, the Actions run for a lifecycle tick is the primary window into "what did the robots do?". Today that window shows a wall of red X's that CONFLATES three very different things:

1. Real failures needing a fix (e.g. the `tests-failed` gate reds).
2. Healthy refusals needing a human ROUTING decision (`agent-stopped`: re-scope, move to done, answer a surfaced question).
3. Genuinely-nothing-to-do benign skips (already `exitCode: 0`: `vanished`, `already-triaged`, `no-op`).

Classes 1 and 2 both show as red exit-1, so you cannot tell "the build broke" from "the agent correctly declined a stale task" without opening each job's log. That erodes trust in the loop and buries the real failures among the healthy ones. On this run, 6 of 9 reds were false-or-healthy; only the flaky-teardown reds were arguably actionable-as-a-bug, and even those were infra, not the work.

## The existing design already has the vocabulary — this is one gap in it

`advance.ts` already deliberately makes several BENIGN outcomes `exitCode: 0` precisely "so the matrix tolerates it / does NOT red CI" while keeping them DISTINGUISHABLE by outcome name for grep: `vanished` (item file moved/triaged by a sibling leg), `already-triaged` (idempotent re-mint), `no-op` (calm classify). The reasoning in those doc comments ("turn the matrix into a wall of red" is explicitly called out as the thing to avoid) applies WORD-FOR-WORD to `agent-stopped`. So the question is narrow: should `agent-stopped` join that green-but-distinct class, or is its red DELIBERATE because it routed the item to needs-attention and a human really must act?

## The decision (NEEDS A HUMAN — do not flip unilaterally)

`agent-stopped`'s `exitCode: 1` is PINNED by tests (`test/do.test.ts:1051`, `:1084`, `test/do-remote.test.ts:253` all `expect(result.exitCode).toBe(1)`) and has a coherent rationale (it routes to needs-attention, so "red so a human looks" is defensible). Changing it is a real behaviour change, not a typo fix. Options:

- **A. Make `agent-stopped` `exitCode: 0`** (join `vanished`/`already-triaged`). Pro: the matrix only reds on REAL failures; healthy refusals go green-but-named. Con: a stopped item silently needs a human routing decision, and a green leg may get less attention; you'd rely on the needs-attention surfacing + a summary to not drop it. Requires updating the 3 pinned tests + the union doc.
- **B. Keep `exitCode: 1` but make it VISUALLY distinct.** Emit a per-leg `GITHUB_STEP_SUMMARY` line (there is NO summary writer today, grep found none) and/or a `::warning::` (not `::error::`) annotation classifying the outcome (`refused/surfaced` vs `gate-failed`), so the run summary separates the two even though both are non-zero. Pro: preserves the "a human must route this" red while making the run readable. Con: red is still red in the top-level checks list; the distinction lives in the summary/annotations.
- **C. A THIRD exit code** (e.g. reserve one for "healthy stop") mapped in the workflow to a neutral/skipped-looking leg. Most work; cleanest signal.

Recommendation to weigh: **B** is the least-invasive and most honest for an adopter (keep the "needs routing" signal, add a run summary that buckets outcomes into failed / refused-surfaced / benign-skip). **A** is cleaner if you decide a surfaced needs-attention item is ENOUGH of a signal on its own and the matrix should be reserved for real breakage. Either way, a per-tick `GITHUB_STEP_SUMMARY` that tallies outcomes by class is the high-value adopter-facing artifact and is additive (no semantics change) — it could ship first regardless of A-vs-B.

## Scope note

This is dorfl-engine + host-workflow legibility, NOT a protocol change (nothing under `skills/setup/protocol/` or `work/protocol/`). The exit-code flip (A) touches `src/do.ts` + `src/advance.ts` + 3 tests + union docs; the summary/annotation (B) touches `.github/workflows/advance-lifecycle.yml` (+ optionally a small summary emitter in the CLI). Deferred to a human decision because it changes what "red" MEANS on the autonomous loop, which is a policy call an adopter should make consciously.

## Refs

- Run `29206312575`. Healthy `agent-stopped` legs: 86686290513, 86686290522, 86686290541.
- `src/do.ts:131` (`agent-stopped` union member), `src/do.ts` ~L1571-1610 (`saveAgentStop`, `exitCode: 1`).
- `src/advance.ts` ~L123-160 (the `vanished`/`already-triaged` doc comments establishing the "exitCode 0 so the matrix tolerates it, does NOT red CI, but stays grep-distinguishable" precedent).
- Pinned tests: `test/do.test.ts:1051`, `test/do.test.ts:1084`, `test/do-remote.test.ts:253`.
- No `GITHUB_STEP_SUMMARY`/annotation writer exists today (grep of `src/` for `STEP_SUMMARY`/`::notice`/`::warning` is empty), so option B is greenfield.
