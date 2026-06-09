---
title: advance — the CI-integration deliverable: a GitHub Actions workflow TEMPLATE (the `install-ci` notion) wiring "on cron / on-answer-committed → the right shape" (propose=matrix, merge=single-sequential)
slug: advance-install-ci
prd: advance-loop
blockedBy: [advance-drivers-and-gates]
covers: [27, 28]
---

## What to build

A separate CI-INTEGRATION deliverable: a GitHub Actions workflow TEMPLATE (the
`install-ci` notion) that wires "on cron / on-answer-committed → run the RIGHT
shape", so CI adoption is ONE step and NOT entangled with the tick. The tick +
drivers already exist (`advance-drivers-and-gates`); this slice is the CI substrate
that invokes them.

### The two CI shapes (US #27 — each mode uses the right shape)

- **`propose` mode → a MATRIX of independent jobs** (one per item, each opens a PR,
  TRUE parallelism, `-n` not even needed). Because propose-mode items are
  independent PRs, a matrix is the right parallel shape.
- **`merge` mode → a SINGLE SEQUENTIAL job.** Because merge-mode items chain via
  rebase and parallel merge jobs would THRASH the main-CAS, merge mode runs one
  sequential job (the `-n`/loop driver).

### Precise scope

- A workflow TEMPLATE (committed under the repo's docs / a templates area, NOT a
  live `.github/workflows/` that self-triggers in THIS repo unless intended —
  decide + record in `## Decisions`) that:
  - triggers on cron AND on a commit that answers a question
    (on-answer-committed — e.g. a push touching `work/questions/*`);
  - in `propose` mode, emits a MATRIX of independent jobs (one PR per item),
    enumerating items via the mirror-side pool scan;
  - in `merge` mode, runs a SINGLE SEQUENTIAL job invoking the loop/`-n` driver.
- The `install-ci` notion: a one-step adoption (a command or a documented copy of
  the template) so a repo opts into the CI loop without hand-assembling the
  workflow. (Whether `install-ci` is a CLI subcommand or a documented template copy
  is a micro-choice — pick the lighter one and record it in `## Decisions`; the PRD
  calls it "the `install-ci` notion", not a hard CLI surface.)
- It is NOT entangled with the tick — it only INVOKES the existing drivers
  (`advance`/`run`) with the right mode/shape.

## Acceptance criteria

- [ ] A GitHub Actions workflow TEMPLATE exists that triggers on cron AND
      on-answer-committed (a push touching `work/questions/*`).
- [ ] `propose` mode → a MATRIX of independent jobs (one PR per item), enumerating
      items via the mirror-side pool scan; `merge` mode → a SINGLE SEQUENTIAL job
      invoking the loop/`-n` driver.
- [ ] The CI integration is ONE adoption step (the `install-ci` notion — a CLI
      subcommand OR a documented template copy; choice recorded in `## Decisions`)
      and is NOT entangled with the tick (it only invokes the existing drivers).
- [ ] If a CLI surface is added, it is tested (the workflow file is emitted
      correctly); if it is a documented template, the template is validated (e.g.
      parses as YAML and references the right driver invocations).
- [ ] No live workflow self-triggers in THIS repo unintentionally (decision
      recorded); any test writes only to its own temp fixtures (no shared/global
      location touched).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `advance-drivers-and-gates` — the CI shapes INVOKE the one-shot + loop drivers
  and the per-mode behaviour those drivers implement.

## Prompt

> Build the CI-integration deliverable: a GitHub Actions workflow TEMPLATE (the
> `install-ci` notion) wiring "on cron / on-answer-committed → the right shape". Read
> the PRD `advance-loop` (in `work/prd-sliced/advance-loop.md` or
> `work/slicing/advance-loop.md` while being sliced — NOT `work/prd/`) (US #27/28, "Two drivers + -n + CI"). `propose`
> mode → a MATRIX of independent jobs (one PR per item, true parallelism, `-n` not
> needed); `merge` mode → a SINGLE SEQUENTIAL job (merge items chain via rebase;
> parallel merge jobs would thrash the main-CAS). It only INVOKES the existing
> `advance`/`run` drivers — NOT entangled with the tick. `install-ci` is a one-step
> adoption (a CLI subcommand OR a documented template copy — pick the lighter, record
> in `## Decisions`). Enumerate matrix items via the mirror-side pool scan. Do NOT let
> a live workflow self-trigger in THIS repo unintentionally (record the decision).
>
> READ FIRST: the drivers from `advance-drivers-and-gates` (the one-shot + loop the CI
> invokes), the mirror-side pool scan from `mirror-side-eligible-pool-scan`, the
> existing `.github/workflows/` (if any) for the house CI convention, and the PRD's CI
> shape section. Look for any existing "install"/setup-convenience command pattern in
> `cli.ts` to mirror if you add a subcommand.
>
> FIRST, check this slice against current reality (drift). If a dependency landed
> differently than assumed, reconcile or route to `needs-attention/`.
>
> "Done" = the acceptance criteria are met and `pnpm -r build && pnpm -r test &&
> pnpm -r format:check` is green.

---

### Claiming this slice

```sh
agent-runner claim advance-install-ci --arbiter origin
git fetch origin && git switch -c work/advance-install-ci origin/main
git mv work/in-progress/advance-install-ci.md work/done/advance-install-ci.md
```
