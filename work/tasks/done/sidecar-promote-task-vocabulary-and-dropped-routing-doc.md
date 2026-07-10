---
title: Sidecar disposition — rename promote-slice→promote-task and fix the stale dropped doc-comment
slug: sidecar-promote-task-vocabulary-and-dropped-routing-doc
blockedBy: []
covers: []
---

## What to build

Finish the post-migration vocabulary cutover where it stopped: the SIDECAR
disposition enum and its docs. The `folder-taxonomy-reorg-and-rename` migration
cut `slice`→`task` / `spec`→`brief` over at the identity/CLI seam, and split the
shared top-level `work/dropped/` terminal into per-regime terminals
(`tasks/cancelled/` for tasks, `briefs/dropped/` for briefs — a slug-collision
fix). But the sidecar disposition CONSTANTS + their doc-comments were OUT of that
cutover's scope, so two drifts remain in the sidecar / surface-gate surface.

Two things to fix (both verified against current main at task-birth):

1. **Rename the `promote-slice` disposition value to `promote-task`.** The value
   is load-bearing behaviour, not just a label, but the occurrences split: the
   only LIVE behaviour gate is in `advance.ts` (`entry.disposition ===
   'promote-slice'`); in `advance-drivers.ts` and `apply-persist.ts` the
   occurrences are DOC-COMMENTS that describe the promote edge (they still need
   updating so they do not go stale, but they are not runtime gates). Rename the
   value everywhere it lives:
   - the `SidecarDisposition` union and the `DISPOSITIONS` parse set in
     `sidecar.ts`,
   - the `DISPOSITIONS` allowed-list AND the agent-facing JSON contract string the
     surface prompt emits in `surface-gate.ts` (the
     `"disposition": "promote-slice|promote-adr|…"` line — so an agent answering a
     surface question is TOLD to write `promote-task`),
   - the live gate in `advance.ts` plus the doc-comment occurrences in
     `advance-drivers.ts` / `apply-persist.ts`,
   - the sidecar + surface-gate + triage/advance tests.

   **Decision to make and RECORD:** on the PARSE side, either tolerate legacy
   `promote-slice` as an alias mapping to `promote-task` (back-compat for any
   in-flight answered sidecars), OR do a hard cutover. There is a STRONG house
   precedent: the sibling rename `work/tasks/done/slice-task-prd-brief-vocabulary-hard-cutover.md`
   did `slice→task` as an explicit HARD CUTOVER with no deprecated aliases ("we
   have no external users owed a migration window"), and that very task scoped the
   sidecar `SidecarType` rename while deliberately leaving this disposition enum
   out — so a hard cutover here is the consistent default. It is still a real
   trade-off (any in-flight answered sidecar carrying `promote-slice` would stop
   parsing), so make the call deliberately, align with that precedent unless you
   find a concrete reason not to, and record it (see the Prompt's RECORD
   instruction).

2. **Fix the stale `dropped` doc-comment.** The `SidecarDisposition`
   doc-comment in `sidecar.ts` (the `dropped` entry) still says `dropped` "ROUTES
   the item to `work/dropped/`" — the RETIRED flat folder, which no longer exists.
   Correct the comment to name the per-regime terminals (`tasks/cancelled/` for a
   task, `briefs/dropped/` for a brief). IMPORTANT (verified at birth): the
   apply/persist code does NOT actually folder-route on `dropped` — there is no
   folder move on `dropped` in `sidecar-apply.ts` / `surface-persist.ts` /
   `triage-persist.ts` — so this is a stale COMMENT, not live mis-routing. Confirm
   that still holds; if a live path that DOES route a `dropped` disposition to a
   folder is found, point it at the correct per-regime terminal.

The end-to-end thread that must keep working: a surface question is emitted with
the new vocabulary → an agent answers `promote-task` in the sidecar → the apply
rung routes it exactly as `promote-slice` did before. Round-trip and tolerant-parse
sidecar invariants stay green.

## Acceptance criteria

- [ ] The `promote-slice` disposition value is renamed to `promote-task` across:
      the `SidecarDisposition` union, the `DISPOSITIONS` parse set, every consumer
      (`advance.ts`, `advance-drivers.ts`, `apply-persist.ts`), the surface-gate
      allowed-list AND the agent-facing JSON contract string the surface prompt
      emits, and the tests — so an agent answering a surface question is told to
      write `promote-task`.
- [ ] The parse-side back-compat decision (tolerate legacy `promote-slice` as an
      alias, or hard-cutover) is made and RECORDED in a `## Decisions` block in the
      done record / PR (or an ADR in `docs/adr/` if it meets the ADR gate).
- [ ] The `dropped` disposition doc-comment names the per-regime terminals
      (`tasks/cancelled/` / `briefs/dropped/`), not the retired flat
      `work/dropped/`. The task confirms whether any live code path routes
      `dropped` to a folder; if one exists it targets the correct per-regime
      terminal (at birth: none found — it is a stale comment only).
- [ ] The surface→apply round-trip still works end to end: a `promote-task`
      answered sidecar drives the apply rung as `promote-slice` did. Round-trip and
      tolerant-parse sidecar invariants stay green.
- [ ] Tests cover the new behaviour (mirror the repo's existing test style),
      including the chosen parse-side back-compat behaviour (alias accepted, or
      legacy value rejected/ignored).
- [ ] Tests use throwaway git repos + a local `--bare` `file://` arbiter; nothing
      writes outside its own temp fixtures.

## Blocked by

- None — can start immediately. This follows the
  `folder-taxonomy-reorg-and-rename` migration, whose umbrella brief is in
  `work/briefs/tasked/` and whose relevant task slices have LANDED in
  `work/tasks/done/`: `slice-task-prd-brief-vocabulary-hard-cutover` (the sibling
  vocabulary cutover that scoped the sidecar `SidecarType` rename but left this
  disposition enum out), `brief-regime-rename-and-dropped-migration`, and
  `generic-terminal-dropped-folder-generalising-out-of-scope` (which retired the
  flat `work/dropped/` into the per-regime terminals).

## Prompt

> Finish the post-migration vocabulary cutover where it stopped: the sidecar
> disposition enum and its docs. You are NOT re-opening the migration; you are
> landing the two constants it left out of scope (it scoped to the identity/CLI
> seam, not the sidecar disposition constants).
>
> Domain vocabulary: the migration renamed `slice`→`task` and `spec`→`brief`, and
> split the shared top-level `work/dropped/` terminal into per-regime terminals
> (`tasks/cancelled/` for tasks, `briefs/dropped/` for briefs — a slug-collision
> fix). The `dropped` sidecar disposition is the generic "won't-proceed" terminal;
> its specific REASON lives in the item body (`reason:`), not in the folder.
>
> Two fixes:
>
> 1. Rename the `promote-slice` disposition value to `promote-task`. It is
>    load-bearing: it is consumed as a behaviour gate
>    (`entry.disposition === 'promote-slice'`), not just a label. Where to look (by
>    module/concept, not brittle line numbers): `packages/dorfl/src/sidecar.ts`
>    (the `SidecarDisposition` union + the `DISPOSITIONS` parse set), and
>    `packages/dorfl/src/surface-gate.ts` (the allowed-dispositions
>    `DISPOSITIONS` set + the agent-facing JSON contract STRING the surface prompt
>    emits — the `"disposition": "promote-slice|promote-adr|…"` line; this is what
>    TELLS an answering agent what to write, so it MUST say `promote-task`). Then the
>    live gate in `advance.ts` plus the doc-comment occurrences in `advance-drivers.ts`
>    / `apply-persist.ts` (only `advance.ts` is a runtime gate; the other two are
>    comments that would otherwise go stale), and the tests
>    `packages/dorfl/test/sidecar.test.ts` + the surface-gate / triage / advance
>    tests (grep `promote-slice` to find them all).
>
>    DECIDE and RECORD the parse-side back-compat policy: tolerate legacy
>    `promote-slice` as an alias mapping to `promote-task` (safe for any in-flight
>    answered sidecars), OR hard-cutover. STRONG precedent for hard-cutover:
>    `work/tasks/done/slice-task-prd-brief-vocabulary-hard-cutover.md` did the sibling
>    `slice→task` rename with NO deprecated aliases ("we have no external users owed a
>    migration window") and is the same task that scoped the sidecar `SidecarType`
>    rename while leaving this disposition enum out of scope. Align with that unless you
>    find a concrete reason not to; it is still a real trade-off, so make the call
>    deliberately and add a test for whichever you choose.
>
> 2. Fix the stale `dropped` doc-comment in `sidecar.ts` (the `SidecarDisposition`
>    doc-comment, the `dropped` entry): it still says `dropped` routes to the retired
>    flat `work/dropped/`. Correct it to the per-regime terminals (`tasks/cancelled/`
>    for a task, `briefs/dropped/` for a brief). At birth, triage confirmed the
>    apply/persist code does NOT folder-route on `dropped` (no `dropped` folder move in
>    `sidecar-apply.ts` / `surface-persist.ts` / `triage-persist.ts`), so this is a
>    stale comment only. CONFIRM that still holds; if you find a live path that routes
>    `dropped` to a folder, point it at the correct per-regime terminal.
>
> "Done" means: the value is `promote-task` everywhere (enum, parse set, surface-gate
> allowed list, surface-prompt JSON contract string, consumers, tests); the back-compat
> decision is recorded; the `dropped` doc-comment names the per-regime terminals; and
> the surface→apply round-trip plus the round-trip/tolerant-parse sidecar invariants are
> green. Verify with `pnpm -r build && pnpm -r test && pnpm format:check`. Tests use
> throwaway git repos + a local `--bare` `file://` arbiter and write nothing outside
> their own temp fixtures.
>
> FIRST, check this task against current reality (it is a launch snapshot and may have
> DRIFTED): does it still match the code in `work/tasks/done/` (especially
> `slice-task-prd-brief-vocabulary-hard-cutover`, the sibling cutover this extends), the
> relevant ADRs, and the migration it follows? If `promote-slice` was already renamed, or the
> `dropped` comment already corrected, or an ADR superseded an assumption here, do NOT
> build on the stale premise — route the task to needs-attention with the discrepancy as
> the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building. The parse-side
> back-compat choice is the explicit one called out above; if you hit others, surface
> them. If a decision meets the ADR gate (hard to reverse + surprising without context +
> a real trade-off — see `ADR-FORMAT.md`), write the WHY as an ADR in `docs/adr/`;
> otherwise note it in a `## Decisions` line in the done record / PR description. An
> un-recorded in-scope decision is a review FINDING, not a silent default.

---

### Claiming this task

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
dorfl claim <slug> --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/<slug> <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/tasks/todo/<slug>.md work/tasks/done/<slug>.md
```
