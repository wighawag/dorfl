---
title: an EXPLICITLY-named `do prd:<slug>` is still refused by the `autoSlice` policy gate — but the maintainer's intent is that explicitly typing `do prd:<slug>` IS the authorization; `autoSlice` (like `allowAgents`) should gate AUTO-PICK eligibility, not an explicit named target
type: observation
status: spotted
spotted: 2026-06-09
---

## The signal

Running `do prd:advance-loop --harness pi --propose --review` in this repo (which
has NO agent-runner config) was REFUSED with:

> Skipped slicing 'advance-loop': the repo's autoSlice policy is off.

I had to re-run with `AGENT_RUNNER_AUTO_SLICE=true` to make the explicitly-named
slice happen. The maintainer flagged this as wrong: **"we agreed on `do prd:<slug>`
invocation the auto-slice is implied and so authorized."** I.e. explicitly TYPING
`do prd:advance-loop` is itself the human's authorization to slice that PRD — it
should not also require the `autoSlice` POLICY to be on.

## What the code does now (verified)

`src/slicing.ts` step 1 (`performSlice`, the `doer === 'agent'` branch) resolves
the AGENT slicing gate via `resolveAgentGate` →
`resolveSlicingEligibility({humanOnly, needsAnswers, sliceAfter, slicedSlugs,
autoSlice: autoSlice ?? false})`. The predicate is
`needsAnswers !== true && humanOnly !== true && autoSlice` (+ `sliceAfter`). With no
config, `autoSlice` defaults `false` → `gate-refused`
(`gateRefusalReason`: "the repo's autoSlice policy is off", `slicing.ts:898`).

This is SYMMETRIC with the build path: `do <slice>` gates the agent on `allowAgents`
the same way (the two-axis gate model; the WORK-CONTRACT "auto-eligible iff
`needsAnswers !== true && humanOnly !== true && allowAgents`" predicate).

## Why it matters / the design tension

The gate's ORIGINAL job (and the WORK-CONTRACT predicate's wording) is **auto-pick
eligibility** — *may an agent CLAIM an undeclared item here?* That is the unattended
daemon/CI enumerating the eligible pool and slicing/building WITHOUT a human naming
anything. There the policy gate is exactly right.

But when a human (or a conductor like `orchestrate`/`drive-backlog`) **explicitly
names** `do prd:<slug>` / `do <slug>`, the explicit invocation is arguably the
authorization — the gate is then refusing a target the operator just typed by hand.
That is the same class of footgun as the null-harness silent no-op
(`do-silently-defaults-to-null-harness-noop-when-unconfigured.md`): the operator's
explicit intent is silently overridden by an unset default.

Two readings, both defensible — this is a genuine DESIGN QUESTION, not an obvious
bug:

- **(A) Explicit-name bypasses the policy gate.** `autoSlice`/`allowAgents` gate ONLY
  the AUTO-PICK / pool-enumeration path (bare `do`, `do -n`, `run`); an explicitly
  named `do prd:<slug>` / `do <slug>` proceeds because naming it IS the authorization.
  (The `humanOnly`/`needsAnswers` axes still bind — those are about the ITEM's
  readiness, not the repo's agent policy.) This matches the maintainer's stated
  intent.
- **(B) Keep the gate uniform** (today's behaviour): even an explicit target obeys
  the repo policy; the operator passes `--allow-agents`/`AGENT_RUNNER_AUTO_SLICE` (or
  a per-repo config) to authorize. Simpler/uniform, but the explicit-name footgun
  remains.

## Where this connects (do NOT fix in isolation)

This is **advance-loop gate-family territory.** The advance-loop slice
`advance-drivers-and-gates` builds the FLAT per-action gate family
(`allowAgents`/`autoSlice`/`autoTriage`) and explicitly distinguishes the AUTO-PICK
drivers (bare `advance`, `-n`, `run`) from explicitly-named ticks; and
`rename-allowagents-to-autobuild` (US #36) renames `allowAgents → autoBuild`. The
"explicit-name vs auto-pick-eligibility" distinction belongs in THAT gate-family
design — decide there whether the gate guards the POOL-ENUMERATION path only (reading
A) or every agent invocation (reading B), and apply it uniformly to
build+slice+triage. If reading (A) wins, both `do prd:<slug>` and `do <slice>` named
forms stop needing the policy flag; the gate moves to the auto-pick selection step.

A possible adjacent code fix (independent of advance-loop, if the maintainer wants
the ergonomic now): in `slicing.ts`/`do.ts`, treat an explicitly-resolved single
named slug as authorized for the slice/build rung regardless of the
`autoSlice`/`allowAgents` policy, leaving the policy gate on the auto-pick selection
(`do-autopick.ts` / the `run` eligibility filter). But the clean home for the
DECISION is the advance gate family — capture here, decide there.

## Related

- `do-silently-defaults-to-null-harness-noop-when-unconfigured.md` — same
  unset-default-overrides-explicit-intent footgun class (harness side).
- `work/prd/advance-loop.md` — the FLAT per-action gate family + the `autoBuild`
  rename; slices `advance-drivers-and-gates` (#23, #25) and
  `rename-allowagents-to-autobuild` (#36) in `work/backlog/`.
- WORK-CONTRACT.md "The two autonomy axes" — the predicate whose wording
  ("auto-eligible") supports reading (A): the policy is about AUTO eligibility, not
  explicit invocation.

## Update 2026-06-09 — it IS written down (reading A confirmed) + the REAL bug is a build/slice ASYMMETRY

The maintainer confirmed: **`autoSlice` and `allowAgents` (→ `autoBuild`) are config
for `run`, pick-any, and CI — they should NOT gate an explicitly-named target.** And
it IS documented — reading (A) is the intended model, not a new decision:

- **`docs/adr/methodology-and-skills.md` §4:** "Repo policy `allowAgents` (per-repo
  config) — may agents claim *UNDECLARED* items here?" The predicate is "AUTO-eligible
  iff … `allowAgents` is true." Framed around UNDECLARED / auto-eligibility.
- **`work/prd-sliced/auto-slice.md` §57:** "Per-repo policy `autoSlice` — may an agent
  **auto-slice UNDECLARED PRDs** in this repo?" — same framing for the slice gate.

So the gate is contractually about the AUTO-PICK / pool-enumeration path. Verifying
the code, the two paths DIVERGE — this is the real defect:

- **BUILD path (`do <slice>`) already does the RIGHT thing:** `performDoInPlace`
  (`src/do.ts`) does NOT check `allowAgents` at all for an explicitly-named slice —
  it just CAS-claims (claim-or-lose) and applies the `--ignore-not-ready` readiness
  guard. `allowAgents` only filters the AUTO-PICK pool (`do-autopick`/`run`
  eligibility). Naming the slice IS the authorization. ✓ reading (A).
- **SLICE path (`do prd:<slug>`) OVER-GATES:** `performSlice` (`src/slicing.ts`
  step 1, `resolveAgentGate`) applies the `autoSlice` predicate even for an
  EXPLICITLY-named PRD — so `do prd:advance-loop` is refused when `autoSlice` is off,
  while `do advance-loop` (a slice) would NOT be refused. That asymmetry is the bug:
  the slice path treats the gate as binding every agent invocation; the build path
  (correctly) treats it as binding only auto-pick eligibility.

**Corrected fix direction (sharper than the original below):** make the slice path
MATCH the build path — `autoSlice`/`allowAgents`(→`autoBuild`) gate ONLY the auto-pick
PRD/slice POOL (the `do-autopick` selection + the `run` eligibility filter), NOT an
explicitly-resolved named target. Concretely: drop the `autoSlice` gate from
`performSlice`'s explicit-named path (keep `humanOnly`/`needsAnswers` — those are the
ITEM's readiness, which DO bind — and keep `sliceAfter`), leaving the policy on the
auto-pick PRD-pool filter where `do-autopick` already consumes the predicate. This is
the SLICE-path analogue of what the build path already does. The advance-loop gate
family (`advance-drivers-and-gates`) should state this rule ONCE for build/slice/
triage uniformly so the asymmetry can't reappear; the `do prd:` fix itself is a small
independent slice that can land before advance-loop (it un-breaks the explicit
slice-now ergonomic the conductor/human relies on).

(Process note: this is also a case the `agent-stop-signal` Decisions channel would
have caught — the slice path's inheritance of the gate onto the explicit form was an
un-surfaced inline decision, divergent from the build path.)
