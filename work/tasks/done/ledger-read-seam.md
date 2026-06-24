---
title: Ledger read seam — unify the work/ state readers behind one resolve-state entry
slug: ledger-read-seam
prd: ledger-transition-seam
blockedBy: []
covers: [5, 6, 7, 8, 9]
---

## What to build

The **read half** of the seam: one "resolve the live `work/` state for a repo" entry point that the existing readers go through, with a single (current-behaviour) strategy. Today there are TWO real read sources and the seam must honestly cover both (decided — do not collapse them into one fake source):

- **local working tree** — `scan.ts` reads `work/backlog|done|needs-attention` via `readdirSync`/`readFileSync` on the local checkout (offline, cross-repo).
- **arbiter `main`** — `readiness.ts` (the human claim guard) and the claim CAS read the slice + `work/done/` from `<arbiter>/main` via `git show`/`ls-tree`.

The read seam is ONE interface with **two resolve-methods** ("resolve from local tree" vs "resolve from arbiter") — not pretending the two sources are the same, but giving a future strategy a SINGLE insertion point. Route `scan.ts`, `readiness.ts`, and `gc.ts`'s `work/`-state reads through it; `eligibility.ts` stays the pure resolver it already is (callers feed it the seam's resolved `doneSlugs` — its signature need not change).

ONE strategy = current behaviour: local reads still hit the working tree, arbiter reads still hit `<arbiter>/main`. `scan` STAYS OFFLINE. `blockedBy`/eligibility/ readiness semantics UNCHANGED. **No mode, no config, no `ledgerMode`, no network read added.** Independent of the write seam (disjoint files) → startable now, in parallel with `ledger-write-seam`.

## Acceptance criteria

- [ ] A read-seam entry ("resolve live `work/` state") exists with TWO resolve- methods (local-tree, arbiter) backed by ONE strategy = current behaviour.
- [ ] `scan.ts` resolves backlog/done (+ needs-attention surface) THROUGH the seam's local-tree method; it stays OFFLINE (no network).
- [ ] `readiness.ts` (and the claim CAS's readiness use) resolves the slice + `work/done/` THROUGH the seam's arbiter method.
- [ ] `gc.ts`'s `work/`-state reads go through the seam where applicable.
- [ ] `blockedBy`/eligibility/readiness verdicts are byte-identical; the pure `eligibility.ts` resolver is unchanged (fed by the seam's resolved data).
- [ ] The seam signature is storage-agnostic; no `main`/path baked into its public shape beyond the local-vs-arbiter method distinction.
- [ ] No `ledgerMode`/mode/config; no new network read. Existing scan/readiness/gc tests pass UNCHANGED; a seam-level test asserts reads route through the seam.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None — can start immediately (parallel with `ledger-write-seam`; the read seam touches `scan.ts`/`readiness.ts`/`gc.ts`, disjoint from the write-seam files `claim-cas.ts`/`complete.ts`/`integrator.ts`/`needs-attention.ts`).

## Prompt

> Introduce the **read half** of the ledger-transition seam in `dorfl`: one "resolve the live `work/` state for a repo" entry that the existing readers go through. PURE REFACTOR — behaviour byte-identical; you are unifying read call sites behind one seam, not changing what they read.
>
> READ FIRST: `docs/adr/claim-ledger-vs-protected-main.md` (status: accepted — "Read seam"), then the two real read sources: `src/scan.ts` (`readBacklogItems`, `readDoneSlugs`, `readNeedsAttentionItems` — LOCAL working tree, offline, cross- repo) and `src/readiness.ts` (`readSliceOnArbiter`, `readDoneSlugsOnArbiter` — from `<arbiter>/main` via `git show`/`ls-tree`). Also `src/eligibility.ts` (pure resolver — leave its signature alone) and `src/gc.ts` (its `work/`-state reads).
>
> Build ONE read-seam interface with TWO resolve-methods — "resolve from local tree" and "resolve from arbiter" — backed by ONE strategy = exactly today's behaviour. Route `scan`, `readiness` (and the claim CAS's readiness call), and `gc` through it. `scan` MUST STAY OFFLINE (no network). Keep `eligibility.ts` the pure function it is — feed it the seam's resolved `doneSlugs`. Do NOT add a network read, a new ref, or any `ledgerMode`/mode/config. The seam signature is storage-agnostic (only the local-vs-arbiter method distinction is public).
>
> TDD with vitest; existing scan/readiness/gc tests pass UNEDITED (bar mechanical call-site moves). Add a seam-level test that the readers resolve through the seam. "Done" = acceptance criteria met and the gate is green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim ledger-read-seam --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/ledger-read-seam <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/ledger-read-seam.md work/done/ledger-read-seam.md
```
