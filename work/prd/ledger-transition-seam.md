---
title: Ledger-transition seam — route the three work/ transitions through a read+write seam (pure refactor)
slug: ledger-transition-seam
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth:
> `docs/adr/` (decisions) + the code; remaining work: `work/backlog/` slices.
> (The technical-detail sections below are trimmed by `to-slices` once the work
> is sliced — they move into slices/ADRs and this PRD settles to its durable
> framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

Today the three `work/` lifecycle transitions are **hard-wired to write the
arbiter's `main`**:

- **claim** (`backlog → in-progress`) is a `--force-with-lease` micro-commit to
  `main` (`claim-cas.ts`),
- **complete** (`in-progress → done`, with the agent's code) merges/ff's the work
  branch to `main` (`complete.ts` / `integrator.ts`),
- **needs-attention** (`* → needs-attention`) moves on the work branch and (in the
  surfacing follow-on) would cherry-pick to `main`.

And every **reader** of `work/` state (`scan`, `eligibility`, `readiness`, `gc`)
reads the tree directly from `<arbiter>/main`.

That hard-wiring is the root cause recorded in
`docs/adr/claim-ledger-vs-protected-main.md` (accepted): `main` is conflated as
both the **claim ledger** (must be agent-writable) and the **code integration
target** (often human-gated / branch-protected). On a protected-`main` repo, the
claim push is rejected and no agent can claim. We are NOT fixing protected-`main`
now — but we want the ability to add a different transition strategy LATER without
rewriting the claim model. To make that possible, the transitions and the state
reads must go through a **seam**, not be hard-wired.

This is a pure-refactor enabler: it changes NO observable behaviour. It is the
prerequisite that makes a future protected-`main` strategy a plug-in rather than a
rewrite — and makes the M-mode needs-attention cherry-pick surfacing a clean
follow-on (`needs-attention-cherry-pick`, sliced after this).

## Solution

Introduce a **ledger-transition seam** inside agent-runner with two paired halves,
behind which the **current behaviour is the ONLY strategy**. There is **no mode,
no config, nothing selectable**. Observable behaviour is byte-identical to today.

- **Write seam** — a single entry point for applying a `work/` transition (claim /
  complete / needs-attention). The sole strategy does exactly what the code does
  today (claim CAS to `main`; complete merges/ff to `main`; needs-attention move).
  The claim primitive lives behind this seam so a future strategy could supply a
  different `main`-free CAS — but today there is one (force-with-lease to `main`).

- **Read seam** — a single "resolve the live `work/` state for a repo" entry point
  that the existing readers go through. The sole strategy reads the `work/` tree
  from `<arbiter>/main` exactly as today (offline). It exists so a future strategy
  could resolve some states elsewhere (e.g. work-branch tips) without every reader
  learning a new mechanism.

The seam signatures stay at the **semantic** level ("apply this transition" /
"resolve live state") and MUST NOT assume *where* state is stored — so a future
strategy is not foreclosed. The codebase MUST NOT grow a `ledgerMode`/mode concept
as part of this work (per the ADR).

## User Stories

1. As a maintainer, I want the three `work/` transitions (claim, complete,
   needs-attention) to be applied through ONE internal write-seam entry point, so
   that the `main`-writing behaviour is a *strategy* and not hard-wired into each
   call site.
2. As a maintainer, I want the claim CAS (`claim-cas.ts`'s force-with-lease
   micro-commit) to sit behind the write seam as the sole strategy, so a future
   `main`-free claim CAS could replace it without touching callers.
3. As a maintainer, I want `complete`'s integration (merge/ff to `main`, propose
   push) to be expressed as the write seam's complete-transition, so completion is
   strategy-pluggable later without reworking `complete.ts`.
4. As a maintainer, I want needs-attention routing to go through the write seam,
   so the later cherry-pick-to-main surfacing is built *against* the seam rather
   than bolted onto the move code.
5. As a maintainer, I want all `work/` state reads (`scan`, `eligibility`,
   `readiness`, `gc`) to go through ONE read-seam entry point, so a future
   strategy could resolve some states from elsewhere without each reader knowing.
6. As a maintainer, I want the refactor to be **behaviour-identical** — the entire
   existing test suite passes unchanged — so I can trust nothing regressed.
7. As a maintainer, I want NO new config, NO `ledgerMode`/mode enum, and NO new
   ref or network read introduced by this work, so the seam is pure insurance and
   the common path keeps paying nothing.
8. As a maintainer, I want the seam's read/write signatures to be storage-agnostic
   (semantic verbs, no "where it lives" assumptions), so a future protected-`main`
   strategy can slot in behind them.
9. As a maintainer, I want `scan` to stay OFFLINE (read `main`, no network) after
   the refactor, so the fast cross-repo queue is unchanged.
10. As a maintainer, I want the seam wired so the autonomous runner
    (`run-once`/`watch`) and the human path (`start`/`complete`/`work-on`) both
    drive transitions through the SAME seam, so there is one transition mechanism,
    not two.

### Autonomy notes (the two gate axes)

- **`humanOnly`:** OMITTED. This is a well-specified internal refactor with a
  clear acceptance test (existing suite green, transitions routed through the
  seam). No product/design/security judgement is required. Agent-sliceable and
  agent-buildable.
- **`needsAnswers`:** OMITTED. The seam shape (read seam + write seam, one
  strategy, no mode/config) is fully decided in the accepted ADR. No open
  questions remain for THIS refactor — every open question lives in the *future*
  protected-`main` strategy, which is explicitly out of scope here.

## Implementation Decisions

(From the accepted ADR `claim-ledger-vs-protected-main.md` — do not relitigate.)

- **Two seams, paired:** a write seam (`applyLedgerTransition`-style, one method
  per transition or one tagged entry) and a read seam ("resolve live `work/`
  state"). Both keyed to a single internal strategy = current behaviour.
- **No mode, no config, no `ledgerMode`.** Nothing selectable; nothing observable
  changes. This is enforced as an explicit non-goal.
- **Claim primitive moves behind the write seam** but is unchanged (force-with-
  lease micro-commit to `main`, identical exit-code semantics to `claim.sh`).
- **Readers refactored to one entry point:** `scan`, `eligibility`, `readiness`,
  `gc` resolve `work/` state via the read seam; the sole strategy reads
  `<arbiter>/main` exactly as today (offline). `blockedBy`/eligibility/readiness
  semantics UNCHANGED.
- **Signatures storage-agnostic:** the seam must not encode "main" into its public
  shape; "main" is an implementation detail of the one strategy.
- **`scripts/claim.sh` is untouched** (it remains the portable bootstrap; the seam
  is an in-process agent-runner concern, ADR §9).

## Testing Decisions

- **The headline acceptance test is "nothing changed":** the existing suite —
  including the claim-CAS race tests against throwaway repos + a local `--bare`
  arbiter, and the complete/integrate tests — passes UNCHANGED. The refactor is
  wrong if any existing behavioural test needs editing (other than mechanical
  import/call-site moves).
- **Add seam-level tests** asserting each transition (claim/complete/needs-
  attention) is dispatched through the write seam, and each reader goes through the
  read seam — so the indirection is real and a future strategy has a single
  insertion point. Stub/observe the strategy to prove dispatch without changing
  outcomes.
- **Race/concurrency tests stay in the non-parallel vitest project** (do not
  reintroduce file-parallelism flakiness; do not mask with retry) — the claim CAS
  moving behind the seam must keep its genuine two-claimer race test.
- Keep `claim.sh` parity intact (the in-process claim still matches the shell
  reference's exit codes).

## Out of Scope

- **Any protected-`main` strategy.** No second strategy is built. The seam has
  exactly one strategy (current behaviour). The protected-`main` analysis is
  recorded in the ADR's "future protected-`main` strategy" section ONLY.
- **`ledgerMode` / any mode or config.** Explicitly not introduced.
- **needs-attention cherry-pick-to-main surfacing.** That is the separate
  `needs-attention-cherry-pick` PRD, sliced AFTER this one (it builds against this
  seam). See `work/ideas/needs-attention-surfacing.md`.
- **Any network read / new ref / `scan` behaviour change.** None of these are part
  of the refactor; they would only ever arrive with a future strategy.
- **Changing `claim.sh`** or the `work/` contract / WORK-CONTRACT.md.

## Further Notes

- Source ADR: `docs/adr/claim-ledger-vs-protected-main.md` (status: accepted) —
  the seam is "option 4" there; its "future protected-`main` strategy" section is
  the analysis a later session would build on, NOT part of this PRD.
- Touch points to seam: `claim-cas.ts` (write/claim), `complete.ts` +
  `integrator.ts` (write/complete), `needs-attention.ts` (write/needs-attention),
  and `scan.ts` / `eligibility.ts` / `readiness.ts` / `gc.ts` (read).
- Companion observation `work/observations/docs-assume-single-main-ledger.md`
  lists the doc cross-references to add when this refactor lands (and should be
  deleted once they are added).
- The follow-on `needs-attention-cherry-pick` PRD carries
  `sliceAfter: [ledger-transition-seam]` so it is sliced only after this seam's
  slices exist (so its slices can `blockedBy` the real seam slugs). This ordering
  is itself a deliberate test of the `sliceAfter` mechanism.
