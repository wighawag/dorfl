---
title: agent-stop-signal — the build-agent → runner REPORTING CHANNEL: a hard STOP verdict (honored before gate/Gate-2) + a soft DECISIONS log (surfaced for review), so neither a drifted-slice STOP nor an inline design decision is lost
slug: agent-stop-signal
blockedBy: [do-in-place]
covers: []
---

> Self-contained correctness fix — derives from NO SPEC (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Spotted live on the `do-run-share-isolation-seam` run during the backlog drive; full diagnosis in `work/observations/agent-stop-on-drift-not-honored-by-runner.md` (delete that note once this lands).
>
> SCOPE EXTENDED 2026-06-07 (human decision): this slice now covers BOTH verdicts a build agent can raise on its single reporting channel (`LaunchResult.output`): (1) a HARD **STOP** (the slice drifted / is ambiguous → route to needs-attention, skip the gate) and (2) a SOFT **DECISIONS log** (the agent made a non-obvious in-scope choice the slice didn't specify → record it so Gate-2 + the human can ratify/reverse it, build still proceeds). Both are designed together because they are two verdicts on ONE channel; the second was prompted by an inline `-n`×`--remote` refusal that was decided in code without surfacing (`work/observations/do-remote-no-arg-and-remote-autopick-for-isolated-conductor.md`).

## What to build

**Part A — honor the STOP.** Make the runner honor the STOP the build-agent prompt already tells the agent to perform when a slice has DRIFTED / is ambiguous / rests on a stale premise — so a principled STOP routes the item to `work/needs-attention/` with the agent's reason verbatim, **BEFORE** (and instead of) running the acceptance gate + Gate-2 review.

**Part B — surface inline DECISIONS** (the lighter sibling on the same channel): make the build agent RECORD non-obvious in-scope decisions the slice didn't specify, and make the review gate HUNT for un-recorded ones — so a buried design-decision-in-code becomes a reviewable artifact instead of silent drift. See [Part B](#part-b--surface-inline-design-decisions-b--c) below.

### The defect (precise)

`skills/to-slices/CLAIM-PROTOCOL.md` (~L135) instructs the build agent:

> "If the SLICE ITSELF is the problem … rests on a premise that no longer matches the code/ADRs (it has DRIFTED) … do NOT guess and build on it. STOP and report specifically what is unclear or contradicted (and where) … **(the runner routes the item to needs-attention)**."

The agent obeys this. **But the runner never implements the promised routing, and there is no machine-readable STOP signal for the agent to raise.** `performDo` (`src/do.ts`) recognises only two agent outcomes:

1. `agent.ok === false` (the agent invocation errored) → `saveAgentFailure` → route to needs-attention, NO gate. ✓
2. `agent.ok === true` → ASSUME it built → run acceptance gate → run Gate-2 review → done-move.

A deliberate STOP exits cleanly (`agent.ok === true`) with NO source change, so it is indistinguishable from "a build that changed nothing." The runner therefore runs the full gate (passes — nothing changed) AND the full Gate-2 review (an expensive extra agent round), and only THEN does the Gate-2 reviewer notice "no code, criteria unmet" and block it — reaching needs-attention via the WRONG door, mislabeled as a _review block_, after wasting the gate + review. `run.ts`'s `runOneItem` has the SAME two-state shape and the SAME gap.

### Part A: the fix — two halves (mirror the existing in-band "agent edits, runner does git" discipline)

1. **A machine-readable STOP signal the agent raises IN-BAND.** Extend the CLAIM-PROTOCOL wrapper so "STOP and report" has a concrete, parseable form the runner can detect. Preferred channel: a **sentinel in the agent's final output** (`LaunchResult.output`, already captured as `agent.output` and already threaded back through the harness seam) — e.g. the agent's report must begin with a sentinel line / contain a fenced block such as:

   ```
   === SLICE-STOP: drift ===
   <the specific drift report: which premises are false, where, suggested re-scope>
   === END SLICE-STOP ===
   ```

   Define ONE exact, stable, machine-checkable form (document it in the wrapper next to the existing STOP instruction so the agent emits it). Keep the human-readable reason INSIDE the block — it becomes the needs-attention reason verbatim.

2. **Runner detects the STOP between agent-return and the gate.** In `performDo` (and mirror in `run.ts`'s `runOneItem`), AFTER `agent.ok` is confirmed true but BEFORE `performComplete`/the gate, parse `agent.output` for the STOP sentinel. If present → route to needs-attention through the SAME work-preserving seam `saveAgentFailure` uses (save the branch, surface on the arbiter), recording the agent's STOP reason as the needs-attention reason — and **SKIP the acceptance gate AND Gate-2 entirely**. Add a NEW `DoOutcome` (e.g. `agent-stopped`) DISTINCT from `needs-attention` (red gate / rebase conflict) and from `agent-failed` (the agent errored), so `status`, the exit summary, and the report name it honestly ("the agent STOPPED: the slice has drifted" — not "review blocked").

### Deterministic backstop (cheap, additive — include it)

Independently of the sentinel: when `agent.ok` is true but the work-branch diff vs `<arbiter>/main` is **EMPTY** (no source change at all, only the claim move), that is NEVER a successful build. Treat an empty diff as an implicit STOP/no-op → route to needs-attention WITHOUT paying for the gate + Gate-2, with a clear reason ("the agent produced no change; treating as a no-op/stop — re-scope or re-claim"). The sentinel carries the agent's REASONING; the empty-diff check is the observable safety net for when the agent stops without (or with a malformed) sentinel. A non-empty diff with a sentinel is still a STOP (the agent may have left scratch); the sentinel wins.

## Part B: surface inline design decisions (B + C)

The STOP verdict (Part A) is for when the agent CAN'T proceed. Part B is for when it proceeds but makes a **non-obvious in-scope decision the slice did not specify** — especially a CROSS-SLICE interaction (a choice affecting another command/flag/slice's behaviour), a new ERROR/REFUSAL, or a user-visible DEFAULT. Today such a choice is made silently in code and buried (the live example: `do-autopick` decided `-n`×`--remote` should error, in code, with no question and no note — it fell between two slices and only surfaced later by accident). Two complementary halves:

**B — the agent SELF-REPORTS decisions (a soft sibling of the STOP sentinel, same channel).** Extend the CLAIM-PROTOCOL wrapper: when the agent makes a non-obvious in-scope decision the slice didn't specify — a cross-slice interaction, a new error/refusal, or a user-visible default — it records it in its FINAL OUTPUT under a machine-recognisable `## Decisions` block, each entry: what was chosen + why + the alternative(s) considered + what it touches (which other flag/command/slice). This is NOT a STOP — the build PROCEEDS; it just makes the choice visible. A genuinely trivial, certain, self-contained factual gap (resolvable from the code, affecting nothing else) does NOT need an entry — the bar is "would another slice / a user / a reviewer be surprised this was decided here?". Reframe the wrapper's existing "a small certain factual gap, resolve and proceed" clause so a choice that affects ANOTHER command/flag/slice or sets a user-visible default is explicitly a DESIGN decision (→ record it, or STOP if load-bearing and hard to reverse), NOT a "small factual gap".

**C — the review gate HUNTS for un-recorded ones (the backstop for when the agent didn't self-report — exactly this case).** Extend the Gate-2 review prompt (`src/review-gate.ts`): instruct the reviewer to look for in-scope decisions the slice did NOT specify — cross-slice interactions, new errors/refusals, user-visible defaults — and flag each as a finding for ratification (a non-blocking nit by default; blocking only if the decision looks wrong or genuinely load-bearing). The agent's `## Decisions` block (B) is the reviewer's STARTING point: ratify those, AND hunt for any the agent missed.

**Surfacing/recording (where B's block lands).** The `## Decisions` block rides the SAME `LaunchResult.output` channel as the STOP sentinel and the PR-body summary (`do-in-place` already threads `agent.output` into the propose-mode PR body), so the decisions are visible IN THE PR for Gate-2 + the human — no new storage needed. Optionally also fold them into the gate-generated `work/observations/review-nits-<slug>-*.md` so they have a durable triage home alongside the review nits (reuse that existing mechanism; do not invent a new one).

**B/C are PROMPT-mostly.** B is a wrapper edit + (optionally) surfacing the block in the PR body/observation. C is a review-gate prompt edit. Neither needs the runner state-machine change Part A needs — keep them cheap. Do NOT make a recorded decision block the build (that is the whole point: it proceeds + is reviewable).

### Scope

- IN (Part A): the STOP sentinel form in the wrapper; runner detection in BOTH `do` (in-place — and it should flow to `do --remote` via the same `runRemotePipeline` agent-result handling) and `run`; the new `agent-stopped` outcome; the empty-diff backstop; the agent's reason recorded verbatim as the needs-attention reason; gate
  - Gate-2 SKIPPED on a STOP.
- IN (Part B): the `## Decisions` block in the wrapper (agent self-reports non-obvious in-scope decisions; the reframed "small factual gap vs design decision" bar); the block surfaced via the existing `agent.output`→PR-body path (and optionally the review-nits observation); the Gate-2 review-prompt clause to HUNT for un-recorded in-scope decisions and flag them for ratification.
- OUT: changing WHAT makes a slice "drifted" / what counts as a notable decision beyond the stated bar (that stays the agent's + reviewer's judgement); re-scoping any actual drifted slice (separate follow-ups); any change to the success path (a real build with no STOP and no notable decisions is byte-identical); making a recorded decision BLOCK the build (it must proceed).

## Acceptance criteria

- [ ] The CLAIM-PROTOCOL wrapper documents ONE exact machine-readable STOP sentinel form (next to the existing "STOP and report" instruction); the assembled build prompt carries it.
- [ ] When the build agent's `agent.output` contains the STOP sentinel, the runner (in-place `do`, `do --remote`, and `run`) routes the item to needs-attention with the agent's STOP reason recorded VERBATIM, surfaced on the arbiter, branch preserved — and the acceptance gate AND Gate-2 review are NOT run.
- [ ] The terminal outcome is a NEW `agent-stopped` (distinct from `needs-attention` / `agent-failed` / `review-blocked`); `status` + the exit summary name it honestly as an agent STOP / drift, not a review block.
- [ ] Empty-diff backstop: `agent.ok` true + an EMPTY work-branch diff vs `<arbiter>/main` → routed to needs-attention (no gate, no Gate-2) with a no-op/stop reason, even without a sentinel.
- [ ] The SUCCESS path is unchanged: a real build (non-empty diff, no sentinel, no decisions block) runs the gate + Gate-2 exactly as today (existing `do`/`run` tests pass unchanged).
- [ ] The `agent-failed` (agent invocation errored) path is unchanged — STOP is a THIRD state, not a re-label of either existing one.
- [ ] Tests (Part A) (stubbed harness emitting a STOP sentinel / an empty result / a normal build): a sentinel STOP routes to needs-attention with the verbatim reason and runs NO gate/Gate-2; an empty diff routes via the backstop; a normal build is unaffected; the reason lands in the item body + is surfaced on the arbiter. Reuse the house harness-stub + temp-`workspacesDir` + `isolatePiAgentDir` isolation; assert the real shared dirs are untouched.
- [ ] **Part B (decisions):** the CLAIM-PROTOCOL wrapper documents the `## Decisions` block + the reframed "design decision vs small factual gap" bar (a choice touching another command/flag/slice or a user-visible default is a DESIGN decision, not a factual gap). A `## Decisions` block in `agent.output` is surfaced for review (in the PR body via the existing path; optionally in the review-nits observation) and does NOT block the build.
- [ ] **Part C (review hunts):** the Gate-2 review prompt instructs the reviewer to look for in-scope decisions the slice did not specify (cross-slice interactions, new errors/refusals, user-visible defaults) and flag each for ratification — non-blocking by default. A test asserts the review-prompt assembly carries this instruction (the existing review-gate prompt test pattern).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- `do-in-place` — the `do` agent-result handling (`agent.ok` branch + the `saveAgentFailure` needs-attention seam) this fix slots a third state into; the in-place worker must exist first. (`run`'s mirror `runOneItem` is already in `done/`; this slice touches both, reusing the SAME seam.)

## Prompt

> Make the runner HONOR the STOP the build-agent prompt already instructs on a DRIFTED/ambiguous/stale-premise slice — route the item to `work/needs-attention/` with the agent's reason VERBATIM, BEFORE and INSTEAD OF the acceptance gate + Gate-2 review. Today the runner has only two agent outcomes (`agent.ok===false` → saveAgentFailure; `agent.ok===true` → gate+Gate-2), so a clean STOP with no source change is mistaken for "a build that changed nothing", wastes the gate + a Gate-2 round, and reaches needs-attention mislabeled as a review block. Full diagnosis: `work/observations/agent-stop-on-drift-not-honored-by-runner.md` (READ IT FIRST; delete it as part of this slice once the behaviour lands).
>
> FIRST run the drift check: confirm `skills/to-slices/CLAIM-PROTOCOL.md` still instructs the agent to "STOP and report" on a drifted slice WITHOUT a machine-readable form; confirm `src/do.ts` `performDo` has the `agent.ok` branch + `saveAgentFailure` seam, that `do --remote`'s `runRemotePipeline` shares the agent-result handling, and that `src/run.ts` `runOneItem` mirrors it. Route THIS slice to needs-attention on any real discrepancy (and yes — that path is exactly what you are fixing).
>
> READ FIRST: `work/observations/agent-stop-on-drift-not-honored-by-runner.md` (the STOP diagnosis); `work/observations/do-remote-no-arg-and-remote-autopick-for-isolated-conductor.md` (the inline-decision example that motivated Part B); `skills/to-slices/CLAIM-PROTOCOL.md` (~L135 STOP instruction + the "small factual gap, resolve and proceed" clause — add the STOP sentinel form AND the `## Decisions` block + reframed decision bar HERE, in-band, next to it); `src/do.ts` (`performDo` agent-result handling, `saveAgentFailure`, the `DoOutcome` union, `runRemotePipeline`, AND the `agent.output`→PR-body threading Part B's block reuses); `src/run.ts` (`runOneItem` + its `saveAgentFailure` mirror); `src/harness.ts` (`LaunchResult.output` — the channel BOTH the STOP sentinel and the `## Decisions` block ride); `src/review-gate.ts` (the Gate-2 review PROMPT — add Part C's hunt-for-undeclared-decisions clause; note the existing review-prompt test pattern); `src/needs-attention.ts` / `src/ledger-write.ts` (the needs-attention reason the STOP reason reuses).
>
> Implement PART A (the runner state-machine change): (1) define ONE exact STOP sentinel form in the wrapper; (2) in `performDo`/`runRemotePipeline`/`runOneItem`, after `agent.ok` and BEFORE the gate, detect the sentinel → route to needs-attention (verbatim reason, surfaced on the arbiter, branch preserved) under a NEW `agent-stopped` outcome, skipping the gate + Gate-2; (3) the empty-diff backstop (no source change vs `<arbiter>/main` → same routing without a sentinel). Keep the success + `agent-failed` paths byte-identical.
>
> Implement PART B/C (prompt-mostly, cheap): (4) extend the wrapper with the `## Decisions` block instruction + reframe its "small factual gap" clause so a choice touching ANOTHER command/flag/slice or a user-visible default is a DESIGN decision (record it; STOP only if load-bearing+hard-to-reverse) — NOT a factual gap; (5) surface a `## Decisions` block from `agent.output` for review via the existing PR-body path (optionally also the review-nits observation); it must NOT block the build; (6) extend the Gate-2 review prompt to HUNT for in-scope decisions the slice didn't specify (cross-slice interactions, new errors/refusals, user-visible defaults) and flag each for ratification (non-blocking by default).
>
> TDD with vitest, house style (stub the harness to emit a STOP sentinel / a `## Decisions` block / an empty result / a normal build; temp `workspacesDir`; `isolatePiAgentDir`): a sentinel STOP routes to needs-attention with the verbatim reason and runs NO gate/Gate-2; an empty diff routes via the backstop; a normal build is unaffected; `agent-failed` unchanged; a `## Decisions` block is surfaced for review but does NOT block; the Gate-2 review-prompt assembly carries the hunt-for-undeclared-decisions clause; real shared dirs untouched. "Done" = acceptance criteria met and the gate green.

---

### Claiming this slice

```sh
dorfl claim agent-stop-signal --arbiter <remote>      # default --arbiter origin
git fetch <remote> && git switch -c work/agent-stop-signal <remote>/main
git mv work/in-progress/agent-stop-signal.md work/done/agent-stop-signal.md
```
