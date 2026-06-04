---
title: Ledger write seam — define applyLedgerTransition + route claim through it
slug: ledger-write-seam
prd: ledger-transition-seam
blockedBy: []
covers: [1, 2, 7, 8]
---

## What to build

The tracer-bullet first path through the **write seam**: define the
`applyLedgerTransition` write-seam interface and its single (current-behaviour)
strategy, then route the **claim** transition through it end-to-end — interface →
strategy → one real caller (the claim CAS) → tests proving claim behaviour is
byte-identical (including the genuine two-claimer race).

There is exactly ONE strategy and it does what the code does today: the claim is
the `--force-with-lease` micro-commit to the arbiter's `main`, with identical
exit-code semantics. **No mode, no config, no `ledgerMode`** — the seam is pure
indirection so a future strategy *could* slot in; today it does not.

The seam's signature must be **storage-agnostic** (a semantic "apply this
transition" verb — claim / complete / needs-attention as the transition kinds) and
MUST NOT encode `main` into its public shape; `main` is an implementation detail
of the one strategy. This slice establishes the interface the other write-seam
slices (`complete`, `needs-attention`) route through.

## Acceptance criteria

- [ ] A write-seam entry point exists (`applyLedgerTransition`-style) with the
      transition kinds named (at least `claim`), backed by ONE strategy = current
      behaviour.
- [ ] The claim CAS is dispatched THROUGH the seam (the claim call site no longer
      hard-wires the `main` push; it asks the seam to apply the claim transition).
- [ ] The seam signature does not mention `main` in its public shape (storage-
      agnostic); `main` lives only inside the sole strategy.
- [ ] No `ledgerMode` / mode / config is introduced. Nothing observable changes.
- [ ] Behaviour-identical: the existing claim-CAS tests (incl. the two-claimer
      race against a local `--bare` arbiter) pass UNCHANGED. A seam-level test
      asserts the claim transition is dispatched via the seam.
- [ ] `claim.sh` is untouched. `pnpm -r build && pnpm -r test && pnpm -r
      format:check` is green.

## Blocked by

- None — can start immediately (parallel with `ledger-read-seam`; they touch
  disjoint files).

## Prompt

> Introduce the **write half** of the ledger-transition seam in `agent-runner` and
> route the claim through it. This is a PURE REFACTOR — observable behaviour must
> be byte-identical to today; you are adding indirection, not behaviour.
>
> READ FIRST: `docs/adr/claim-ledger-vs-protected-main.md` (status: accepted —
> esp. "The decided design: a ledger-transition seam"), `CONTEXT.md` (claim/
> integration terms), and `src/claim-cas.ts` (the current claim CAS: the
> `--force-with-lease=main:<base>` micro-commit, its exit codes, the dirty-tree
> refusal, the no-op guard, the verify step). The claim is one of THREE `work/`
> transitions (claim / complete / needs-attention); this slice does CLAIM only and
> defines the seam the other two will route through.
>
> Define a storage-agnostic write-seam entry (a semantic "apply this transition"
> with a kind) and ONE strategy that does exactly what `claim-cas.ts` does today
> (CAS-push the claim micro-commit to the arbiter's `main`). Route `claim-cas.ts`
> through the seam so the call site no longer hard-wires the `main` push. The
> seam's public signature MUST NOT name `main` (a future strategy could push
> elsewhere); keep `main` inside the strategy.
>
> Do NOT introduce any `ledgerMode`/mode/config (the ADR forbids it). Do NOT touch
> `scripts/claim.sh`. Keep the in-process claim's exit-code parity with `claim.sh`.
>
> TDD with vitest, mirroring the existing claim-CAS test style (throwaway git
> repos + a local `--bare` arbiter; race tests live in the NON-PARALLEL vitest
> project — do not reintroduce file-parallelism flakiness, do not mask with
> retry). The headline test is "nothing changed": the existing claim tests pass
> unedited (other than mechanical import/call-site moves). Add a seam-level test
> proving the claim transition is dispatched through the seam. "Done" = acceptance
> criteria met and the gate is green.

---

### Claiming this slice

```sh
# atomically claim it (works with a GitHub remote OR a local --bare remote):
agent-runner claim ledger-write-seam --arbiter <remote>      # default --arbiter origin
# then start work on the updated main:
git fetch <remote> && git switch -c work/ledger-write-seam <remote>/main
# on completion, in the work branch's PR/merge:
git mv work/in-progress/ledger-write-seam.md work/done/ledger-write-seam.md
```
