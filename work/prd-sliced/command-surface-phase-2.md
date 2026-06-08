---
title: Command surface phase 2 — build the new surface (registry, run/do split, human face, cleanup)
slug: command-surface-phase-2
sliceAfter: []
sliced: 2026-06-05
---

> **Sliced into `work/backlog/` on 2026-06-05** — technical detail trimmed to the
> 11 slices (`registry-remote`, `isolation-strategy-seam`, `slug-namespace-
> resolution`, `do-in-place`, `do-remote`, `do-autopick`, `run-daemon-reframe`,
> `human-face-verbs`, `agent-interactive-launch` [`needsAnswers`-gated],
> `flag-cleanup-renames`, `scan-status-fetch-first`). Launch snapshot, NOT
> maintained. Current truth: `docs/adr/command-surface-and-journeys.md` (the model)
> + `docs/adr/` + the code; remaining work: those `work/backlog/` slices.
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
  (`ar-run.sh`);
- the human face is missing `resume` and `--agent`, and `work-on` does not `cd`
  you in by default;
- flags are inconsistent (`return` vs the clearer `requeue`; `--by`, which records
  the claimer in the claim commit's MESSAGE HEADER where it does not belong;
  `--force` overloaded for both a harmless readiness override AND the genuinely
  destructive `gc`);
- `scan`/`status` still assume the retired "scan is always offline" invariant.

Until the code matches the model, the surface a user touches is the old, confusing
one — and the reshaped backlog slices (`autoslice-command`; and the slicer
review/edit loop, `slicer-review-edit-loop`, which supersedes the former
`autoslice-confidence`) are blocked because they target a `do` command that does
not yet exist.

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
  absorbs `ar-run.sh`. `do <slug>` / `do prd:<slug>` (slice it) / `do`
  (auto-pick) / `do <a> <b>…` / `do -n <x>`; `--propose` (default) / `--merge`.
  Isolation by form: `do <slug>` in a checkout works **in-place** (the checkout is
  the isolation); `do --remote <r>` materialises a hub mirror + job worktree in
  the agents' area (the SAME isolation `run` uses).

- **Slug-namespace resolution (ADR §3a).** Bare `<slug>` = the slice (ERROR on a
  slice/PRD collision); `slice:<slug>` / `prd:<slug>` explicit. `do` spans both
  namespaces; slice-only commands reject `prd:`. CI/automation uses explicit
  prefixes.

- **The human face (ADR §4).** Add a `resume` verb (re-engage an in-progress item
  in the current checkout; `start --resume` becomes a hidden alias) and make
  `work-on` `cd` you in by default (via the shell wrapper; `--print-dir` is that
  wrapper's plumbing). **`--agent`** (launch the configured harness *interactively*
  on `start`/`work-on` — the human starts chatting with an agent, foreground,
  awaiting their first message, distinct from the autonomous prompt-fed launch) is
  ALSO ADR §4 but is **split into its own `needsAnswers`-gated slice**
  (`agent-interactive-launch`): it needs a NEW harness-seam capability (the current
  seam only does captured, prompt-fed, run-to-completion launches), and the shape of
  that capability is an open question — so it is captured as known-but-blocked work,
  not built in the first pass.

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
   so the ad-hoc `ar-run.sh` driver dies into it.
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
17. As the maintainer, I want `--by` AND the whole `claimedBy` concept removed from
    claim/start/work-on (the flag, the `(by ...)` claim-commit-subject suffix, and
    the `claimedByFromCommit` readback), so that the claimer lives in git history
    (read with `git log`) rather than in our commit-message header or a bespoke
    `claimedBy` abstraction; the in-progress refusal message just points at
    `git log`.
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
  agent-buildable on their own merits — see the slicing plan. One slice carries an
  honest `needsAnswers: true`: `agent-interactive-launch` (the `--agent` flag) is
  blocked on an open harness-seam design question (the current seam does not support
  interactive launch), so it is captured as known-but-blocked rather than built
  blind. The other ten are agent-buildable now.)
- **`needsAnswers`:** NONE OPEN. The ADR settles every decision this PRD builds
  (the registry model, the run/do split, slug resolution, the human-face verbs,
  the flag cleanup, fetch-first). Omitted.

## The slicing plan (file-orthogonal; `do-in-place` is the keystone)

> What-to-build detail now lives in the 10 slices; durable rationale is in
> `docs/adr/command-surface-and-journeys.md` + the substrate ADRs. This section is
> kept as the durable MAP of the phase-2 build (the slice set + its dependency
> spine), since the slicing structure itself is part of this PRD's framing.

Eleven slices. Ten are agent-buildable now (each is wiring/logic testable with
throwaway repos + a local `--bare` arbiter + stubbed harness — the house pattern);
one (`agent-interactive-launch`, the `--agent` flag) is honestly `needsAnswers:
true`, blocked on an open harness-seam design question. Dependency spine (logical
deps + `cli.ts`-hot-file serialisation, ADR §10):

| slice | blockedBy | covers |
| --- | --- | --- |
| `registry-remote` | — | 1–5 |
| `isolation-strategy-seam` | — | 6 |
| `slug-namespace-resolution` | — | 7 |
| `do-in-place` (KEYSTONE) | isolation-strategy-seam, slug-namespace-resolution | 8, 11 |
| `do-remote` | registry-remote, do-in-place | 9 |
| `do-autopick` | do-in-place, do-remote, autoslice-gate | 10 |
| `run-daemon-reframe` (retires watch) | registry-remote | 12 |
| `human-face-verbs` | slug-namespace-resolution | 13, 15 |
| `agent-interactive-launch` (`needsAnswers`) | human-face-verbs | 14 |
| `flag-cleanup-renames` | registry-remote | 16–19 |
| `scan-status-fetch-first` | registry-remote | 20 |

The spine: `registry-remote` is the foundation (and serialises the other `cli.ts`
edits after it); `isolation-strategy-seam` + `slug-namespace-resolution` →
`do-in-place` → `do-remote` → `do-autopick` (the three `do-*` slices are a SERIAL
chain, not a fan-out: all three edit the one `.command('do')` block in `cli.ts`
— its argument grammar — so they must not be co-edited in parallel; `do-autopick`
also needs `autoslice-gate` for the PRD slicing-eligibility predicate);
`slug-namespace-resolution` → `human-face-verbs` → `agent-interactive-launch`
(the last `needsAnswers`-gated, so not agent-claimable until the seam question is
answered).

### Implementation realities surfaced during slicing (read before building)

A code-grounded review found several places where the obvious framing is wrong;
the slices encode these, but they are recorded here as durable warnings:

- **There is no PRD reader today.** The read seam (`ledger-read.ts`) + `scan.ts`
  read only `backlog`/`done`/`needs-attention`, NEVER `work/prd/`. `slug-namespace-
  resolution` ADDS the PRD-existence reader; `do-autopick` (PRDs-to-slice pool) and
  the autoslice slices reuse it. Do not assume an existing reader covers PRDs.
- **The scan/candidate model is slice-only.** `selectCandidates`/eligibility know
  nothing of PRDs. `do-autopick`'s "slices-first then PRDs-to-slice" is TWO pools:
  the existing slice pool + a NEW PRD pool (PRD reader + `autoslice-gate` predicate).
- **The three `do-*` slices share ONE command grammar + `do` is AUTONOMOUS.** All
  of `do-in-place`/`do-remote`/`do-autopick` edit the single `.command('do')` block
  (args: `<slug>` → `--remote` → variadic + `-n`), so they are a SERIAL chain, not
  parallel. AND because `do` runs unattended (the CI command), its needs-attention
  routing must be the AUTONOMOUS, arbiter-passed surfacing like `run` — composing
  `performComplete` (the human path, no arbiter → no on-`main` surfacing) verbatim
  is insufficient for `do`'s failure path; pass the arbiter or use `run`'s routing.
- **The slices-first/PRD priority helper is owned by `do-autopick`; `run`'s
  adoption is a FOLLOW-UP.** ADR §3 wants both `run` and `do` to do "slices-first,
  then PRDs to slice," but the two-pool helper needs `autoslice-gate` + the PRD
  reader (deps `do-autopick` has, `run-daemon-reframe` does not). Since
  `run-daemon-reframe` lands earlier, `run`'s tick ships SLICE-ONLY (concurrent +
  looped); wiring `run` to adopt `do-autopick`'s shared slices-first helper (so
  `run` also auto-slices eligible PRDs) is a small **follow-up integration** once
  both are in `done/`. Neither slice silently overclaims the other's work.
- **`do` SUPERSEDES `ar-run.sh` but does NOT delete it.** `ar-run.sh` (repo root)
  is the maintainer's live manual slice-driver; `do-in-place` makes `do` its
  documented equivalent but leaves the `git rm` as a maintainer-owned cleanup once
  `do` is proven (an AFK slice must not delete the human's working tooling).
- **Hub mirrors are BARE — `scan`/`status` must read `work/` from a REF, not a
  working tree.** Today `scan` reads a local CHECKOUT via
  `resolveLocalState`'s `readdirSync`. A mirror has no working tree, so
  `registry-remote` ADDS a read-seam capability to resolve full `work/` (backlog +
  done + needs-attention) from the mirror's `main` ref via `git ls-tree`/`show`
  (proven against a real bare mirror; read the mirror-LOCAL `main:`, not
  `origin/main:`). `scan-status-fetch-first` only adds the fetch before that read.
- **`--by` and the whole `claimedBy` concept are removed ENTIRELY.** `--by` was
  never dead — it fed the claim commit subject `(by ...)`, parsed back by
  `claimedByFromCommit` for one refusal message. The claimer belongs in git
  history, not our commit header or a bespoke abstraction: `flag-cleanup-renames`
  drops the flag, the `(by ...)` suffix (→ `claim: <slug>`), AND deletes
  `claimedByFromCommit` + its var/comments (not renamed/re-pointed). The
  in-progress refusal message points at `git log`. (A richer "who holds it"
  readback, if ever wanted, is a separate future pass.)
- **In-place `do` ≈ `start` + (autonomous harness run) + `complete`.** `ar-run.sh`
  (the script `do` absorbs) is exactly that, with a DIRTY-TREE REFUSAL. `do-in-place`
  composes the existing human verbs rather than re-deriving `runOneItem`; the
  `isolation-strategy-seam` handle removes the `Job`-shape coupling so the shared
  post-claim steps serve both in-place and job-worktree.
- **`run`'s concurrency is REQUIRED but currently UNBUILT.** Concurrency is the
  whole point of `run` (multiple agents in parallel on non-interacting slices). But
  `runOnce` is SEQUENTIAL today (`for (const candidate) { await runOneItem }`) — it
  selects up to `maxParallel` but runs them one at a time. `run-daemon-reframe` MUST
  make the tick genuinely concurrent (up to `maxParallel` in flight, `perRepoMax`
  per repo); the substrate (distinct-slug worktrees, arbiter-CAS claim) is already
  parallel-ready, so it is execution wiring + the concurrency hazards (claim-race,
  worktree isolation, independent rebase-or-abort integration), not a model change.
- **Interactive `--agent` is a NEW harness-seam capability** (the current `launch`
  is `spawnSync`+captured+prompt-fed) — hence its own `needsAnswers`-gated slice.
- **`work-on` migrates positional `<remote> <slug>` → the `--remote` flag** (ADR §4;
  consistent with `do --remote`) in `human-face-verbs`.
- **`remote ls` reads each origin URL from the mirror** (`git remote get-url`), not
  from the LOSSY key (which drops scheme/transport).

## Sequencing constraint (carried from the reconciliation note)

The backlog slices `autoslice-command` + `slicer-review-edit-loop` (the latter
supersedes the former `autoslice-confidence`, folding in its needsAnswers /
needs-attention routing — see `work/prd/review.md`) are reshaped to build against
`do prd:<slug>` (slug resolution from slice 3 + the `do` path from slice 4). They
are **blocked on the `do` keystone** and MUST NOT be claimed before `do-in-place`
(and slug-namespace-resolution) land. `autoslice-gate` +
`autoslice-lock` + `brand-identity-single-source` are independent of phase 2 and
buildable now. The `watch` backlog slice is retired by `run-daemon-reframe`.

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
- `do` absorbing `ar-run.sh` retires the bash test-driver; the `do-in-place`
  slice should confirm the equivalence (CI's needs are met by `do --propose`).
