---
title: Claim ledger vs protected/propose main — the CAS writes main, which propose mode forbids
status: proposed
created: 2026-06-04
supersedes:
superseded_by:
---

# ADR (PROPOSED): the claim CAS writes `main`, contradicting `propose` mode / protected `main`

> **STATUS: proposed.** This records a VERIFIED architectural contradiction and a
> recommended resolution DIRECTION — it is NOT yet an accepted decision. It needs a
> dedicated design session (likely revising the claim model in the `agent-runner`
> PRD) to flip to `accepted` (with a chosen option) or be superseded. Captured now
> so the contradiction is not lost. **Not currently blocking** (the maintainer
> rarely protects `main`), but a valid concern for the many repos that do.

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

## Root cause: two roles conflated onto `main`

`main` is being used for two roles with OPPOSITE access requirements:

- **the claim ledger** — the serialization point where `backlog → in-progress →
  done` transitions are CAS'd. Must be **agent-writable** (frequent automated
  micro-commits).
- **the integration target** — where finished *code* lands. In `propose` mode this
  is **human-gated / protected**.

Forcing both onto one ref is the bug.

## Considered options

1. **Unprotect `main` and accept it.** REJECTED: throws away the entire purpose of
   `propose` mode (human review before code lands) and is impossible where orgs
   mandate protection. Solves the contradiction by deleting one side of it.

2. **Per-folder protection** (`main` writable for `work/**`, protected for
   `src/**`). REJECTED as a general mechanism: git branch protection is per-REF,
   not per-path. GitHub *push rulesets* can restrict by path, but that is
   host-specific and breaks the "works against any arbiter (incl. a local
   `--bare`)" portability invariant.

3. **Surface/transition via cherry-pick or move-only commits to `main`.** REJECTED
   for the same reason as (1): any mechanism that writes `main` on the
   claim/needs-attention path is illegal under propose/protected main.

4. **Split the refs (RECOMMENDED DIRECTION).** Separate the **claim ledger** from
   the **code integration target**:
   - **Claim/ledger transitions** serialize on a DEDICATED agent-writable ref (an
     unprotected `agent-runner` ledger branch, or per-item `refs/...` claim refs) —
     never `main`. This is where `backlog → in-progress` (and the eligibility
     `work/done/` state) is CAS'd.
   - **`main` carries only reviewed CODE.** Completion rides on the PR (**model
     B**, below): the agent pushes the work branch (code + the `→ done` move) and
     opens a PR; when the human MERGES the PR, `main` gets the code AND the done-
     move together via the *permitted* merge path (protection allows reviewed
     merges, not direct pushes). So the runner never needs a direct `main` write.

## Recommended direction (to be ratified in the design session)

- **Model B for completion:** `done` (and needs-attention surfacing) ride on the
  PR / work branch — the runner never pushes `main` directly. This is
  protection-compatible and subsumes the needs-attention-surfacing idea (status is
  read from work branches, never written to main).
- **A dedicated claim-ledger ref for the `backlog → in-progress` CAS**, since
  claiming cannot wait for a PR and must not write `main`.
- `main` becomes "what has been reviewed-and-merged"; the ledger ref carries the
  claim serialization.

## Open questions for the design session (NOT yet decided)

- **Where does `work/` live** — entirely on the ledger ref, on both, or split
  (`backlog`/`in-progress` on the ledger, `done` arriving on `main` via PR merge)?
  This is the crux and is unresolved.
- **`blocked_by` resolves against `work/done/` — on which ref?** Every `work/`-read
  (`scan`, eligibility, readiness) must target the right ref(s).
- **How do the ledger timeline and the code-merge timeline reconcile** in propose
  mode (PR merged vs ledger `done`)? (Same class as the issue→PRD `Fixes #N`
  loop-closure question.)
- **Does this break the current "work commit + done-move = ONE atomic commit"
  invariant** (it would become two writes to two refs)? Acceptable?
- **Ledger ref portability** across a real remote (GitHub) AND a local `--bare`
  arbiter — the CAS mechanism must work on both, like the current `main` CAS does.
- **Does this reshape the `agent-runner` PRD's claim model** (likely yes)?

## Consequences if adopted

- The claim protocol works on protected-`main` / `propose` repos (the current
  silent limitation is lifted).
- needs-attention surfacing falls out naturally (read work branches; never write
  main) — `work/ideas/needs-attention-surfacing.md` becomes implementable.
- A new ref to provision/manage per repo (ledger), with its own CAS + portability
  story; more moving parts than the single-`main` model.
