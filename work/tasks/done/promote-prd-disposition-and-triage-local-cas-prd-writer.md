---
title: 'Add promote-spec disposition + triage-local CAS SPEC writer (observation→SPEC route)'
slug: promote-prd-disposition-and-triage-local-cas-prd-writer
spec: observation-discharge-by-deletion-self-contained-promotion-and-prd-route
blockedBy: [promotion-self-contained-body-and-delete-on-promote-task-route]
covers: [4, 9]
---

## What to build

Add an observation→SPEC promotion route so a SPEC-sized signal can be converted
in-loop, mirroring the task route but targeting the SPEC staging pool.

End-to-end behaviour:

- Add `promote-spec` to the sidecar disposition vocabulary (the
  `SidecarDisposition` type AND the parser's allowed-disposition set), alongside
  the existing `promote-task | promote-adr | keep | delete | dropped |
  needs-attention`.
- Branch the promotion writer on the disposition's artifact TYPE: `promote-task`
  → mint a task in `tasks-ready`; `promote-spec` → mint
  `specs/proposed/<slug>.md`. BOTH use the SAME triage-local `createItemThroughCas`
  writer (one local commit through the CAS) — NOT intake's branch+integrate band
  (`switchToWorkBranch`/`performIntegration`). A promoted SPEC always lands in
  `proposed/` (staging); a human later promotes it to `ready/`.
- The SPEC body is self-contained the same way the task body is (mechanism + fix +
  transcribed open questions / `needsAnswers`), reusing the body-composition
  machinery from the blocking task.
- The same atomic-commit + CAS-loser-backs-off guarantees apply to the SPEC
  create as to the task create (concurrent CI legs cannot double-mint or strand
  a lock).

## Acceptance criteria

- [ ] `promote-spec` is a recognised disposition (type + parser set); an unknown
      value still reads as undefined (no silent coerce).
- [ ] A `promote-spec` answer mints `specs/proposed/<slug>.md` through the SAME
      `createItemThroughCas` writer the task route uses (assert NOT intake's
      branch+integrate band).
- [ ] The minted SPEC body is self-contained (mechanism + transcribed open
      questions + `needsAnswers` as appropriate); the observation is deleted in
      the same atomic commit.
- [ ] A same-slug CAS race on the SPEC target leaves the observation intact for a
      retry (mirrors the task route).
- [ ] Tests cover the SPEC route (same throwaway-git-repo shape as the task
      route's tests, asserting a `specs-proposed` target).

## Blocked by

- `promotion-self-contained-body-and-delete-on-promote-task-route` — it
  establishes the self-contained-body + delete-in-same-commit machinery this
  task branches on, and edits the SAME promote writer (serialised to avoid a
  merge conflict).

## Prompt

> Goal: add the `promote-spec` observation→SPEC route, per the SPEC
> `observation-discharge-by-deletion-self-contained-promotion-and-prd-route`
> (Defect C + Resolved decision 1: use the triage-local CAS writer, NOT intake's
> spec-emit band).
>
> Where to look (by concept): the sidecar disposition type + parser
> allowed-disposition set (the `SidecarDisposition` union and its parse guard);
> the observation-promote writer `promoteObservation` you just made
> self-contained in the blocking task. Branch it on artifact type — task →
> `tasks-ready`, spec → `specs-proposed` — using the SAME new-item CAS-create
> helper for both. Do NOT call intake's `switchToWorkBranch`/`performIntegration`
> band: that is intake's standalone-front-door machinery and would drag branch+PR
> flow into the triage path. The advance loop's own create/integrate machinery
> handles what triage mints.
>
> Why CAS-not-intake (record if you re-confirm it): keeps one create/integrate
> surface for triage, preserves the CAS-loser-backs-off guarantee uniformly, and
> lands the SPEC in `proposed/` (staging) so a human promotes to `ready/` on their
> own time (and CI cannot race them).
>
> Seams to test at: the promote function over a throwaway git repo with a
> `promote-spec` disposition; assert a `specs/proposed/<slug>.md` is created via the
> CAS writer and the note is deleted in the same commit. Mirror the task route's
> tests.
>
> Scope: this task does NOT wire the SURFACE that OFFERS `promote-spec` to a human
> (that is a separate task) — only the disposition + writer.
