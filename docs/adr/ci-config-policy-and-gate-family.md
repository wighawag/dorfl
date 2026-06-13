---
title: CI config policy = the engine gate family (always advance; install-ci is one-time; question-surfacing is two calm-default gates)
status: accepted
created: 2026-06-12
decided: 2026-06-12
supersedes:
superseded_by:
---

# ADR: CI config policy, the gate family, and one-time install-ci

## Context

`runner-in-ci` (`work/prd/runner-in-ci.md`) makes CI run the autonomous rungs
headless. A long design pass asked: what knobs does CI need, where do they live,
and does CI introduce a new "enable advanced features" gate? The answer that
emerged reshapes the gate family itself, and the conclusion is: **CI is NOT a
special policy surface.** It is the same engine policy (the `Config` gate family,
resolved through the same `flag > env > per-repo > global > default` chain) running
in GitHub Actions. The only CI-specific artifact is auth + a fixed workflow shell.

## Decision

### 1. CI always runs `advance`; the verb is never a user decision

`advance` is a strict superset of `do` (build slice / slice PRD), adding the
lifecycle rungs (triage an observation, surface a declared-open question, apply a
committed answer). With the lifecycle gates at their calm defaults (below),
`advance` degrades to exactly `do`'s build/slice behaviour. So there is no reason
to expose a `do`-vs-`advance` choice in CI: the generated workflow ALWAYS invokes
`advance`, and what it actually does is tuned entirely by config/env. This removes
the most confusing decision from the user's head.

(The same logic applies to the laptop daemon `run`; unifying `run` onto the
advance tick is a sibling engine change, captured as its own work item, not part of
this ADR. The advance loop driver already reuses `run`'s parallel scheduler, so the
swap is the one the advance-loop design explicitly anticipated.)

### 2. No `autoAdvance` gate. Question-surfacing is TWO independent gate-family members

The autonomous lifecycle decomposes fully into the gate family; there is no
ungated rung needing a new master flag. The family:

| autonomous rung | gate | OFF behaviour |
| --- | --- | --- |
| build an undeclared slice | `autoBuild` (bool) | rung does not run |
| slice an undeclared PRD | `autoSlice` (bool) | rung does not run |
| triage an observation | **`observationTriage`** (`off` / `ask` / `auto`) | see below |
| surface a declared `needsAnswers` blocker | **`surfaceBlockers`** (bool) | declared-blocked item is left silently blocked, not rendered as a question |
| apply a committed answer | (always allowed) | n/a |

Two NEW members replace the old `autoTriage` boolean, because the two
question-sources serve DIFFERENT user jobs and a user can legitimately want either,
both, or neither:

- **`observationTriage` (3-state, default `off`)** governs the observation INBOX
  (raw captured signal the user has not yet looked at):
  - `off`: the triage rung does not run; observations are left untouched (NEW
    state; the old `autoTriage:false` had no way to express this);
  - `ask`: surface a promote/keep/delete question for every untriaged observation
    (the old `autoTriage:false` behaviour);
  - `auto`: auto-dispose ONLY the no-question cases (exact-duplicate ⇒ recommend
    delete; unambiguous map) and surface a question for the rest (the old
    `autoTriage:true`). It still never auto-deletes a non-duplicate or auto-promotes
    a judgement call.

- **`surfaceBlockers` (bool, default `off`)** governs DECLARED work that is blocked:
  whether a slice/PRD carrying `needsAnswers: true` is rendered into an answerable
  question sidecar (`on`) or left silently blocked in the backlog (`off`). This is
  a different job from observation triage: it is about committed work items, not the
  raw inbox.

This is `observationTriage` and `surfaceBlockers` are ORTHOGONAL peers, not a
hierarchy: all four corners are meaningful (notably "groom my observation inbox but
leave my blocked work alone" = `observationTriage: ask|auto` + `surfaceBlockers:
off`, the case a single global switch could not express).

**Gates decide what is PRESENT; selection order decides what runs FIRST (separate
axes).** A gate set OFF removes its pool from the auto-pick enumeration entirely
(`autoBuild`/`autoSlice` already work this way; `observationTriage`/`surfaceBlockers`
extend it to the lifecycle pools, once `advance-autopick-lifecycle-pools` adds them).
What to do across the pools that ARE present is a separate config axis,
`selectionOrder` (slice `advance-selection-order-config`):

- **`apply` is PINNED FIRST, not configurable** (consuming a human's committed
  answer is highest-value, cheap, and someone is waiting, deprioritizing it is never
  a real want; the create-vs-consume principle again).
- **`selectionOrder` ranks the other four** (`build` / `slice` / `surface` /
  `triage`) and accepts EITHER a preset keyword OR an explicit pool-order list (the
  preset is sugar over a list; canonical form is the list). `drain` (default) =
  `[build, slice, surface, triage]` (drain ready work, then create, then ask,
  generalizing today's slices-first "drain before create"); `groom` =
  `[surface, triage, build, slice]`. It SUBSUMES the old `prdsFirst` boolean
  ("slices before PRDs" is just `build` before `slice`), which is removed.
- A pool named in the order but gated OFF is simply absent (a no-op, not an error):
  order ranks what the gates left present.

### 3. Calm defaults; no master switch needed

Both new gates default to their quiet state (`observationTriage: off`,
`surfaceBlockers: off`), so out-of-the-box CI builds/slices (subject to
`autoBuild`/`autoSlice`) and reports failures, but asks NOTHING until the user opts
in. Because calm is the default, no global "shut up" master switch is needed; the
single-switch convenience it would provide is already the default state.

### 4. The gates govern CREATE only; CONSUME and REPORT are always-on

Questions have three lifecycle phases, and only the FIRST is gateable:

| phase | what it is | gated by |
| --- | --- | --- |
| **surface / triage** | the bot CREATES a question | `observationTriage` / `surfaceBlockers` |
| **apply** | the bot CONSUMES the human's committed answer | ALWAYS on (never gate) |
| **needs-attention** | the bot REPORTS a failure (red gate, drift, ambiguity) | ALWAYS on (separate mechanism) |

The gates only ever touch CREATE ("don't make noise"). `apply` is always-allowed,
gating it would STRAND a human's committed answer (they answered; nothing happens),
violating the "human is the clock" model. So an already-answered sidecar applies
even when its create-gate is off. `needs-attention` is likewise always-on, silently
dropping failed work is never acceptable; it shares no flag with the two gates and
is left exactly as it is. The clean line: gateable = "don't make noise"; never
gateable = "don't discard the human's work / don't hide a failure."

**Per-SUB-STEP, not per-rung (the apply-followup edge).** `apply` has a re-pause
sub-step that can APPEND NEW follow-up questions (`appendQuestions`/`applyFollowups`,
`apply-persist.ts`) when answering one question raises more judgement. That is a
CREATE act. So the principle is applied per sub-step: writing the human's answer +
resolve/disposition is CONSUME (always on); MINTING fresh bot follow-ups is CREATE
(respects the create-gate, so gate-off ⇒ apply the answer and RESOLVE, do not spawn
the surface skill to mint new questions). VERIFIED 2026-06-12: follow-up generation
is NOT wired in production today (`applyFollowups` is set only by tests; `cli.ts`/
`advance-drivers.ts` never thread it), so apply is pure consume now and the invariant
holds as-is. The gating obligation lands only IF/WHEN follow-up generation is wired.
Open at that point: the `NewQuestion[]` seam carries no provenance, so it cannot yet
distinguish a HUMAN-authored follow-up (consume, still honoured) from a BOT-minted
one (create, gated), that distinction must be added before apply mints followups.

### 5. These are engine `Config` fields (per-repo + env + flag), not CI-only knobs

`observationTriage` and `surfaceBlockers` join the gate family as first-class
`Config` members threading the SAME 5 points the existing gates use: `config.ts`
(field + default), `repo-config.ts` `REPO_ALLOWED_KEYS` (per-repo
`.agent-runner.json`), `env-config.ts` `KEY_COERCIONS` (the `AGENT_RUNNER_*` layer;
`observationTriage` is an ENUM coercion like `integration`), the CLI flags
(`do-config.ts`/`cli.ts`), and the read site at the advance lifecycle rungs.

They govern the ADVANCE LIFECYCLE path (advance auto-pick, `advance -n`,
`run --advance`). Plain `run` (build-only) and `do` have no triage/surface/apply
rungs, so the two gates are no-ops there, correctly the calm build-only shape by
construction.

Because they are normal `Config` fields, CI gets env-controllability for FREE: the
generated workflow's `AGENT_RUNNER_*` env block (or a GitHub repo variable) sets
them, and the SAME `.agent-runner.json` the laptop uses applies in CI too. CI stops
being a special policy surface.

### 6. install-ci is ONE-TIME; all policy is env/config

`install-ci` does TWO sticky things: set auth secrets, and drop ONE fixed workflow
shell. It is re-run only to rotate auth or upgrade the workflow itself. EVERYTHING a
user might change their mind about (the gates above, `integration` propose/merge,
`review`/`autoMerge`) is an `AGENT_RUNNER_*` env var / repo variable / committed
`.agent-runner.json` key, edited WITHOUT re-running `install-ci`. The workflow is a
thin shell that inherits repo config + optional env overrides.

### 7. Workflow shape: dynamic matrix for propose, sequential for merge

One fixed workflow file carries both shapes, selected at runtime by a dispatch
input / repo variable (no re-install):

- **propose → a DYNAMIC matrix** (the default): an `enumerate` job runs
  `agent-runner scan --json | jq` to emit a DEDUPLICATED list of eligible item ids;
  the matrix fans out one leg per id; each leg `advance <id> --propose` opens its own
  independent PR.
- **merge → a SINGLE SEQUENTIAL job** (`advance -n <x> --merge`): merge-mode items
  integrate into `main` and rebase-chain, so they MUST linearise.

**The claim CAS, not the matrix, is the safety mechanism.** The matrix is a
fan-out convenience handed a pre-deduplicated snapshot. Distinctness WITHIN a run
comes from the enumeration (a `jq` projection over a set has no duplicates). Across
runs / against a stale snapshot, the per-leg CLAIM CAS guarantees
at-most-one-builder-per-item: a leg that loses the race exits clean (`contended`/
`lost`), never double-builds. So a matrix is safe but occasionally wastes a runner on
a lost race, never a correctness risk. Do NOT "harden" the matrix under the false
belief it is load-bearing for correctness.

**Why merge cannot use the matrix:** propose's contended resource is per-item (the
claim handles it, independent branches/PRs). Merge's contended resource is `main`
itself; N parallel legs racing `main` produce rebase thrash for no benefit (merges
linearise at the target anyway). So sequence IS the serialiser for merge.

### 8. The merge-vs-propose POLICY (per capability) and AUTHOR-TRUST stay as recorded

CI derives the integration mode per artifact from the downstream gate (a PRD merged
iff a human must slice it next; a slice merged iff a human must build it next) and,
for issue intake, the author-trust axis (untrusted author ⇒ propose regardless).
The fully-gateless "issue → slice → build → main, no human" path is a loud,
non-default opt-in. See `work/prd/runner-in-ci.md` for the policy table; it is
unchanged by this ADR.

## Naming (an acknowledged trap, now resolved)

`autoTriage` READ like "is triage on?" but actually gated the auto-DISPOSITION
exception, so `autoTriage: off` surprisingly still surfaced a question for every
observation. Splitting it into `observationTriage` (with an explicit `off`) +
`surfaceBlockers` resolves the trap: the names now say what they gate.

## No deprecation aliases while there are no external users

This repo has NO external users yet (decided 2026-06-12), so config RENAMES are
CLEAN REPLACEMENTS, not aliased migrations. `autoTriage` is DELETED outright (not
aliased to `observationTriage`); the existing `allowAgents -> autoBuild` alias is
ALSO removed (slice `remove-deprecated-config-aliases`). A value-migrating alias
would additionally have been a trap here: the env legacy-alias path coerces the OLD
var with the NEW key's coercion, so `AGENT_RUNNER_AUTO_TRIAGE=false` against an enum
coercion would THROW. Avoided by not aliasing. Reinstate the alias discipline only
once the tool has real downstream users owed a migration window.

## Consequences

- The gate family is coherent: `autoBuild`/`autoSlice` (build/slice) + `observationTriage`/`surfaceBlockers` (the two question sources), all per-repo + env + flag.
- CI policy is fully expressible by config/env; `install-ci` is genuinely one-time.
- The verb decision (`do` vs `advance`) is eliminated from CI; "calm build-only" is `advance` + both lifecycle gates off, not a different verb.
- Engine work falls out (captured as `work/ideas/`): the `autoTriage -> observationTriage` 3-state migration; the `surfaceBlockers` gate; unifying `run` onto the advance tick.
- Cross-refs: `command-surface-and-journeys.md` (the gate family + the autonomous face), `work/prd/runner-in-ci.md` ("Config & gate model in CI"), `config.ts`/`repo-config.ts`/`env-config.ts` (the gate-family plumbing), `advance-loop-driver.ts` ("run == CI: swap the tick, keep the loop").
