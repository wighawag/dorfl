---
title: Claim ledger vs protected/propose main — two ledger modes (M default, P deferred)
status: accepted
created: 2026-06-04
decided: 2026-06-04
supersedes:
superseded_by:
---

# ADR: two ledger modes (M = main-writable, default; P = protected-main, deferred)

> **STATUS: accepted — for the SEAM decision.** A design session (2026-06-04)
> resolved the load-bearing question: agent-runner supports **two ledger modes**
> behind a mode seam, with **mode M (main-writable) as the default and essentially
> today's system**, and **mode P (protected-main)** added behind the same seam.
> The seam (read + write) is decided and shippable now with only M behind it.
> **Mode P's internal CAS substrate is DELIBERATELY DEFERRED** (recorded broadly
> in "Mode P — deferred" below) — to be chosen in a future dedicated session. So
> this ADR is `accepted` for *the two-mode seam*, with P's implementation left
> open. **Not currently blocking** (the maintainer rarely protects `main`); the
> default path (M) is unchanged.
>
> The sections below first record the VERIFIED contradiction that motivated this
> (still the *why*), then the decided two-mode design.

## The contradiction (verified in code)

Two load-bearing parts of the system make OPPOSITE assumptions about `main`:

1. **The claim CAS WRITES `main`.** `claim-cas.ts` claims an item by pushing a
   micro-commit `claim/<slug>:main --force-with-lease=main:<base>` — moving
   `work/backlog/<slug>.md → work/in-progress/<slug>.md` *on `main`*. Claiming is a
   direct (force-with-lease) write to `main`.

2. **`propose` mode exists BECAUSE `main` is review-gated / branch-protected.**
   `integrator.ts` / `complete.ts`: `propose` (the DEFAULT) pushes the WORK BRANCH
   and opens a PR — deliberately NOT pushing `main`, because a human reviews/merges.
   The canonical reason to run `propose` is that `main` is **branch-protected** (the
   remote rejects direct pushes to `main`).

**Therefore:** on a repo with a protected `main` (exactly the repo `propose` mode
serves), the claim push to `main` is **rejected by the server → no agent can claim
anything.** The atomic-claim protocol silently requires write access to `main`,
which protected/propose repos forbid. Today the system effectively only works
where `main` is agent-writable.

This is bigger than the needs-attention-surfacing question that surfaced it (see
`work/ideas/needs-attention-surfacing.md`): it is a flaw in the *claim model*
itself, not an error-path detail.

On a repo with an UNprotected `main` (mode M), there is no contradiction — the CAS
works as it does today. The contradiction is specific to protected/propose repos
(mode P), which is exactly why the resolution is a **mode**, not a global rewrite.

## Root cause: two roles conflated onto `main`

`main` is being used for two roles with OPPOSITE access requirements:

- **the claim ledger** — the serialization point where `backlog → in-progress →
  done` transitions are CAS'd. Must be **agent-writable** (frequent automated
  micro-commits).
- **the integration target** — where finished *code* lands. In `propose` mode this
  is **human-gated / protected**.

Forcing both onto one ref is the bug.

## Considered options (and why "make it a mode")

1. **Unprotect `main` and accept it.** REJECTED as a *global* answer: throws away
   the purpose of `propose` mode and is impossible where orgs mandate protection.
   But it IS a legitimate *per-repo choice* — that is mode M.

2. **Per-folder protection** (`main` writable for `work/**`, protected for
   `src/**`). REJECTED as a general mechanism: git branch protection is per-REF,
   not per-path. GitHub *push rulesets* can restrict by path, but that is
   host-specific and breaks the "works against any arbiter (incl. a local
   `--bare`)" portability invariant.

3. **One global model that never writes `main`** (a single dedicated ledger ref
   for everyone). REJECTED as the *default*: it imposes a new ref + its CAS +
   portability story on the common, unprotected-`main` repo that does not need it.
   The unprotected repo should keep paying nothing.

4. **TWO MODES behind one seam (DECIDED).** The protection question is a
   per-repo *property of the arbiter*, so make it an explicit per-repo **mode**,
   not a global rewrite:
   - **Mode M (`ledgerMode: M`, the DEFAULT) — main-writable.** Essentially
     today's system: `main` is the source of truth for the whole `work/` tree;
     claim = the force-with-lease micro-commit to `main`; needs-attention can be
     surfaced on `main` via the cherry-pick mechanism (see
     `work/ideas/needs-attention-surfacing.md`, an easy add). No new refs, no
     network reads. The default path is unchanged.
   - **Mode P (`ledgerMode: P`) — protected `main`.** Nothing writes `main`
     directly; anything main-bound lands via a *merged PR*. The agent-driven
     intermediate states (**in-progress, needs-attention**) never reach `main` in
     P — they live on `work/<slug>` branches and are read over the network. P's
     internal CAS substrate is **deferred** (see "Mode P — deferred").

## The decided design: one mode seam (read + write), default M

The fix is a **mode seam** keyed off an explicit `ledgerMode` config (resolved
like `integration`: flag > per-repo > global > **default M**; NO auto-detection —
a protected-`main` rejection must never be inferred silently, or we recreate the
exact silent failure this ADR names).

The seam has two paired halves:

- **Write seam — `applyLedgerTransition(kind, from → to, …)`** for the three
  `work/` transitions: **claim** (`backlog → in-progress`), **complete**
  (`in-progress → done`, with code), **needs-attention** (`* → needs-attention`).
  - In **M**: writes `main` directly (claim CAS to main; complete merges/ff to
    main; needs-attention cherry-picks to main).
  - In **P**: never writes `main` — claim + intermediates land on `work/<slug>`
    branches; `done` rides the completion PR merge.
  - The **claim primitive is part of the write seam** and may differ by mode
    (M = force-with-lease micro-commit to `main`; P = a `main`-free CAS, substrate
    deferred). Claiming is **CAS / first-writer-wins in both modes** — atomicity
    is non-negotiable.

- **Read seam — "resolve the live `work/` state for a repo."** Both modes read
  **`backlog` and `done` from `<arbiter>/main`** (in P these reach `main` via
  human/auto-slicer PRs and the completion PR merge respectively). The split is
  only for the agent-driven intermediates:
  - **M**: in-progress / needs-attention read from `main` (offline).
  - **P**: in-progress / needs-attention read from the arbiter over the **network**
    (the `work/*` branch tips), because they never reach `main`.

Key consequences of this split, decided:

- **`blockedBy` / eligibility / readiness are UNCHANGED.** `done` reaches `main`
  in BOTH modes (via the PR merge in P), so they keep resolving against
  `<arbiter>/main:work/done/` exactly as today. (This open question is therefore
  **resolved**: done-on-main is mode-independent.)
- **`scan` is as authoritative as the mode allows.** Offline-from-`main` in M;
  **network-bound in P** — because `scan` exists to feed a *claim* decision, and a
  `scan` that cannot distinguish claimable-from-claimed in P would mislead at the
  moment of action. So **"offline `scan`" is a property of mode M, not a global
  invariant** — the doc text that calls `scan` unconditionally offline must be
  re-scoped to "offline in M" (incl. `work/ideas/needs-attention-surfacing.md`).
- **needs-attention surfacing is subsumed.** It is just "read the P intermediate
  state" (M surfaces it on `main` via cherry-pick). `work/ideas/needs-attention-
  surfacing.md` becomes "implement against the mode read seam," not a standalone
  design.

**Shipping plan: seam now, P-strategy later.** Ship the read+write seam with ONLY
the M strategy behind it (M ≈ current behaviour, wrapped). P becomes a later slice
that plugs in the second strategy. The seam signatures stay at the SEMANTIC level
("resolve live state" / "apply this transition") and MUST NOT assume *where* P
stores anything — so the deferred P substrate choice is not foreclosed.

## Mode P — deferred (recorded broadly, NOT yet decided)

Mode P's internal CAS substrate is **left open** for a future dedicated session.
The firm boundary it must satisfy: *in P, the claim and the agent-driven
intermediate states (`in-progress`, `needs-attention`) must be served by a CAS
substrate that **never writes `main`** and **works on both a real remote (GitHub)
AND a local `--bare` arbiter**.*

Two candidate substrates were discussed but **not chosen**:

- **P-opt-1: per-item `work/<slug>` branch-existence as the claim.** "Claimed" ⇔
  the `work/<slug>` branch exists on the arbiter (claim = a create-only push that
  the server rejects if it already exists). In-progress / needs-attention are read
  from each `work/*` branch tip's file location. No shared mutable ledger ref.
- **P-opt-2: a permanent dedicated ledger ref.** One agent-writable ref holding
  the `work/` folder tree (or just the intermediates), CAS-advanced like `main` is
  today. "Claimed" ⇔ the move landed on the ledger ref.

Open tensions for the future P session to weigh (broad, not pre-judged):

- **Does branch-existence-as-in-progress (P-opt-1) violate "status = the folder"?**
  A ledger ref (P-opt-2) keeps status=folder everywhere; branch-existence encodes
  in-progress as a ref, not a file. (This is the sharpest tension.)
- **Ledger ↔ code-merge reconciliation/cleanup in P** — the intermediate signal
  and "done on `main`" live on different refs/timelines; how are they reconciled
  if a PR merges but the intermediate wasn't cleaned up (or vice-versa)? (Same
  class as the issue→PRD `Fixes #N` loop-closure question.)
- **`--bare` portability is a KILL-CRITERION**, not a differentiator — any P
  candidate that cannot do its CAS on a local `--bare` arbiter is out.

## Consequences

- The common case (unprotected `main`, mode M) keeps paying **nothing**: no new
  refs, no network reads, behaviour unchanged. The default is the cheap path.
- Protected-`main` / `propose` repos become **supportable** (mode P) instead of
  silently broken — once P's deferred substrate is designed and built.
- The seam adds one explicit `ledgerMode` config and a read/write indirection;
  the cost is small and is the insurance that P is a later *slice*, not a rewrite
  of the claim model.
- `scan`'s offline guarantee is **re-scoped to mode M** (network-bound in P);
  docs asserting unconditional offline `scan` need that correction.
- needs-attention surfacing becomes implementable as a consequence of the read
  seam (M: cherry-pick to main; P: read the work branches).
