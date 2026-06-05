---
title: Command surface phase 2 — build the new surface (registry, run/do split, human face, cleanup)
slug: command-surface-phase-2
sliceAfter: []
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth:
> `docs/adr/command-surface-and-journeys.md` (the model) + `docs/adr/` + the code;
> remaining work: `work/backlog/` slices. (The technical-detail sections below are
> trimmed by `to-slices` once the work is sliced — they move into slices/ADRs and
> this PRD settles to its durable framing: Problem / Solution / User Stories /
> Out of Scope.)
>
> **This PRD is phase 2 of the 3-phase reconciliation mandated by
> `docs/adr/command-surface-and-journeys.md`.** Phase 1 (reconcile-the-docs) is
> done: the ADR is accepted, CONTEXT.md is rewritten, the affected PRDs/slices are
> reshaped. Phase 2 = **BUILD** the new surface (this PRD + its slices). Phase 3
> (reconcile-the-code) is a later drift-check, not part of this PRD. The ADR is the
> source of truth; this PRD is the build framing + slicing plan derived from it.

## Problem Statement

The `agent-runner` command surface grew slice-by-slice into an **incoherent set**.
`docs/adr/command-surface-and-journeys.md` resolved this on paper — it defines one
coherent two-axis model (**target** = the registry / one repo × **doer** = agent /
human) with a clean command set — but **only the docs are reconciled**. The
running code still embodies the old, drifted model:

- there is **no registry** — repos are discovered by walking config `roots`, and
  the registered set is a config list, not the set of hub mirrors on disk;
- `arbiter init` / `arbiter status` are their own subcommands instead of folding
  into `remote add --local` / `status`;
- there is **no `do`** — the per-repo, in-place worker that CI needs; `run` exists
  but *throws unless `--once`*, and the CI path is an ad-hoc bash driver
  (`scripts/ar-run.sh`);
- the human face is missing `resume` and `--agent`, and `work-on` does not `cd`
  you in by default;
- flags are inconsistent (`return` vs the clearer `requeue`; a dead `--by`;
  `--force` overloaded for both a harmless readiness override AND the genuinely
  destructive `gc`);
- `scan`/`status` still assume the retired "scan is always offline" invariant.

Until the code matches the model, the surface a user touches is the old, confusing
one — and the reshaped backlog slices (`autoslice-command`, `autoslice-confidence`)
are blocked because they target a `do` command that does not yet exist.

## Solution

Build the command surface the ADR specifies, sliced along file-orthogonal
boundaries with **`do` as the keystone**. The work, exactly per the ADR + the
phase-2 build inventory in `work/observations/command-surface-reconciliation.md`:

- **The registry = the set of hub-mirror folders (ADR §1).** Add
  `remote add/rm/ls/find`; the registered set IS the hub mirrors under
  `<workspacesDir>/repos/` (no `roots`, never a `remotes` config field). Key =
  `host/org/name`; `remote add` guards against registering one project under two
  transports (the anti-stranding guard from
  `work/observations/hub-mirror-key-ignores-transport.md`). `remote add --local`
  registers a `--bare` arbiter (absorbing `arbiter init`); `arbiter status` folds
  into `status`. `remote find <folder>` reuses `isParticipatingRepo`.

- **The autonomous split: `run` (daemon) vs `do` (worker) (ADR §3).** `run` =
  the cross-repo, parallel daemon (scan the registry, claim up to `maxParallel`,
  run concurrently in job worktrees, integrate, loop forever); `run --once` = one
  debug tick (NOT the CI path). `do` = the per-repo, in-place worker (claim +
  build + gate + integrate in ONE repo, then exit) — **the CI command**, and it
  absorbs `scripts/ar-run.sh`. `do <slug>` / `do prd:<slug>` (slice it) / `do`
  (auto-pick) / `do <a> <b>…` / `do -n <x>`; `--propose` (default) / `--merge`.
  Isolation by form: `do <slug>` in a checkout works **in-place** (the checkout is
  the isolation); `do --remote <r>` materialises a hub mirror + job worktree in
  the agents' area (the SAME isolation `run` uses).

- **Slug-namespace resolution (ADR §3a).** Bare `<slug>` = the slice (ERROR on a
  slice/PRD collision); `slice:<slug>` / `prd:<slug>` explicit. `do` spans both
  namespaces; slice-only commands reject `prd:`. CI/automation uses explicit
  prefixes.

- **The human face (ADR §4).** Add a `resume` verb (re-engage an in-progress item
  in the current checkout; `start --resume` becomes a hidden alias). Add `--agent`
  to `start`/`work-on` — launch the configured harness **interactively** (the human
  starts chatting with an agent; the launch is foreground and waits for the human's
  message — distinct from the autonomous, prompt-fed, unattended harness launch in
  `run`/`do`). `work-on` `cd`s you in by default (via the shell wrapper;
  `--print-dir` is that wrapper's plumbing).

- **Renames / flag cleanup (ADR §7).** `return` → `requeue`; remove `--by`;
  readiness override = `--ignore-not-ready` ONLY (free `--force` for the genuinely
  destructive `gc --force`); demote advanced/plumbing flags + verbs in help.

- **`scan`/`status` fetch-first (ADR §5/§6).** Both fetch the truth (warn + fall
  back to last-known offline); the old "scan is always offline" invariant is
  retired (it was the roots-local model). The ledger read seam's offline read is
  unchanged — this is about `scan`/`status` fetching first, not changing the
  ledger strategy.

The whole surface is checked against the deep principle **adopt = skill, execute =
command (ADR §8)**: these are all execution-layer COMMANDS; nothing here is a
protocol-adoption concern (those stay skills).

## User Stories

1. As the maintainer, I want `remote add <url> [--local]` to register a target by
   creating its hub mirror, so that the registered set IS the mirrors on disk —
   no `roots`/`remotes` config list to drift.
2. As the maintainer, I want `remote rm`, `remote ls`, and `remote find <folder>`,
   so that I can de-register, enumerate (with each origin URL/transport), and
   discover `work/`-participating repos to toggle-add — and so `remote rm` is the
   ONLY mirror deleter (`gc` never reaps mirrors).
3. As the maintainer, I want `remote add` to refuse registering one project under
   a second transport (naming the existing one) unless `--force`, so that I never
   silently strand un-pushed work across two mirrors of the same project.
4. As the maintainer, I want `arbiter init`/`arbiter status` folded into
   `remote add --local` / `status`, so that there is one registration model and
   one dashboard — no parallel `arbiter` namespace.
5. As the maintainer, I want the config `roots` field gone (and no `remotes` field
   ever added), so that the registry is exactly the hub-mirror set and there is no
   second source of truth for "what gets watched".
6. As the maintainer, I want an in-place/job-worktree **isolation-strategy seam**
   that `do` selects on, so that `do <slug>` in a checkout uses the checkout as its
   isolation while `do --remote` (and `run`) use a mirror + job worktree — one
   seam, two strategies, chosen by whether there is a checkout.
7. As the maintainer, I want bare/`slice:`/`prd:` slug resolution with a loud
   collision error, so that a bare slug is human convenience that never silently
   guesses, and CI uses collision-proof explicit prefixes.
8. As the maintainer, I want `do <slug>` to claim + build + gate + integrate in
   the CURRENT checkout in-place, then exit, with `--propose` (default) /
   `--merge`, so that I have a one-shot worker AND the exact command CI runs — and
   so the ad-hoc `scripts/ar-run.sh` driver dies into it.
9. As the maintainer, I want `do --remote <r>` to materialise a hub mirror + job
   worktree in the agents' area (sharing `run`'s isolation), so that I can run the
   worker against any registered repo without a checkout, never touching the human
   area.
10. As the maintainer, I want `do` (no arg) to auto-pick one eligible thing,
    `do <a> <b>…` to do those in sequence, and `do -n <x>` to do x eligible
    things, with **slices-first then PRDs-to-slice** priority (per-repo toggle), so
    that the worker drains ready work before creating more.
11. As the maintainer, I want `do prd:<slug>` to be the PRD-slicing path (the entry
    the reshaped `autoslice-command` builds), so that slicing is "work to do" in the
    same worker — no standalone `slice` verb.
12. As the maintainer, I want `run` to be the cross-repo, parallel, forever-looping
    daemon (scan the registry, claim up to `maxParallel`/`perRepoMax`, run
    concurrently, integrate, loop), with `run --once` = one debug tick that no
    longer throws, so that I have the future system service AND a way to test one
    tick — and so the deleted `watch` verb's bounded-loop + surface-failures
    behaviour is absorbed here (stuck items route through the existing
    needs-attention seam, surfaced on `main`), nothing lost.
13. As the maintainer, I want a `resume <slug>` verb (with `start --resume` kept as
    a hidden alias), so that "begin work here" (`start`) and "continue here"
    (`resume`) are distinct, memorable verbs.
14. As the maintainer, I want `--agent` on `start`/`work-on` to launch the
    configured harness INTERACTIVELY (foreground, waiting for my first message), so
    that I can immediately start chatting with an agent on the freshly-onboarded
    work — distinct from the autonomous unattended launch.
15. As the maintainer, I want `work-on` to `cd` me into the new worktree by default
    (via the shell wrapper), with `--print-dir` reserved as the wrapper's plumbing,
    so that the parallel human flow drops me straight into the work.
16. As the maintainer, I want `return` renamed to `requeue`, so that the
    defer-don't-finish verb names its action (its pair: `complete` = fixed it,
    `requeue` = deferring back to the queue).
17. As the maintainer, I want `--by` removed from claim/start/work-on, so that a
    dead flag (the `claimed_by` field is gone; git history is the claim ledger) is
    not part of the surface.
18. As the maintainer, I want the readiness override spelled ONLY
    `--ignore-not-ready` (dropping the `--force` spelling on claim/start/work-on),
    so that `--force` is reserved for the genuinely destructive `gc --force` —
    different danger levels never share a flag name.
19. As the maintainer, I want advanced/plumbing verbs+flags (`claim`, `prompt`,
    `verify`, `gc`, `remote rm`, `--skip-verify`/`--type`/`--message`/`--copy`/
    `--print-dir`) de-emphasised in help, so that the headline tier (`run`, `do`,
    `work-on`, `start`, `complete`, `scan`, `status`, `remote add`/`ls`/`find`)
    reads as the surface.
20. As the maintainer, I want `scan` and `status` to fetch the truth first (warn +
    fall back to last-known offline), so that the registry's remote-as-source-of-
    truth model holds and the retired offline-scan invariant is gone.

### Autonomy notes (the two gate axes)

- **`humanOnly` (this PRD, DECIDED):** OMITTED. The ADR is accepted and the model
  is decided, so a human need not drive the *slicing* of this PRD — it is
  straightforwardly agent-sliceable. **Per WORK-CONTRACT.md §3b this is disjoint
  from the slices' gates:** the slicer sets each slice's gate from that slice's own
  build-nature, NOT from this PRD. (All planned slices below are judged
  agent-buildable on their own merits — see the slicing plan; `--agent` is
  agent-buildable because it is wiring an interactive harness launch behind a flag,
  testable with a stubbed/asserted launch, even though the feature itself is
  human-facing.)
- **`needsAnswers`:** NONE OPEN. The ADR settles every decision this PRD builds
  (the registry model, the run/do split, slug resolution, the human-face verbs,
  the flag cleanup, fetch-first). Omitted.

## Implementation Decisions

> Trimmed at slice-time: this detail moves into the slices (what to build) and,
> where it is durable rationale, it ALREADY lives in
> `docs/adr/command-surface-and-journeys.md` + the substrate ADRs. It is here only
> to seed the slicing.

### The slicing plan (file-orthogonal; `do-in-place` is the keystone)

Ten slices. Gates: all agent-buildable (none needs human judgement/secrets to
BUILD — each is wiring/logic testable with throwaway repos + a local `--bare`
arbiter + stubbed harness, the established house pattern). `blockedBy` is set both
for true logical deps AND to serialise slices that touch the same files (cli.ts is
the shared hot file — see the conflict note below).

1. **`registry-remote`** — `remote add/rm/ls/find`; `remote add --local` absorbs
   `arbiterInit`; `arbiter status` folds into `status`; remove the config `roots`
   field (never add `remotes`); the transport guard; `remote find` reuses
   `isParticipatingRepo`. Touches `cli.ts`, `config.ts`, `arbiter.ts`, a new
   `remote.ts`, `repo-mirror.ts`, `detect.ts`. `blockedBy: []`.
2. **`isolation-strategy-seam`** — the in-place vs job-worktree isolation seam
   `do` selects on (in-place when there is a checkout; mirror + job worktree for
   `do --remote`, sharing `run`'s `createJob` path). Pure seam extraction from
   `run.ts`/`workspace.ts`; no command yet. `blockedBy: []`.
3. **`slug-namespace-resolution`** — the §3a resolver: bare = slice (cross-namespace
   existence check; ERROR on collision), `slice:` / `prd:` explicit; slice-only
   commands reject `prd:`. Pure logic + its consumers' call sites. `blockedBy: []`.
4. **`do-in-place`** (KEYSTONE) — `do <slug>` (and `do slice:<slug>`/`do prd:<slug>`
   routing via slice 3) in a checkout: claim + build + gate + integrate in-place
   (via slice 2's in-place strategy), `--propose`/`--merge`, then exit. Absorbs
   `scripts/ar-run.sh`. `blockedBy: [isolation-strategy-seam,
   slug-namespace-resolution]`.
5. **`do-remote`** — `do --remote <r>`: materialise a mirror + job worktree in the
   agents' area (slice 2's job-worktree strategy, sharing `run`'s isolation);
   auto-`remote add` an unregistered remote. `blockedBy: [registry-remote,
   do-in-place]`.
6. **`do-autopick`** — `do` (no arg) auto-pick one eligible thing; `do <a> <b>…`
   in sequence; `do -n <x>`; the **slices-first then PRDs-to-slice** priority with
   the per-repo toggle (the same priority `run`'s tick + the autoslice path
   consume). `blockedBy: [do-in-place]`.
7. **`run-daemon-reframe`** — `run` = the forever-looping parallel daemon (loop the
   tick over the registry; `run --once` = one tick, no longer throwing); absorb the
   deleted `watch` verb's bounded-session + surface-failures concerns (route stuck
   items through the existing ledger needs-attention seam, surfaced on `main`).
   Retire `work/backlog/watch.md`. `blockedBy: [registry-remote]`.
8. **`human-face-verbs`** — add the `resume` verb (+ `start --resume` hidden alias);
   `--agent` interactive harness launch on `start`/`work-on`; `work-on` `cd`-by-
   default (with `--print-dir` the wrapper plumbing). `blockedBy:
   [slug-namespace-resolution]`.
9. **`flag-cleanup-renames`** — `return` → `requeue`; remove `--by`;
   `--ignore-not-ready` only (drop the `--force` readiness spelling); demote the
   advanced tier in help. `blockedBy: []` (but touches cli.ts — see conflict note).
10. **`scan-status-fetch-first`** — `scan`/`status` fetch-first (warn + fall back
    offline); retire the offline-scan invariant in docs/comments.
    `blockedBy: [registry-remote]`.

**Merge-conflict serialisation (cli.ts is the hot file).** Almost every slice
edits `cli.ts`. Logical deps already serialise most of them; for the remaining
independent-but-co-editing pairs the slicer should add `blockedBy` to serialise
against `cli.ts` rather than let them race (per ADR §10 / the to-slices
file-orthogonality rule). The slicer decides the exact chain at slice-write time,
but the spine is: `registry-remote` → (`run-daemon-reframe`, `scan-status-fetch-
first`, `do-remote`); `isolation-strategy-seam` + `slug-namespace-resolution` →
`do-in-place` → (`do-remote`, `do-autopick`); `slug-namespace-resolution` →
`human-face-verbs`; `flag-cleanup-renames` slotted into the cli.ts chain.

### Sequencing constraint (carried from the reconciliation note)

The backlog slices `autoslice-command` + `autoslice-confidence` are reshaped to
build against `do prd:<slug>` (slug resolution from slice 3 + the `do` path from
slice 4). They are **blocked on the `do` keystone** and MUST NOT be claimed before
`do-in-place` (and slug-namespace-resolution) land. `autoslice-gate` +
`autoslice-lock` + `brand-identity-single-source` are independent of phase 2 and
buildable now. The `watch` backlog slice is retired by `run-daemon-reframe`.

## Testing Decisions

> Also trimmed at slice-time (moves into slices' acceptance criteria). The durable
> testing discipline is the house pattern already in CONTEXT.md / AGENTS.md.

- **House pattern:** vitest; throwaway git repos + a local `--bare` arbiter (the
  claim-CAS verification pattern); a stubbed harness for any agent-launch path (no
  real model). Race/concurrency tests live in the NON-PARALLEL vitest project.
- **Registry:** `remote add` creates a mirror; the transport guard errors naming
  the existing transport; `remote ls` enumerates origin URLs; `remote find`
  discovers participating repos. Removing `roots` is proven by config tests that
  no longer reference it (and the registry-as-mirrors discovery path).
- **`do`:** in-place form claims+builds+gates+integrates+exits in a throwaway
  checkout against a `--bare` arbiter; `--remote` form materialises a mirror+job
  worktree in a temp agents' area; auto-pick/`-n`/multi-arg select the right items
  in the right (slices-first) order; slug resolution errors on a seeded
  slice/PRD collision.
- **`run`:** `run --once` runs one tick without throwing; the daemon loop honours
  its stop discipline; a failing item routes through the seam needs-attention path
  (assert the seam, not a bespoke reporter — the retired `watch` slice's
  acceptance criterion, preserved).
- **Human face:** `resume` switches to an in-progress branch without claiming;
  `--agent` invokes the (stubbed) harness in interactive mode and is asserted via
  the stub; `work-on --print-dir` still emits only the path.
- **Cleanup:** `requeue` behaves as `return` did; `--by` is gone; `--force` on
  claim/start/work-on is gone while `gc --force` still works; `--ignore-not-ready`
  overrides readiness.
- **fetch-first:** `scan`/`status` fetch and, on a simulated fetch failure, warn +
  fall back to last-known (proving the invariant retirement).

## Out of Scope

Exactly the ADR's already-deferred items — nothing more:

- **`install-ci`** (the CI workflow generator that wires `do --propose`) — its own
  PRD (`runner-in-ci`, reshaped in phase 1 to drive `do`, not `run --once`). This
  PRD ships the `do` command CI calls, not the workflow.
- **`setup` / `migrate` skills** — protocol-adoption is skill-layer (ADR §8), not a
  command; future, not this pass.
- **`doctor` command** — explicitly NOT decided in the ADR; clear docs of
  required-vs-recommended skills suffice until/unless it is decided.
- **A future protected-`main` ledger strategy** — the ledger seam exists
  (`docs/adr/claim-ledger-vs-protected-main.md`) but stays single-strategy; this
  PRD does not add a `ledgerMode`/mode concept.
- **Phase 3 (reconcile-the-code)** — the post-build drift-check across existing
  slices/code is a separate, later step (the build inventory in
  `work/observations/command-surface-reconciliation.md` doubles as its checklist).

## Further Notes

- Source of truth is `docs/adr/command-surface-and-journeys.md` (the §-numbers in
  the user stories point at it). This PRD is orientation + the slicing plan; the
  ADR + substrate ADRs hold the durable rationale.
- The phase-2 build inventory ("Current CODE that drifts") lives in
  `work/observations/command-surface-reconciliation.md`; it is the authoritative
  per-module change list and doubles as the phase-3 drift checklist. Do not delete
  that observation until all three phases are complete.
- `do` absorbing `scripts/ar-run.sh` retires the bash test-driver; the `do-in-place`
  slice should confirm the equivalence (CI's needs are met by `do --propose`).
