---
title: Generic terminal dropped/ folder generalising out-of-scope/ (out of the pool by residence)
slug: generic-terminal-dropped-folder-generalising-out-of-scope
spec: staging-pool-position-gate-and-trust-model
blockedBy: []
covers: [16, 17, 18]
---

## What to build

A GENERIC terminal "won't-proceed" durable record: a `work/dropped/` folder that
GENERALISES today's `work/out-of-scope/`. An item (a slice OR a SPEC) that will not
proceed for ANY reason — superseded, out-of-scope, duplicate, abandoned/obsolete —
rests in `work/dropped/<slug>.md` with the REASON in the body (a `reason:` value
like `superseded by <x>` / `out-of-scope` / `duplicate` / `abandoned`), instead of
needing a folder-per-reason or a prose-only annotation the system ignores.

The maintainer decided the NAME is `dropped` (it pairs with `done/`: an item ends
in `done/` OR `dropped/`). This SUBSUMES today's `out-of-scope/`: fold
`out-of-scope/` in as one `reason:` value within `dropped/` (decide migration of
any existing `out-of-scope/` records — `work/out-of-scope/` is currently empty, so
the migration is mechanical / mostly a rename of the producer's destination).

Residence in `work/dropped/` removes the item from the build / auto-slice pool BY
RESIDENCE — exactly like `work/done/`. This CLOSES the verified gap that the
slicing-eligibility predicate (`needsAnswers !== true && humanOnly !== true &&
autoSlice && sliceAfter`) has NO notion of superseded/retired and would auto-slice
a superseded SPEC as if live: a superseded SPEC simply is not in `work/spec/`
(it is in `work/dropped/`), so no new flag is needed. "Superseded" thus becomes a
POSITION (a runner/human `git mv spec/<x> → dropped/<x>` + a `reason:` in the body),
consistent with the position-vs-nature model.

It is a DURABLE record on `main` (the same category as `done/`/`out-of-scope/`),
NOT a lock-ref transient.

## Acceptance criteria

- [ ] A `work/dropped/` terminal folder exists and is the producer destination that
      `work/out-of-scope/` was (the advance/triage terminal route now targets
      `dropped/`); `out-of-scope/` is folded in as a `reason:` value (and any
      existing `out-of-scope/` record migrates cleanly — the folder is currently
      empty).
- [ ] A SPEC in `work/dropped/` is NOT in the auto-slice pool (never auto-sliced);
      a slice in `work/dropped/` is NOT in the build pool — BY RESIDENCE, the same
      mechanism as `work/done/`. A superseded SPEC moved to `dropped/` is provably
      skipped by the slicer/build selector.
- [ ] The `reason:` is read from the item body (not a status field — status is the
      folder, WORK-CONTRACT rule 3).
- [ ] The terminal-folder union / terminal-priority ordering and any duplicate-slug
      ledger guard recognise `dropped/` wherever they recognise `out-of-scope/`
      today (the producers + the readers stay consistent — no reader re-implements
      the rule and drifts).
- [ ] Tests cover: a dropped SPEC is out of the auto-slice pool; a dropped slice is
      out of the build pool; the reason is read from the body; an existing
      `out-of-scope/` record migrates cleanly if folded in. House pattern
      (`--bare file://` arbiter). Acceptance gate green:
      `pnpm -r build && pnpm -r test && pnpm format:check`.

## Blocked by

- None — file-orthogonal to the placement slices (it touches the terminal-folder
  producer/readers, not the slicing placement seam), so it can land in parallel.

## Prompt

> Introduce a generic terminal `work/dropped/` folder that GENERALISES
> `work/out-of-scope/` and removes an item from the pool BY RESIDENCE. Read
> `work/spec/staging-pool-position-gate-and-trust-model.md` (US #16, #17, #18) and
> the governing ADR. First check for drift against the code
> (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> The maintainer DECIDED the name is `dropped` and that `out-of-scope/` is FOLDED
> IN as one `reason:` value (not kept as a separate folder). So: rename/retarget the
> terminal producer + recognise `dropped/` everywhere `out-of-scope/` is recognised
> today.
>
> WHERE TO LOOK: the terminal "won't do" route is produced in the triage/advance
> apply path (`src/apply-persist.ts` — `moveResolvedItemToTerminal`, the
> `out-of-scope` terminal, the terminal-priority ordering array) and the
> folder/disposition unions (`src/sidecar.ts` `SidecarDisposition`,
> `apply-persist.ts`'s terminal type). The POOL-ELIGIBILITY-BY-RESIDENCE readers
> are the build selector / claimability (`src/scan.ts`, `src/select-priority.ts`,
> `src/claim-cas.ts`, `src/ledger-read.ts`) and the slicing-eligibility predicate
> (`src/slicing-eligibility.ts` / `src/slicing.ts readSlicedSlugs` + the SPEC pool).
> Ensure a `work/dropped/<slug>.md` SPEC is excluded from the auto-slice pool and a
> `work/dropped/<slug>.md` slice from the build pool, the SAME way `work/done/`
> residence excludes — define the rule once where the existing terminal/done
> residence rule lives; do not re-implement per reader.
>
> The `reason:` lives in the item BODY (status is the folder — WORK-CONTRACT rule
> 3; do not add a status frontmatter field). `work/out-of-scope/` is currently empty,
> so the migration is mechanical, but still assert an existing record would migrate
> cleanly if folded in.
>
> SEAMS TO TEST AT: the `--bare file://` arbiter house pattern
> (`test/helpers/gitRepo.ts`). "DONE" = the acceptance criteria hold and
> `pnpm -r build && pnpm -r test && pnpm format:check` is green (`pnpm format` to
> fix formatting). Do NOT commit or move work/ files — the runner owns git. Record
> the fold-in decision (drop `out-of-scope/` entirely vs keep an alias) + the
> reason-vocabulary as a `## Decisions` note or an ADR if it meets the gate.
