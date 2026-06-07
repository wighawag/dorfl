---
title: agent-stop-signal — honor a build agent's deliberate STOP-on-drift; route to needs-attention BEFORE the gate/Gate-2, with the agent's reason verbatim
slug: agent-stop-signal
blockedBy: [do-in-place]
covers: []
---

> Self-contained correctness fix — derives from NO PRD (`covers: []`), so per
> WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Spotted live on
> the `do-run-share-isolation-seam` run during the backlog drive; full diagnosis in
> `work/observations/agent-stop-on-drift-not-honored-by-runner.md` (delete that note
> once this lands).

## What to build

Make the runner **honor the STOP the build-agent prompt already tells the agent to
perform** when a slice has DRIFTED / is ambiguous / rests on a stale premise — so a
principled STOP routes the item to `work/needs-attention/` with the agent's reason
verbatim, **BEFORE** (and instead of) running the acceptance gate + Gate-2 review.

### The defect (precise)

`skills/to-slices/CLAIM-PROTOCOL.md` (~L135) instructs the build agent:

> "If the SLICE ITSELF is the problem … rests on a premise that no longer matches
> the code/ADRs (it has DRIFTED) … do NOT guess and build on it. STOP and report
> specifically what is unclear or contradicted (and where) … **(the runner routes
> the item to needs-attention)**."

The agent obeys this. **But the runner never implements the promised routing, and
there is no machine-readable STOP signal for the agent to raise.** `performDo`
(`src/do.ts`) recognises only two agent outcomes:

1. `agent.ok === false` (the agent invocation errored) → `saveAgentFailure` → route
   to needs-attention, NO gate. ✓
2. `agent.ok === true` → ASSUME it built → run acceptance gate → run Gate-2 review →
   done-move.

A deliberate STOP exits cleanly (`agent.ok === true`) with NO source change, so it
is indistinguishable from "a build that changed nothing." The runner therefore runs
the full gate (passes — nothing changed) AND the full Gate-2 review (an expensive
extra agent round), and only THEN does the Gate-2 reviewer notice "no code, criteria
unmet" and block it — reaching needs-attention via the WRONG door, mislabeled as a
*review block*, after wasting the gate + review. `run.ts`'s `runOneItem` has the SAME
two-state shape and the SAME gap.

### The fix — two halves (mirror the existing in-band "agent edits, runner does git" discipline)

1. **A machine-readable STOP signal the agent raises IN-BAND.** Extend the
   CLAIM-PROTOCOL wrapper so "STOP and report" has a concrete, parseable form the
   runner can detect. Preferred channel: a **sentinel in the agent's final output**
   (`LaunchResult.output`, already captured as `agent.output` and already threaded
   back through the harness seam) — e.g. the agent's report must begin with a
   sentinel line / contain a fenced block such as:

   ```
   === SLICE-STOP: drift ===
   <the specific drift report: which premises are false, where, suggested re-scope>
   === END SLICE-STOP ===
   ```

   Define ONE exact, stable, machine-checkable form (document it in the wrapper next
   to the existing STOP instruction so the agent emits it). Keep the human-readable
   reason INSIDE the block — it becomes the needs-attention reason verbatim.

2. **Runner detects the STOP between agent-return and the gate.** In `performDo`
   (and mirror in `run.ts`'s `runOneItem`), AFTER `agent.ok` is confirmed true but
   BEFORE `performComplete`/the gate, parse `agent.output` for the STOP sentinel. If
   present → route to needs-attention through the SAME work-preserving seam
   `saveAgentFailure` uses (save the branch, surface on the arbiter), recording the
   agent's STOP reason as the needs-attention reason — and **SKIP the acceptance gate
   AND Gate-2 entirely**. Add a NEW `DoOutcome` (e.g. `agent-stopped`) DISTINCT from
   `needs-attention` (red gate / rebase conflict) and from `agent-failed` (the agent
   errored), so `status`, the exit summary, and the report name it honestly ("the
   agent STOPPED: the slice has drifted" — not "review blocked").

### Deterministic backstop (cheap, additive — include it)

Independently of the sentinel: when `agent.ok` is true but the work-branch diff vs
`<arbiter>/main` is **EMPTY** (no source change at all, only the claim move), that is
NEVER a successful build. Treat an empty diff as an implicit STOP/no-op → route to
needs-attention WITHOUT paying for the gate + Gate-2, with a clear reason ("the agent
produced no change; treating as a no-op/stop — re-scope or re-claim"). The sentinel
carries the agent's REASONING; the empty-diff check is the observable safety net for
when the agent stops without (or with a malformed) sentinel. A non-empty diff with a
sentinel is still a STOP (the agent may have left scratch); the sentinel wins.

### Scope

- IN: the STOP sentinel form in the wrapper; runner detection in BOTH `do` (in-place
  — and it should flow to `do --remote` via the same `runRemotePipeline` agent-result
  handling) and `run`; the new `agent-stopped` outcome; the empty-diff backstop; the
  agent's reason recorded verbatim as the needs-attention reason; gate + Gate-2
  SKIPPED on a STOP.
- OUT: changing WHAT makes a slice "drifted" (that is the agent's judgement, per the
  wrapper — unchanged); re-scoping any actual drifted slice (separate follow-ups);
  any change to the success path (a real build is byte-identical).

## Acceptance criteria

- [ ] The CLAIM-PROTOCOL wrapper documents ONE exact machine-readable STOP sentinel
      form (next to the existing "STOP and report" instruction); the assembled build
      prompt carries it.
- [ ] When the build agent's `agent.output` contains the STOP sentinel, the runner
      (in-place `do`, `do --remote`, and `run`) routes the item to needs-attention
      with the agent's STOP reason recorded VERBATIM, surfaced on the arbiter, branch
      preserved — and the acceptance gate AND Gate-2 review are NOT run.
- [ ] The terminal outcome is a NEW `agent-stopped` (distinct from `needs-attention`
      / `agent-failed` / `review-blocked`); `status` + the exit summary name it
      honestly as an agent STOP / drift, not a review block.
- [ ] Empty-diff backstop: `agent.ok` true + an EMPTY work-branch diff vs
      `<arbiter>/main` → routed to needs-attention (no gate, no Gate-2) with a
      no-op/stop reason, even without a sentinel.
- [ ] The SUCCESS path is unchanged: a real build (non-empty diff, no sentinel) runs
      the gate + Gate-2 exactly as today (existing `do`/`run` tests pass unchanged).
- [ ] The `agent-failed` (agent invocation errored) path is unchanged — STOP is a
      THIRD state, not a re-label of either existing one.
- [ ] Tests (stubbed harness emitting a STOP sentinel / an empty result / a normal
      build): a sentinel STOP routes to needs-attention with the verbatim reason and
      runs NO gate/Gate-2; an empty diff routes via the backstop; a normal build is
      unaffected; the reason lands in the item body + is surfaced on the arbiter.
      Reuse the house harness-stub + temp-`workspacesDir` + `isolatePiAgentDir`
      isolation; assert the real shared dirs are untouched.
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `do-in-place` — the `do` agent-result handling (`agent.ok` branch + the
  `saveAgentFailure` needs-attention seam) this fix slots a third state into; the
  in-place worker must exist first. (`run`'s mirror `runOneItem` is already in
  `done/`; this slice touches both, reusing the SAME seam.)

## Prompt

> Make the runner HONOR the STOP the build-agent prompt already instructs on a
> DRIFTED/ambiguous/stale-premise slice — route the item to `work/needs-attention/`
> with the agent's reason VERBATIM, BEFORE and INSTEAD OF the acceptance gate +
> Gate-2 review. Today the runner has only two agent outcomes (`agent.ok===false` →
> saveAgentFailure; `agent.ok===true` → gate+Gate-2), so a clean STOP with no source
> change is mistaken for "a build that changed nothing", wastes the gate + a Gate-2
> round, and reaches needs-attention mislabeled as a review block. Full diagnosis:
> `work/observations/agent-stop-on-drift-not-honored-by-runner.md` (READ IT FIRST;
> delete it as part of this slice once the behaviour lands).
>
> FIRST run the drift check: confirm `skills/to-slices/CLAIM-PROTOCOL.md` still
> instructs the agent to "STOP and report" on a drifted slice WITHOUT a
> machine-readable form; confirm `src/do.ts` `performDo` has the `agent.ok` branch +
> `saveAgentFailure` seam, that `do --remote`'s `runRemotePipeline` shares the
> agent-result handling, and that `src/run.ts` `runOneItem` mirrors it. Route THIS
> slice to needs-attention on any real discrepancy (and yes — that path is exactly
> what you are fixing).
>
> READ FIRST: `work/observations/agent-stop-on-drift-not-honored-by-runner.md` (the
> diagnosis + proposed shape); `skills/to-slices/CLAIM-PROTOCOL.md` (~L135 STOP
> instruction — add the sentinel form HERE, in-band, next to it); `src/do.ts`
> (`performDo` agent-result handling, `saveAgentFailure`, the `DoOutcome` union,
> `runRemotePipeline`); `src/run.ts` (`runOneItem` + its `saveAgentFailure` mirror);
> `src/harness.ts` (`LaunchResult.output` — the channel the sentinel rides);
> `src/needs-attention.ts` / `src/ledger-write.ts` (the needs-attention reason
> recording the STOP reason reuses).
>
> Implement: (1) define ONE exact STOP sentinel form in the wrapper; (2) in
> `performDo`/`runRemotePipeline`/`runOneItem`, after `agent.ok` and BEFORE the gate,
> detect the sentinel → route to needs-attention (verbatim reason, surfaced on the
> arbiter, branch preserved) under a NEW `agent-stopped` outcome, skipping the gate +
> Gate-2; (3) add the empty-diff backstop (no source change vs `<arbiter>/main` →
> same routing without a sentinel). Keep the success path and the `agent-failed` path
> byte-identical.
>
> TDD with vitest, house style (stub the harness to emit a STOP sentinel / an empty
> result / a normal build; temp `workspacesDir`; `isolatePiAgentDir`): a sentinel
> STOP routes to needs-attention with the verbatim reason and runs NO gate/Gate-2; an
> empty diff routes via the backstop; a normal build is unaffected; `agent-failed`
> unchanged; real shared dirs untouched. "Done" = acceptance criteria met and the
> gate green.

---

### Claiming this slice

```sh
agent-runner claim agent-stop-signal --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/agent-stop-signal <remote>/main
git mv work/in-progress/agent-stop-signal.md work/done/agent-stop-signal.md
```
