---
title: AUTO-LAND a dirty CONTINUE on an already-done-moved branch — add a source:'done' / alreadyDoneMoved contract so complete/integration-core builds + integrates the continue-agent's new work WITHOUT a second git mv (continue-build lifecycle), instead of surfacing to needs-attention
slug: complete-builds-on-already-done-moved-continue
prd: recover-autodetect-and-advancing-lock-crash-safety
blockedBy: [recover-autodetect-gated-on-nothing-to-commit]
covers: [1]
---

## What to build

AUTO-LAND a dirty CONTINUE whose slice file is ALREADY in `work/done/` on the kept
branch: build (gate), commit, and integrate the continue-agent's NEW work, so the
work lands automatically instead of bouncing to `needs-attention/`.

This is the upgrade half of `recover-autodetect-gated-on-nothing-to-commit` (the
"option D" stopper). That blocker slice gates the silent auto-recover off on a
dirty tree and SURFACES a continue-specific `needs-attention` (so no work is ever
silently discarded). THIS slice removes the bounce: it makes the dirty done-stranded
continue a first-class, integrate-able state.

### Why this needs a contract change (verified — do not re-derive, do not shortcut)

On a CONTINUE the slice file is ALREADY in `work/done/` on the kept branch. The
existing build path cannot integrate from there:

- `src/complete.ts` (~L476-484) hard-types `source: 'in-progress' | 'needs-attention'`
  — there is NO `'done'` source. With the blocker's gate, a dirty continue trips
  `if (!committedRecovery && !existsSync(sourcePath))` → `CompleteRefusal('nothing to
  complete')`.
- `src/integration-core.ts` step-2 `git mv work/in-progress/<slug>.md →
  work/done/<slug>.md` cannot run — the slug is already in `done/`.
- The whole build-path source contract (`IntegrationCoreInput.source`, the step-2
  `git mv`, the `existsSync(sourcePath)` originTrust read ~L534, and
  `reconcileDoneMoveAgainstArbiter`) bakes in "the slice is moved INTO done/ for the
  FIRST time on THIS commit". A continue-from-done-strand is structurally outside it.

So this is a NEW lifecycle state, deliberately distinct from the existing two:

- `committedRecovery` (clean strand fast-path: recover the kept commit, no rebuild);
- `recovering` (a needs-attention re-finish from `needs-attention/`).

The new one — call it the **continue-build** state (`source: 'done'` /
`alreadyDoneMoved: true`, name it coherently with CONTEXT.md vocabulary while
building) — means: the slice is ALREADY done-moved, the agent produced NEW source
work this run, so SKIP the `git mv` step but STILL run prepare → gate → `git add -A`
→ commit → rebase → integrate, and EXEMPT this state from the originTrust read and
the `reconcileDoneMoveAgainstArbiter` "where did the slug move?" reasoning (there is
no move on this commit — only new source on top of an already-done slice).

This is `humanOnly` because it introduces a new user-visible lifecycle concept and
touches load-bearing integration-core contracts (originTrust, the done-move,
reconciliation) used across `complete`, `do --remote`, and `run` — a human should
drive the naming + the contract review, not an autonomous claim.

### Coverage of the chosen path

- `complete.ts`: when the blocker's gate says "dirty + done-stranded", instead of
  routing to needs-attention, resolve `source: 'done'` (the continue-build state)
  and pass it into `performIntegration`.
- `integration-core.ts`: a `source: 'done'` / `alreadyDoneMoved` path that skips the
  step-2 `git mv` (already in done/), runs prepare→gate→`git add -A`→commit→rebase→
  integrate on the new work, and is exempted from the originTrust read +
  `reconcileDoneMoveAgainstArbiter` (there is no first-time move to reconcile).
- The already-integrated `isAncestor` no-op, the clean-strand `committedRecovery`
  fast-path, the `recovering` needs-attention re-finish, and the explicit
  `complete --isolated` recover are ALL unchanged.

## Acceptance criteria

- [ ] A dirty CONTINUE on an already-done-moved kept branch AUTO-LANDS: the
      continue-agent's new uncommitted work is gated + committed + integrated onto
      `<arbiter>/main` WITHOUT a second `git mv`, and the integrated result CONTAINS
      that new edit. EXTEND `test/autonomous-recovers-stranded-done.test.ts`'s
      dirty-continue case (added by the blocker slice) to assert the work now LANDS
      (this slice flips the blocker's "routes to needs-attention" expectation to
      "integrates") — covers story 1 fully.
- [ ] The new continue-build state is distinct from and does not regress the other
      three: `committedRecovery` (clean strand → recover kept commit, no rebuild),
      `recovering` (needs-attention re-finish), and `complete --isolated` (explicit
      recover) each keep their current behaviour. A test pins each.
- [ ] The `source: 'done'` / `alreadyDoneMoved` path SKIPS the step-2 `git mv` (the
      slug is already in done/) and is EXEMPTED from the originTrust read +
      `reconcileDoneMoveAgainstArbiter` (no first-time move on this commit), while
      still running prepare → gate → `git add -A` → commit → rebase → integrate. A
      test asserts the new work is committed + integrated and no spurious move/
      reconcile fires.
- [ ] An already-integrated tip (clean tree, tip already on `<arbiter>/main`) is
      STILL a clean no-op (the core's unspoofable `isAncestor` check is not
      regressed).
- [ ] The new lifecycle state is NAMED coherently with the existing CONTEXT.md
      vocabulary, and the load-bearing contract decision (a third source state;
      skipping the move; exempting originTrust + reconcile) is recorded as an ADR in
      `docs/adr/` (it is hard to reverse + surprising without context + a real
      trade-off — it meets the ADR gate).
- [ ] Tests use throwaway `--bare` `file://` arbiters + real clones (the existing
      stranded-done test style); point `workspacesDir` at a temp dir; no network. No
      shared/global location touched outside temp fixtures.
- [ ] `pnpm format` then `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Blocked by

- `recover-autodetect-gated-on-nothing-to-commit` — SAME-FILE + premise dependency.
  That slice gates `committedRecovery` off on a dirty continue and surfaces a
  continue-specific needs-attention; THIS slice replaces that bounce with the
  continue-build integrate path. Both edit `complete.ts`'s source-resolution region
  (and this one also `integration-core.ts`), so serialise. Build on the POST-blocker
  reality: re-read the blocker's landed `complete.ts` gate as your drift-check and
  add the contract ON TOP of it.

## Prompt

> FIRST, drift-check against current `origin/main` AND the blocker slice's landed
> change (`recover-autodetect-gated-on-nothing-to-commit`): re-read `src/complete.ts`
> source-resolution (the `committedRecovery` gate the blocker added; the hard-typed
> `source: 'in-progress' | 'needs-attention'`; the `CompleteRefusal('nothing to
> complete')` guard; the continue-specific needs-attention surface the blocker
> added); `src/integration-core.ts` (`IntegrationCoreInput.source`, the step-2 `git
> mv` ~L778, the originTrust `existsSync(sourcePath)` read ~L534,
> `reconcileDoneMoveAgainstArbiter`, the `committedRecovery`/`recovering` dispatch,
> the `isAncestor` already-integrated no-op); `src/recover-isolated.ts` (the explicit
> surface to leave UNCHANGED). CONFIRM the blocker landed and that a dirty continue
> currently SURFACES to needs-attention (does not yet auto-land). If the blocker
> landed differently, route to needs-attention rather than build on a stale premise.
>
> GOAL: make a dirty CONTINUE on an already-done-moved kept branch AUTO-LAND the
> continue-agent's new work. Introduce a third lifecycle state (`source: 'done'` /
> `alreadyDoneMoved` — the CONTINUE-BUILD state, named coherently with CONTEXT.md)
> that: SKIPS the step-2 `git mv` (the slug is already in done/), still runs prepare →
> gate → `git add -A` → commit → rebase → integrate on the new work, and is EXEMPTED
> from the originTrust read + `reconcileDoneMoveAgainstArbiter` (there is no
> first-time move on this commit). In `complete.ts`, where the blocker's gate
> detected "dirty + done-stranded" and surfaced needs-attention, resolve this new
> source and pass it into `performIntegration` instead.
>
> WHY: a requeued slice that is continued (its prior attempt already done-moved it)
> currently either lost the new work (pre-blocker) or bounces to needs-attention
> (post-blocker). This lands it automatically. See
> `work/observations/recover-already-committed-discards-continue-agent-new-work.md`,
> the blocker slice's `## Decisions` (option D), and the PRD
> `recover-autodetect-and-advancing-lock-crash-safety`.
>
> FENCE: do NOT regress the other three states (`committedRecovery` clean-strand
> fast-path, `recovering` needs-attention re-finish, `complete --isolated` explicit
> recover) or the `isAncestor` already-integrated no-op. Do NOT abuse the
> `IntegrationLifecycle` seam to carry a slice build (it means "non-slice" throughout
> the core — that muddles the concept; rejected option B). Do NOT do a hidden
> mutate-then-restore `git mv done→in-progress→done` (rejected option C — it desyncs
> reconciliation). Build the explicit `source: 'done'` contract (option A).
>
> SEAM TO TEST AT: the autonomous integrate path (`performDo`/`performComplete`) with
> throwaway `--bare` `file://` arbiters + real clones — (a) dirty continue on a
> done-stranded branch ⇒ new work committed + integrated (NOT bounced, NOT
> discarded); (b) clean strand ⇒ kept commit recovered (no rebuild); (c) needs-
> attention re-finish ⇒ unchanged; (d) `complete --isolated` ⇒ unchanged; (e)
> already-integrated clean tip ⇒ no-op. Point `workspacesDir` at a temp dir; no
> network.
>
> DONE: a dirty continue auto-lands its new work via the new `source: 'done'`
> continue-build contract (no second `git mv`, originTrust + reconcile exempted), the
> other lifecycle states + the no-op are unchanged, the contract is recorded as an
> ADR in `docs/adr/`, the incident is covered by a regression test, and `pnpm -r
> build && pnpm -r test && pnpm format:check` is green. Do NOT perform git
> transitions (no stage/commit/push, no folder moves) — the runner/human owns those.

## Decisions (to record while building)

- The NAME of the new lifecycle state (`source: 'done'` vs `alreadyDoneMoved` flag
  vs a named "continue-build" enum) and how it reads alongside `committedRecovery` /
  `recovering` in CONTEXT.md vocabulary.
- The originTrust + `reconcileDoneMoveAgainstArbiter` exemption rationale (there is
  no first-time move on a continue-build commit) — this is the ADR-worthy WHY.
- Why option A (explicit source contract) over B (lifecycle-seam abuse) and C
  (hidden mutate-then-restore move).
