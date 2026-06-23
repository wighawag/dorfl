---
title: Claim ledger vs protected/propose main — introduce a ledger-transition seam
status: accepted
created: 2026-06-04
decided: 2026-06-04
supersedes:
superseded_by:
---

# ADR: introduce a ledger-transition seam (one strategy today; protected-main is a future possibility)

> **STATUS: accepted — for the SEAM decision.** A design session (2026-06-04) resolved the load-bearing question. The decision is deliberately MINIMAL: introduce a **ledger-transition seam** (a read seam + a write seam) inside agent-runner, behind which the **current behaviour is the ONLY strategy**. There is **no mode, no config, nothing selectable** — observable behaviour is byte-identical to today. The seam is **insurance**, not a feature: IF a future protected-`main` strategy is ever needed, it can slot in behind the seam without reworking the claim model.
>
> A protected-`main` strategy **does not exist and is not decided** — it is recorded below only as ANALYSIS ("A future protected-main strategy") so a later session has footing. This ADR does NOT introduce a `ledgerMode`/mode concept; the codebase must not grow one until/unless a second strategy is actually built. **Not currently blocking** (the maintainer rarely protects `main`).
>
> The sections below first record the VERIFIED contradiction that motivated this (still the _why_), then the decided seam.

## The contradiction (verified in code)

Two load-bearing parts of the system make OPPOSITE assumptions about `main`:

1. **The claim CAS WRITES `main`.** `claim-cas.ts` claims an item by pushing a micro-commit `claim/<slug>:main --force-with-lease=main:<base>` — moving `work/backlog/<slug>.md → work/in-progress/<slug>.md` _on `main`_. Claiming is a direct (force-with-lease) write to `main`.

2. **`propose` mode exists BECAUSE `main` is review-gated / branch-protected.** `integrator.ts` / `complete.ts`: `propose` (the DEFAULT) pushes the WORK BRANCH and opens a PR — deliberately NOT pushing `main`, because a human reviews/merges. The canonical reason to run `propose` is that `main` is **branch-protected** (the remote rejects direct pushes to `main`).

**Therefore:** on a repo with a protected `main` (exactly the repo `propose` mode serves), the claim push to `main` is **rejected by the server → no agent can claim anything.** The atomic-claim protocol silently requires write access to `main`, which protected/propose repos forbid. Today the system effectively only works where `main` is agent-writable.

This is bigger than the needs-attention-surfacing question that surfaced it (see `work/ideas/needs-attention-surfacing.md`): it is a flaw in the _claim model_ itself, not an error-path detail.

On a repo with an UNprotected `main` there is no contradiction — the CAS works as it does today. The contradiction is specific to protected/propose repos, which is why the resolution is a **seam** (so a different strategy COULD be added later for those repos), not a rewrite of the working behaviour.

## Root cause: two roles conflated onto `main`

`main` is being used for two roles with OPPOSITE access requirements:

- **the claim ledger** — the serialization point where `backlog → in-progress → done` transitions are CAS'd. Must be **agent-writable** (frequent automated micro-commits).
- **the integration target** — where finished _code_ lands. In `propose` mode this is **human-gated / protected**.

Forcing both onto one ref is the bug.

## Considered options (and why "a seam, not a rewrite")

1. **Unprotect `main` and accept it.** REJECTED as a _global_ answer: throws away the purpose of `propose` mode and is impossible where orgs mandate protection. But it IS a legitimate per-repo reality — it is simply the world the current behaviour already serves.

2. **Per-folder protection** (`main` writable for `work/**`, protected for `src/**`). REJECTED as a general mechanism: git branch protection is per-REF, not per-path. GitHub _push rulesets_ can restrict by path, but that is host-specific and breaks the "works against any arbiter (incl. a local `--bare`)" portability invariant.

3. **One global model that never writes `main`** (a single dedicated ledger ref for everyone). REJECTED: it imposes a new ref + its CAS + portability story on the common, unprotected-`main` repo that does not need it. The unprotected repo should keep paying nothing.

4. **Introduce a SEAM, keep one strategy (DECIDED).** Do not change behaviour at all. Put the three `work/` transitions behind a small internal seam so that the current `main`-writing behaviour is one (the only) strategy. A protected-`main` strategy is NOT built and NOT a selectable mode — the seam merely makes it _possible_ to add later without reworking the claim model. No config, no mode, no observable change.

## The decided design: a ledger-transition seam (one strategy)

The fix is a **purely internal seam** — NO config, NO `ledgerMode`, NO selectable mode. Observable behaviour is byte-identical to today; the current `main`-writing behaviour becomes the single strategy behind the seam.

The seam has two paired halves:

- **Write seam — `applyLedgerTransition(kind, from → to, …)`** for the three `work/` transitions: **claim** (`backlog → in-progress`), **complete** (`in-progress → done`, with code), **needs-attention** (`* → needs-attention`). The sole strategy writes `main` exactly as today (claim CAS to main; complete merges/ff to main; needs-attention move). The **claim primitive is part of the write seam** so a future strategy could supply a different `main`-free CAS — but TODAY there is one: the force-with-lease micro-commit to `main`.

- **Read seam — "resolve the live `work/` state for a repo."** The sole strategy reads the whole `work/` tree from `<arbiter>/main` exactly as today (offline). It exists so a future strategy could resolve some states from elsewhere (e.g. work-branch tips) without every reader (`scan`, eligibility, readiness, `gc`) knowing.

What this seam does NOT change (important):

- **`blockedBy` / eligibility / readiness are UNCHANGED** — still resolve against `<arbiter>/main:work/done/`.
- **`scan` stays OFFLINE** — reads `main`, no network. (A future protected-`main` strategy _would_ force network reads; that is one reason it is deferred, not a property of today's system.)
- **needs-attention** behaves exactly as today; the cherry-pick-to-`main` surfacing (the "easy add" in `work/ideas/needs-attention-surfacing.md`) is a SEPARATE follow-on built _against_ this seam, not part of introducing it.

**Shipping plan: the seam is a pure refactor.** Extract the read+write seam with the current behaviour as the only strategy; prove nothing changed (existing tests pass unchanged, transitions now route through the seam). The seam signatures stay at the SEMANTIC level ("resolve live state" / "apply this transition") and MUST NOT assume _where_ state is stored — so a future strategy is not foreclosed. The codebase MUST NOT grow a `ledgerMode`/mode concept as part of this work.

## A future protected-`main` strategy (ANALYSIS only — does NOT exist, NOT decided)

This section is **footing for a possible future session**, not a decision and not a committed feature. IF a protected-`main` strategy is ever built behind the seam, it must satisfy this firm boundary: _the claim and the agent-driven intermediate states (`in-progress`, `needs-attention`) must be served by a CAS substrate that **never writes `main`** and **works on both a real remote (GitHub) AND a local `--bare` arbiter**._ (Such a strategy would also make `scan` network-bound and would rely on `done`/`backlog` reaching `main` via merged PRs — the exact reasons it is more than a refactor and is therefore deferred.)

Two candidate substrates were discussed but **not chosen** (nothing here is built):

- **P-opt-1: per-item `work/<slug>` branch-existence as the claim.** "Claimed" ⇔ the `work/<slug>` branch exists on the arbiter (claim = a create-only push that the server rejects if it already exists). In-progress / needs-attention are read from each `work/*` branch tip's file location. No shared mutable ledger ref.
- **P-opt-2: a permanent dedicated ledger ref.** One agent-writable ref holding the `work/` folder tree (or just the intermediates), CAS-advanced like `main` is today. "Claimed" ⇔ the move landed on the ledger ref.

Open tensions for that future session to weigh (broad, not pre-judged):

- **Does branch-existence-as-in-progress (P-opt-1) violate "status = the folder"?** A ledger ref (P-opt-2) keeps status=folder everywhere; branch-existence encodes in-progress as a ref, not a file. (This is the sharpest tension.)
- **Ledger ↔ code-merge reconciliation/cleanup** — the intermediate signal and "done on `main`" would live on different refs/timelines; how are they reconciled if a PR merges but the intermediate wasn't cleaned up (or vice-versa)? (Same class as the issue→brief `Fixes #N` loop-closure question.)
- **`--bare` portability is a KILL-CRITERION**, not a differentiator — any candidate that cannot do its CAS on a local `--bare` arbiter is out.

**Maintainer's recorded lean (a starting bias, NOT a decision):** prefer the flavour that **preserves in-progress as a FILE** — i.e. P-opt-2 (a dedicated ledger _branch_ holding the `work/` folder tree), read over the network, **over** P-opt-1 (per-item branch-existence). Rationale: in-progress _visibility_ is the one property worth protecting; a ledger branch keeps status=folder intact (just on a different ref, network-read) whereas per-item refs abandon file-visibility entirely ("in-progress" becomes "a ref exists"). So if such a strategy is ever designed, the deciding question is "how much in-progress visibility do we want back" — and the maintainer leans toward keeping all of it. (Still subject to the kill-criterion and the reconciliation/cleanup tensions above.)

## Consequences

- **Nothing observable changes.** The seam is a pure refactor; the current behaviour (unprotected `main`, offline `scan`, `main` as the `work/` source of truth) is untouched and remains the only strategy.
- **The claim model stops being hard-wired to `main`-writing.** A future protected-`main` strategy becomes a _plug-in behind the seam_, not a rewrite — that is the entire payoff of doing this now.
- **Small standing cost:** one read/write indirection in the transition paths. No config, no mode enum, no new ref, no network read — those only arrive IF a future strategy is built.
- **needs-attention cherry-pick surfacing** (the `main`-mode "easy add") becomes a clean follow-on built _against_ the write seam, rather than bolted onto the transition code directly.
