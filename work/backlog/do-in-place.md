---
title: do-in-place — the per-repo in-place worker (the CI command); absorbs ar-run.sh
slug: do-in-place
prd: command-surface-phase-2
blockedBy: [isolation-strategy-seam, slug-namespace-resolution]
covers: [8, 11]
---

## What to build

The **keystone** of phase 2: the `do` command's in-place form — the per-repo,
in-place worker that claims + builds + gates + integrates in ONE repo, then exits
(ADR §3). **This is the CI command.**

- **`do <slug>`** (and `do slice:<slug>` / `do prd:<slug>` routed via
  `slug-namespace-resolution`) in a checkout: claim + onboard the item, build it
  (run the agent through the harness seam), run the acceptance gate, rebase,
  integrate, then **exit** (sequential, one repo). Uses the **in-place isolation
  strategy** from `isolation-strategy-seam` (the checkout / CI container IS the
  isolation — no hub mirror, no external worktree).
- **The in-place checkout lifecycle (what `ar-run.sh` actually does — do NOT lose
  it).** `ar-run.sh` (the script this absorbs) is literally `start` → `prompt | pi`
  → `complete`, guarded by a **dirty-tree refusal**. So the in-place `do` MUST:
  1. **Refuse on a dirty working tree** (uncommitted/staged changes) — it runs in a
     REAL checkout; it must not entangle unrelated work or run over the human's
     changes. (`ar-run.sh`: "error: working tree is dirty — commit/stash before
     running a slice.")
  2. **Onboard like `start`** — claim (if needed) AND switch the checkout to
     `work/<slug>` before the agent runs (the agent edits ON the work branch), not
     a bare claim-CAS.
  3. Run the agent in that checkout, gate, rebase, integrate **like `complete`**,
     then switch back / tidy the local branch on success.
  This is the `start`+`complete` composition, NOT a fresh reimplementation — see
  the design note below on which existing path to build on.
- **`--propose` (default) / `--merge`** — propose (PR) is the CI norm; mode resolved
  at integrate-time exactly like `complete` (flag > per-repo > global > default
  propose).
- **The runner owns all git** — claim, done-move, completion commit, integration —
  the agent only edits code (same in-band boundary as `run`/`ar-run.sh`).
- **DESIGN NOTE — which path to build on (confirm before coding, do not guess).**
  There are two existing pipelines and the in-place `do` should COMPOSE the right
  one, not duplicate logic:
  - `run`'s `runOneItem` (private) drives the **job-worktree** path end-to-end but
    is `Job`-shaped (the `isolation-strategy-seam` slice is meant to lift it onto a
    uniform handle so it can also drive in-place).
  - the **human verbs** `start` (claim+switch+dirty-guard) and `complete`
    (gate+done-move+rebase+integrate+branch-tidy) ALREADY implement the exact
    in-place lifecycle `ar-run.sh` composes — in-place `do` is essentially "`start`
    then run the agent (autonomous, prompt-fed harness) then `complete`", with the
    runner owning git throughout.
  Prefer composing/sharing the `start`+`complete` machinery for the in-place case
  (it already does the dirty-guard, branch switch, gate, integrate, and tidy) over
  re-deriving it from `runOneItem`; reconcile with the `isolation-strategy-seam`
  handle so `do --remote` (job-worktree) and `do <slug>` (in-place) share as much
  as cleanly possible. If the two cannot be cleanly unified, the in-place path
  composing `start`+`complete` is the correct primary — say so in the code and keep
  the agent invocation (autonomous, via the harness seam) as the only new middle
  step. Do NOT silently fork a third pipeline.
- **CRITICAL — `do` is AUTONOMOUS, so it needs `run`'s failure-surfacing, NOT
  `complete`'s. Composing `performComplete` as-is gives the WRONG semantics.** This
  is a real, verified divergence between the two paths, not a nuance to gloss:
  - On a red gate / rebase conflict, BOTH `performComplete` and `runOneItem` route
    the item to `needs-attention/` via the SAME seam call
    (`ledgerWrite.applyNeedsAttentionTransition`). BUT `performComplete` calls it
    **without an `arbiter`** (the HUMAN path: a human is right there, no
    cross-machine surfacing needed), whereas `runOneItem` calls it **WITH
    `arbiter: job.arbiterRemote`**. That arbiter argument is what triggers the
    on-`main` surfacing (the cherry-pick) AND pushes the work branch — i.e. makes
    the stuck state visible cross-machine / to `scan`/`status`. `do` runs
    UNATTENDED (it is the CI command; no human watching), so it MUST get the
    autonomous, arbiter-passed surfacing like `run` — a stuck CI `do` that only
    routes locally is invisible.
  - So composing `performComplete` verbatim is INSUFFICIENT for `do`'s failure path.
    Resolve it ONE of two ways: (a) extend `performComplete` with an option to pass
    the arbiter into its `applyNeedsAttentionTransition` calls (so the autonomous
    caller gets on-`main` surfacing while the human `complete` keeps today's
    local-only behaviour), or (b) have `do` use `run`'s integrate+surface routing
    for that step. Do NOT ship a `do` whose stuck items fail to surface on the
    arbiter. The success path (gate green → done-move → rebase → integrate) can
    still reuse `complete`'s machinery; it is specifically the NEEDS-ATTENTION
    routing that must be the autonomous (arbiter-passed) variant.
- **`do prd:<slug>` routing:** this slice wires the resolver so `do` ACCEPTS all
  three forms and dispatches `prd:` toward the slicing path. The actual slicing
  orchestration is the reshaped `autoslice-command` slice (blocked on this one);
  here, `do prd:<slug>` must at minimum resolve correctly and reach the
  slicing-path entry point (even if that entry is a clear "not yet wired" until
  autoslice-command lands) — do NOT reimplement slicing here.
- **Absorbs `ar-run.sh`** (the bash test-driver at the REPO ROOT, not `scripts/`)
  — the ad-hoc driver retires; `do`
  (in-place, `--propose`) is what CI runs. Confirm the equivalence (CI's needs are
  met by `do --propose`); remove/retire the script.

The auto-pick / multi-arg / `-n` forms and the slices-first priority are the
`do-autopick` slice; `do --remote` is the `do-remote` slice. THIS slice is the
single-named-item, in-place, exits path + the resolver wiring.

**Define `do`'s argument grammar to be EXTENSIBLE — the other two `do-*` slices grow
the SAME command definition.** All three (`do-in-place`, `do-remote`, `do-autopick`)
edit the one `.command('do')` block in `cli.ts`: this slice creates it (single
named item, in-place); `do-remote` adds the `--remote <r>` option; `do-autopick`
makes the arg VARIADIC (`do <a> <b>…`), allows zero args (auto-pick), and adds
`-n <x>`. So do NOT lock the argument as a single REQUIRED positional that the
later slices must tear up — shape it so it naturally widens to variadic/optional
(e.g. a variadic positional that this slice happens to use with exactly one arg,
or a structure that `do-autopick` extends rather than rewrites). The slices are
serialised (`do-in-place` → `do-remote` → `do-autopick`) precisely so this one
command block is never co-edited in parallel; leave it in a state the next slice
extends cleanly.

## Acceptance criteria

- [ ] `do <slug>` in a checkout **refuses on a dirty tree**, then claims + onboards
      (switches to `work/<slug>`, like `start`) + runs the agent + gates +
      integrates in-place + exits (switching back / tidying like `complete`); a
      lost claim race is skipped cleanly; a red gate / rebase conflict routes to
      needs-attention (the runner owns the git, the agent does not).
- [ ] The in-place path COMPOSES the existing `start`+`complete` machinery (with
      the autonomous harness-run between them) rather than forking a third
      pipeline; it shares with the job-worktree path via the
      `isolation-strategy-seam` handle where clean.
- [ ] `--propose` (default) / `--merge` resolve at integrate-time (flag > per-repo >
      global > default), matching `complete`.
- [ ] `do slice:<slug>` / `do prd:<slug>` resolve via `slug-namespace-resolution`;
      `do prd:<slug>` reaches the slicing-path entry point (full slicing is
      `autoslice-command`, not built here); a bare-slug slice/PRD collision errors.
- [ ] `ar-run.sh` (repo root) is retired; `do --propose` is documented as the CI
      command that replaces it (equivalence confirmed).
- [ ] Tests (throwaway checkout + local `--bare` arbiter, stubbed harness): in-place
      claim→build→gate→integrate→exit happy path; lost-race skip; red-gate →
      needs-attention via the seam; `--merge`/`--propose` resolution; slug
      resolution incl. the `prd:` dispatch + collision error.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `isolation-strategy-seam` — `do <slug>` uses its IN-PLACE strategy (the checkout
  is the isolation). Must exist first.
- `slug-namespace-resolution` — `do` accepts bare/`slice:`/`prd:`; the resolver +
  collision error must exist first.

## Prompt

> Build the **`do` worker's in-place form** — the per-repo, in-place worker that
> claims + builds + gates + integrates in ONE checkout then exits, per
> `docs/adr/command-surface-and-journeys.md` §3. THIS IS THE CI COMMAND and it
> absorbs `ar-run.sh` (at the REPO ROOT, not `scripts/`). This is the keystone other phase-2 slices (and the
> reshaped autoslice slices) build on. Build ONLY the single-named-item, in-place,
> exits path + the slug-resolver wiring — NOT auto-pick/`-n`/multi-arg (that is
> `do-autopick`), NOT `--remote` (that is `do-remote`), NOT the PRD-slicing
> orchestration (that is `autoslice-command`).
>
> FIRST run the drift check (this is the keystone — be thorough): confirm
> `isolation-strategy-seam` (in `done/`) exposes an in-place strategy as this slice
> assumes; confirm `slug-namespace-resolution` (in `done/`) exposes the resolver +
> `prd:` rejection seam; confirm `run.ts`'s `runOneItem` is still the runner-owns-
> all-git pattern to mirror, and `complete.ts`'s integrate-time mode resolution.
> If any landed differently, route to needs-attention with the discrepancy
> (WORK-CONTRACT.md "Drift is a needs-attention signal") — do not build on a stale
> seam.
>
> READ FIRST: ADR `command-surface-and-journeys` §3/§3a, `docs/adr/execution-
> substrate-decisions.md` §1/§4/§6/§8/§10/§12 (jobs, deletion safety, integration
> seam, the gate, rebase-or-abort, needs-attention), the done files + modules for
> `isolation-strategy-seam` (it extracted the post-claim pipeline to run on a
> UNIFORM HANDLE + a strategy, and added the in-place strategy — you select it) and
> `slug-namespace-resolution` (the resolver), AND CRITICALLY `ar-run.sh` (at the
> repo root — NOT `scripts/ar-run.sh`, which does not exist) which shows the in-place
> flow is `start` → `prompt | agent` → `complete` with a DIRTY-TREE REFUSAL,
> `src/start.ts` (claim + switch to `work/<slug>` + the onboarding to compose),
> `src/complete.ts` (the gate + done-move + rebase + integrate + branch-tidy +
> integrate-time `--merge`/`--propose` resolution to compose), `src/run.ts` (the
> extracted pipeline + the runner-owns-git pattern + how it routes red gate /
> conflict through the ledger needs-attention seam), and `src/integrator.ts`.
>
> The in-place `do` is essentially `start` + (autonomous harness run) + `complete`
> — PREFER composing those existing verbs (they already do the dirty-guard, branch
> switch, gate, integrate, tidy) over re-deriving from `runOneItem`. Refuse on a
> dirty tree. Confirm `do --propose` meets CI's needs, then retire `ar-run.sh`.
>
> Implement `do <slug>` (in-place isolation) with `--propose`(default)/`--merge`:
> select the IN-PLACE strategy from `isolation-strategy-seam` and run the extracted
> pipeline against its handle (do NOT reimplement claim/isolation/integration, and
> do NOT re-add a concrete-`Job` dependency — the seam already abstracted that).
> If the seam did NOT actually extract the pipeline onto a uniform handle (i.e. it
> only abstracted prepare/teardown and `runOneItem` still reads a concrete `Job`),
> that is DRIFT — route to needs-attention rather than forcing the in-place case
> through a job-worktree-shaped pipeline. Wire the resolver so `do` accepts bare/`slice:`/
> `prd:`; `prd:` reaches the slicing-path entry (clear "not yet wired" stub until
> autoslice-command). Retire `ar-run.sh`.
>
> TDD with vitest, house style (throwaway checkout + local `--bare` arbiter, stubbed
> harness): in-place happy path → exit; lost-race skip; red-gate → needs-attention
> via the seam; mode resolution; slug resolution + `prd:` dispatch + collision. Race
> tests in the non-parallel project. "Done" = acceptance criteria met and gate green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim do-in-place --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/do-in-place <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/do-in-place.md work/done/do-in-place.md
```
