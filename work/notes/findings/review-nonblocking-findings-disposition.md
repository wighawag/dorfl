---
title: 'the review gate discards non-blocking findings on approve — give them a home (verbatim PR comment + one observation file per run)'
date: 2026-06-06
status: open
---

## The gap (verified in the code)

On a BLOCK, the runner routes the review's findings to `needs-attention/` (`complete.ts` → `formatBlockReason`, which filters to blocking findings). On an APPROVE, the runner just `note("Gate 2 approved")` and integrates — the parsed `findings[]` (including any **non-blocking** nits the reviewer raised) are **dropped on the floor**. They survive only in the terminal scroll + the session `.jsonl` (which nobody reads after the fact). So the gate does real adversarial work (PR #14: it found 2 legit maintainability nits the human reviewer missed) and the output evaporates.

Asymmetry: blocking findings have a contract-native home (`needs-attention/`); non-blocking findings have NO home on the approve path.

## The constraint (why it is built this way)

The **review agent must not write** (same as the build agent does no git — the review skill's contract is "emit a verdict; the caller routes it"). So the fix is NOT "make the reviewer write." But the **RUNNER** (deterministic code in `complete.ts`) already HAS the findings in hand after the gate returns — it is the writer, and it already writes the block case. The fix is: the runner routes the non-blocking findings too.

## Resolution (2026-06-06) — TWO sinks, both runner-written, complementary

1. **PR comment = the agent's VERBATIM review** (slice `review-gate-pr-comment`, reshaped). Instead of re-formatting the parsed verdict, post the review agent's FULL output text (`LaunchResult.output`, minus the trailing `{verdict,findings}` JSON block) as the PR comment. This AUTOMATICALLY includes the nits AND the reasoning / destination-check narrative — richer than a re-formatter, and less code. Propose-path only (no PR on `--merge`). The runner still PARSES the verdict for its routing decision; the verbatim text is only for the comment.

2. **One observation file PER RUN** (slice `review-nits-observation`, new). On an approve WITH non-blocking findings, the runner writes ONE `work/observations/review-nits-<slug>-<date>.md` containing that run's non-blocking findings. Works on ALL paths (merge / propose / CI) — this is the `--merge` coverage the PR comment cannot give (no PR on merge). The runner writes it (reviewer stays write-free).

These are complementary: the comment is visibility AT REVIEW TIME (propose); the observation is durable, contract-native, `--merge`-covered, and flows into batch-qa triage (promote / keep / delete) like any other observation.

## Design decisions baked in

- **One file PER RUN, not per nit** (no file explosion) and **NOT one shared append-only ledger** (a shared mutable file violates the contract's one-file-per-item / no-shared-index rule and races on parallel `--merge`/CI runs). Per-run files have content-derived slugs and never collide.
- **Date in the filename** (`-<date>`): so if the PR is later CLOSED/abandoned, the matching observation is easy to find and delete — you do not have to remember a stray observation was recorded. (Lifecycle hygiene: a recorded-then-abandoned review should not leave orphan nits.)
- **No empty observations:** an approve with ZERO non-blocking findings writes NOTHING (no empty-file spam). A BLOCK still goes to `needs-attention/` (unchanged) — the observation is specifically for the approve-with-non-blocking-findings case that currently evaporates.
- **Two slices, not one:** they route to different sinks, have different path-coverage (propose-only vs all), and are independently testable.

## Slices

- `review-gate-pr-comment` (reshaped) — verbatim review as the PR comment.
- `review-nits-observation` (new) — one per-run observation of non-blocking findings, all paths.

(Captured 2026-06-06 after the PR #14 review gate raised 2 non-blocking nits with no home; maintainer steered the per-run observation + verbatim-comment shape.)
