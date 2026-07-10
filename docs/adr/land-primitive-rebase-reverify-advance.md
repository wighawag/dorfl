---
title: Land = rebase + re-verify + advance — one primitive, two frontends, with a git-alone floor and a host-accelerated ceiling
status: accepted
created: 2026-06-26
decided: 2026-06-26
supersedes:
superseded_by:
---

# ADR: The land-time re-verify doctrine

## Context

The integration engine has, since its first cut, gated every landing on a
**re-verify of the rebased tip** — the work branch rebased onto current
`<arbiter>/main` (the would-be-merged tree), with `verify` (and a relocated
review) run there. A moved-`main` mid-push re-rebases and re-gates via a bounded
CAS retry loop; a `--force` to `main` and an auto-resolved conflict are forbidden
(see ADR §10 of `execution-substrate-decisions.md`). All of this already works.

But the doctrine was never written down. The protocol docs (`WORK-CONTRACT.md`,
`CLAIM-PROTOCOL.md`) said "done is green", which a future reader could
reasonably parse as "the build-time gate passed" — making the load-bearing
re-gate read as accidental engine behaviour rather than a stated invariant. The
spec `land-time-reverify-and-parallel-merge-ceiling` names this gap and three
others stacked on top of it (CI parallel-merge shape, propose PR-merge-time
safety, runner-as-merger for bare hosts). This ADR captures the DURABLE WHY
behind the whole stack — the principle, the primitive, the two frontends, and
the floor/ceiling gradient — so a refactor cannot silently regress to trusting
a clean rebase.

The shared insight: **a clean `git` merge AND a human-approved diff both
validate a change in the context it was AUTHORED, never the context it will
LIVE.** Neither `git`'s clean-merge exit code nor a human reading a PR diff
catches the merge that applies cleanly but is semantically broken (task A
renames a symbol, task B adds a caller of the old name; both rebase clean; the
merged tree fails to build). `blockedBy` only guards conflicts the author
PREDICTED; semantic coupling is exactly the class you do not predict. The only
proof a change is correct in the tree it lands in is **re-running acceptance on
the post-rebase tree.**

## Decision

### 1. The principle: authored-context vs lived-context

A change is correct in the tree it LANDS IN only when its acceptance is
re-run on THAT tree. The tree the change was authored against, and the tree a
human reviewed, are both the AUTHORED context; the tree on `main` at the
moment of advance is the LIVED context. They are only the same tree by
coincidence — and the moment they diverge, every prior "green" is provisional
until re-checked on the new merge-base. `git merge`'s clean exit and a human's
PR approval are signals ABOUT the authored context; neither is evidence about
the lived one.

### 2. The primitive

There is exactly one landing primitive, mode-agnostic:

> **`land` = fetch current `main` → rebase the work branch onto it → re-run
> `verify` (and relocated review) on the rebased tree → advance.**
>
> A lost CAS / moved-`main` between the gate and the push INVALIDATES any prior
> green and re-arms the gate (re-rebase, re-`verify`, retry — never `--force`,
> never auto-resolve).

This is what `integration-core.ts`'s `performIntegration` already implements:
the `freshWorktreeGate` (default-ON) runs `verify` and a relocated review on a
throwaway worktree checked out at the rebased tip; the `mergeRetries` CAS
loop (default cap `DEFAULT_MERGE_RETRIES`, resolved through the same
`flag > env > per-repo > global > default` precedence chain as the rest of the
gate family) re-runs that gate against the new tip whenever a competing land
moves `main` between gate and push. Within a single process,
`integrator.ts` runs each call inside `integrateLock(key, fn)` (keyed per
repo by `integrateLockKey`); `run.ts` wires it via the `createKeyedLock()`
primitive. Across processes the CAS loop alone is the cross-job queue.

### 3. Two frontends to one primitive

Merge mode and propose mode are NOT two different landings; they are two
different points at which the SAME primitive is invoked:

- **Merge mode = runner-inline frontend.** The runner reaches the serialised
  land step itself and runs the primitive there. `freshWorktreeGate` covers
  the merge-time tip directly — the runner IS the merger.
- **Propose mode = human-checkpoint frontend.** The runner reaches a human
  checkpoint (a PR surface, or — on a bare host — a merge-question in the
  advance loop's sidecar). The human's answer is the APPROVAL. The land
  primitive runs at apply time (or at host-button time, where the host
  enforces it), again re-rebasing and re-`verify`-ing on the tip current at
  that moment.

**Human review is ADDITIVE, never substitutive.** A human reviewer adds
intent / design / security judgement that a build cannot. They do NOT add
evidence that the merged tree builds — the re-verify is the only thing that
adds that, in either frontend. A "human approved the PR" must never be
treated as a stand-in for the re-verify on the lived-context tip.

### 4. The floor/ceiling gradient

Safety lives at the floor; speed and ergonomics live at the ceiling.

- **Floor (git-alone).** The primitive MUST be safe with nothing but
  `git push` + ref-CAS against a bare `--bare` arbiter, with the
  `NoneProvider` review provider (`integrator.ts`'s default when no host is
  detected). No host API, no merge queue, no branch protection, no
  out-of-band serialiser. The CAS retry loop is the cross-job queue; the
  in-process `integrateLock` is the optimisation on top of it.
- **Ceiling (a capable host).** A host can RAISE the assurance — but it is
  never REQUIRED for it. On GitHub (the benchmark): a required `verify`
  status check + `required_status_checks.strict: true` ("require branches up
  to date before merging") forces a rebase + re-verify against current
  `main` before the merge button works (Tier 1). A merge queue
  (`merge_group` trigger, the deferred Tier 2 below) does speculative-rebase
  composition checking and removes Tier 1's rebase churn.
- **Gradient, not a cliff.** A middling host (GitLab, Gitea, plain SSH)
  slots in between by whatever subset it supports. GitHub-as-benchmark
  exists exactly to prove the gradient degrades gracefully down to bare
  git — if the design needs the ceiling to be SAFE, the floor is broken.

### 5. The unchanged invariants

These predate this ADR (`execution-substrate-decisions.md` §10) and are
restated here only because every frontend of the primitive preserves them:

- **Never `--force` to `main`.** A lost CAS triggers a re-rebase + re-gate +
  retry, bounded by `mergeRetries`. A genuinely stuck loser bounces to
  needs-attention; it does not overwrite the lived tip.
- **Never auto-resolve a conflict.** A textual conflict on rebase routes to
  needs-attention. The whole doctrine is about catching what `git` cannot
  prove; trusting it to pick a side of a conflict would invert the point.

### 6. Forward seam: deliberately deferred

**GitHub Merge Queue (Tier 2, `merge_group` trigger) is OUT of scope for the
current spec and is recorded here as a forward seam, not an oversight.** Tier 1
(`strict: true` + required `verify` check) closes the stated PR-merge-time
drift window on GitHub on its own. Tier 2 adds composition-catching (two
individually-green PRs that break together) and removes Tier 1's rebase
churn, both real wins, but neither is required for the safety property this
ADR names. The provisioning seam from `install-ci` carries an extensible
ruleset shape so the `merge_queue` rule slots in as a mechanical addition
when the follow-on spec is taken up.

## Consequences

- The protocol invariant line (in `WORK-CONTRACT.md` / `CLAIM-PROTOCOL.md`,
  dual-written from `skills/setup/protocol/` SOURCE into `work/protocol/`,
  `diff -r` clean) POINTS HERE for the rationale; this ADR is its durable
  home. "Done/green" in the protocol means "verify ran on the rebased tip
  that landed", not "verify ran at build time".
- A future change that wants to trust a clean rebase, drop the
  `freshWorktreeGate`, or treat a human approval as a re-verify substitute
  is regressing a stated invariant; it is not a refactor.
- The propose-vs-merge distinction is "is a human approval required BEFORE
  the land", NOT "is the build parallel" or "is the tree re-verified". Both
  modes re-verify; only the propose frontend additionally surfaces a
  human-checkpoint.
- The merge-question mechanism (the runner-as-merger on a bare host, surfaced
  via advance's existing surface→answer→apply rungs) is ONE INSTANCE of this
  frontend pattern, not a new primitive. The land it dispatches IS this
  primitive.

## Cross-references

- prd: `work/specs/tasked/land-time-reverify-and-parallel-merge-ceiling.md` —
  the four-gap brief this ADR answers the durable WHY for.
- Protocol invariant line: `WORK-CONTRACT.md` and `CLAIM-PROTOCOL.md` (dual
  source: `skills/setup/protocol/` → `work/protocol/`, byte-identical).
- Engine surfaces (already implementing the primitive — do not change in this
  ADR's task):
  - `packages/dorfl/src/integration-core.ts` — `performIntegration`
    (rebase → fresh-worktree gate → integrate), `freshWorktreeGate`
    (default-ON), `mergeRetries` (CAS retry cap; resolved through the
    gate-family precedence chain).
  - `packages/dorfl/src/integrator.ts` — `integrateLock(key, fn)` wiring;
    `NoneProvider` (the bare-host review provider that proves the floor).
  - `packages/dorfl/src/run.ts` — `createKeyedLock()` (the keyed-lock
    primitive `integrateLock` is instantiated from).
- Adjacent invariants: ADR `execution-substrate-decisions.md` §10 (no
  `--force` to `main`; no auto-resolve of conflicts).

## In-scope decisions recorded here (per repo convention)

- **Slug.** Filename `land-primitive-rebase-reverify-advance.md` (the task's
  declared slug), shortened from the spec's working title
  `land-is-rebase-reverify-advance-one-primitive-two-frontends`. The
  short form keeps the URL ergonomic; the full framing ("one primitive, two
  frontends") lives in the title and §3.
- **Filename style.** This repo's `docs/adr/` uses slug-named files
  (no sequential `NNNN-` prefix), e.g. `ci-config-policy-and-gate-family.md`,
  `execution-substrate-decisions.md`. This ADR matches that house style
  rather than the numbered template in `ADR-FORMAT.md`, which is the
  propagated default for downstream repos.
- **Scope boundary.** This ADR records DOCTRINE only. The engine already
  implements it and is NOT changed by the task that produces this ADR;
  the CI parallel-merge shape change, the propose-tier work, and the
  load-bearing tests live in their own tasks under the same spec. The
  Tier-2 `merge_queue` forward seam is named here so the deferral is
  visible, not so it is built here.
