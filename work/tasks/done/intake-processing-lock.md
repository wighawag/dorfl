---
title: intake processing LOCK — a provider-native GitHub label as a transient concurrency mutex (acquire/release; best-effort degrade)
slug: intake-processing-lock
prd: issue-intake
blockedBy: [intake-tracer-slice-outcome]
covers: [10]
---

## What to build

Serialise two concurrent `intake` runs on the SAME issue with a **provider-native `processing` LOCK label** (e.g. `dorfl:processing`): added on start (winner only), removed on finish. This extends the issue seam with label ops and acquires/ releases around the existing `intake` run.

Critical framing (the PRD is emphatic — do not drift):

- This is a transient CONCURRENCY MUTEX carrying NO `work/` state. It is **NOT** a `work/`-file CAS (the contended thing is the ISSUE — a system with its own arbiter — and the output slug is unknown pre-run). It is **NOT** a whitesmith-style label STATE-MACHINE; ADR §12 forbids modelling `work/` lifecycle in labels. ONE transient lock label, that is all.
- A non-label provider DEGRADES to best-effort (no lock; CI's per-issue concurrency group is then the only serialiser — that group is `runner-in-ci`'s, out of scope here).

End-to-end behaviour after this slice:

- `intake <N>` acquires the lock label at the START of a run (the winner proceeds); a SECOND run while the label is present BACKS OFF (does nothing).
- The label is REMOVED on finish (success or handled failure) so the next run can proceed.
- A provider without label support degrades to best-effort (the run proceeds without the lock; surfaced honestly).

Extends the issue seam with `addLabel` / `removeLabel` / `getLabels`, implemented in the GitHub adapter (core never imports `gh`). The agent does NO label ops — the RUNNER acquires/releases (the in-band boundary).

## Acceptance criteria

- [ ] The issue seam gains `addLabel` / `removeLabel` / `getLabels`; the GitHub adapter is the only place that shells out to `gh` for them; the core never imports `gh`.
- [ ] `intake <N>` adds the `processing` label on START and removes it on FINISH (assert via the stubbed seam: label present during the run, absent after).
- [ ] A second run while the label is PRESENT backs off (does nothing — no emit, no duplicate processing).
- [ ] A non-label provider DEGRADES to best-effort: the run proceeds without the lock and the degrade is surfaced honestly (no crash).
- [ ] The runner (not the agent) performs the label ops; the agent stays label-free.
- [ ] It is NOT a `work/` CAS and NOT a label state-machine — only the single transient lock label is touched (no lifecycle state in labels; ADR §12).
- [ ] Tests STUB `gh` via the injectable `ghBin` (the `GitHubProvider`'s existing test seam; `DEFAULT_GH_BIN` from `index.ts`) — the same mechanism the PR-provider tests use; mirror the repo's existing style.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `intake-tracer-slice-outcome` — provides the issue seam + the `intake` run this lock wraps and the label ops extend. Independent of the dispatcher-breadth / mode / classification / query slices (it touches the seam + the run entry, not the dispatch branches), so it may run in PARALLEL with `intake-decision-prompt-and-four-outcome-dispatch`.

## Prompt

> Add `intake`'s PROCESSING LOCK: a provider-native `processing` label (e.g. `dorfl:processing`) as a TRANSIENT concurrency mutex — added on start (winner only), removed on finish — serialising two concurrent runs on the SAME issue (US #10).
>
> CRITICAL FRAMING (from `work/prd-sliced/issue-intake.md` — do NOT drift): this is a transient CONCURRENCY mutex carrying NO `work/` state. It is NOT a `work/`-file CAS (the contended thing is the ISSUE; the output slug is unknown pre-run). It is NOT a whitesmith-style label STATE-MACHINE — ADR §12 forbids modelling `work/` lifecycle in labels. ONE transient lock label, nothing more. A non-label provider DEGRADES to best-effort (CI's per-issue concurrency group — `runner-in-ci`'s, out of scope — is then the only serialiser).
>
> REUSE: whitesmith (`~/dev/github/wighawag/whitesmith`) is the reference for the label + per-issue-concurrency PATTERN — reuse the concurrency PATTERN, NOT its label state-machine.
>
> WHAT TO BUILD:
>
> 1. Extend the issue seam with `addLabel` / `removeLabel` / `getLabels`; implement in the GitHub adapter via `gh` (core never imports `gh`).
> 2. In the `intake` run: acquire (add) the lock label at START — winner proceeds; if already present, BACK OFF (do nothing). Release (remove) at FINISH (success or handled failure).
> 3. Degrade to best-effort on a non-label provider (proceed without the lock; surface honestly).
> 4. The RUNNER performs the label ops; the agent stays label-free.
>
> SEAM TO TEST AT: the stubbed issue seam. Assert: label present during the run / absent after; a second run with the label present backs off; non-label provider degrades (no crash). STUB `gh` via the injectable `ghBin` (the `GitHubProvider` test seam), as the PR-provider tests do.
>
> SCOPE FENCE: ONE transient lock label only — no lifecycle state in labels, no state-machine (ADR §12). Do NOT build CI's per-issue concurrency GROUP (that is `runner-in-ci`). Do NOT touch the dispatcher branches, the mode KNOBS, event-classification, or the "PRD complete?" query.
>
> FIRST run the drift check: confirm `intake-tracer-slice-outcome` landed the issue seam + the `intake` run entry this wraps. If the seam landed differently, extend it in place; if a premise is broken, route to `needs-attention/` with the discrepancy.
>
> "Done" = the lock label acquires-on-start / releases-on-finish, a second run backs off, a non-label provider degrades, the runner owns the label ops, no label state-machine, and `pnpm -r build && pnpm -r test && pnpm -r format:check` is green.
