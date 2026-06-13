---
title: Methodology & skills — how the work/ system relates to Matt Pocock's skills
slug: methodology-and-skills
type: adr
created: 2026-06-03
---

# ADR: methodology & skills

Records the decisions about how this monorepo's `work/` methodology relates to the third-party "Matt Pocock" engineering skills, and the PRD/slice/triage/gate shape — so future sessions don't re-litigate them. (This monorepo IS the project: the `work/` methodology + tooling; `packages/agent-runner` is one implementation; `skills/` holds the methodology skills.)

## 1. The monorepo owns the methodology skills

`skills/to-slices/` (the slicer + the `work/` contract: `WORK-CONTRACT.md`, `CLAIM-PROTOCOL.md`, `scripts/claim.sh`) and `skills/to-prd/` live in this monorepo. `packages/agent-runner` _consumes_ them. The contract stays tool-agnostic (any repo can adopt `work/`); the monorepo is just its home.

## 2. Matt's tracker skills are disabled; we use `work/`-native equivalents

Matt's `to-issues` / `to-prd` / `triage` assume an **issue tracker** (configured by `setup-matt-pocock-skills` → `docs/agents/*.md`). Our tracker is the `work/` contract instead. So:

- **`to-issues` → `to-slices`** (ours). Better for our contract (bakes in status-as-folder, content slugs, `humanOnly`, `prd:`, the `## Prompt` block).
- **`to-prd` → `skills/to-prd`** (ours). Kept CLOSE to Matt's (its structure works), with two changes: writes a FILE (`work/prd/<slug>.md`, no tracker/no setup), and is explicitly a **launch snapshot** (see §4).
- **`triage` → NO skill.** Matt's triage is a label state-machine; our state is folders + a gate, so triage is _decomposed_ into mechanisms we already have: AFK/human gate (set at slice time), `needs-attention/` (post-claim stuck), `out-of-scope/` (wontfix), and `git mv` between folders (transitions). If a real recurring "backlog-review ritual" emerges, write a small `work/`-native skill then — do NOT port Matt's label machine.
- **No setup skill.** Conforming to defaults (ADR §5 below) means there is nothing to configure.

Matt's **engineering** skills (`diagnose`, `tdd`, `prototype`, `grill-me`, `grill-with-docs`, `improve-codebase-architecture`, `zoom-out`) are NOT tracker-coupled — used upstream, verbatim.

## 3. The PRD is a launch snapshot; it is trimmed at slice-time, not maintained

Verified: nothing in Matt's skill set ever updates/syncs a PRD — it is write-once, read-as-source. We adopt the same stance. A PRD WILL be outrun by the work; that is expected. We do NOT fight staleness with ongoing maintenance. Instead:

- `to-prd` writes a fat launch PRD (Problem/Solution/User Stories/Implementation Decisions/Testing Decisions/Out of Scope) with a "launch snapshot, not maintained" banner.
- `to-slices`, after slicing, does a ONE-TIME **trim**: the technical detail moved into the slices, so it is removed from the PRD; durable rationale is relocated to an ADR. The PRD settles to durable framing (Problem/Solution/Stories/Scope) and is then stable _because_ the stale-prone part was relocated, not maintained.

## 4. The autonomy gate: TWO orthogonal axes (`humanOnly` × `needsAnswers`) + the per-repo `autoBuild` policy

Supersedes the single-`humanOnly` gate (which replaced the three-state `afk` + `allowUnspecifiedGate`). The gate is now TWO orthogonal binary fields, present on BOTH slices and PRDs (default omitted = false), because "an agent must not run on this" has two genuinely different _reasons_, and Matt's single HITL/AFK binary conflated them:

- **`humanOnly: true` — the DECIDED axis.** A human must drive this, _regardless of how complete the spec is_ (product/design/security/judgement, or an `AGENTS.md`-type rule). Driven by a decision — in the PRD conversation, or the slicer's own judgement. On a PRD: a human must drive the slicing. On a slice: a human must drive the build.
- **`needsAnswers: true` — the DISCOVERED axis.** Unresolved questions block autonomous progress; the spec is incomplete. The **open questions live in the body**. Once answered the flag clears and an agent may proceed. This is what makes the doc _honest about its own completeness_ instead of forcing a completeness bar (no ADR-rigor gate, no confidence heuristic — just flag it).
- They are **orthogonal**: four honest states (e.g. fully-specified-but-human-owns vs anyone-once-answered). Keeping both is more expressive than one flag.
- **Repo policy `autoBuild`** (per-repo config) — may agents auto-BUILD _undeclared_ items here? The build member of the symmetric per-action gate family (`autoBuild`/`autoSlice`/`autoTriage`). Resolves like `integration`: **CLI flag (`--auto-build`/`--no-auto-build`) > env (`AGENT_RUNNER_AUTO_BUILD`) > per-repo > global > default (false)**. (Renamed from the old name `allowAgents`, now fully removed with no alias since there are no external users owed a migration window; see ADR `ci-config-policy-and-gate-family` and slice `remove-deprecated-config-aliases`.)
- **Predicate (same shape at both levels):** auto-eligible iff `needsAnswers` is not true AND `humanOnly` is not true AND `autoBuild` is true. A human is never bound by it (the gate binds the agent, like the runner-vs-human stance on `verify`).
- **The PRD now CARRIES the gate (it did not before).** With auto-slicing, the human checkpoint that `to-slices` step 4 ("quiz the user") used to provide is removed for the agent path. So whatever that quiz would have extracted must either be pre-committed OR the doc must say it isn't: `to-prd` sets `humanOnly` (decided) and/or `needsAnswers` + body questions (discovered); the auto-slicer refuses to slice a PRD with either flag. This is symmetric, not new machinery.
- Runtime safety net unchanged: an agent that can't responsibly proceed bounces the item to `needs-attention/` (so the gate need not pre-catch everything).

Field-naming: all frontmatter/config keys are **camelCase** (matches the JSON config + the TS parser; 1:1 property mapping). The `humanOnly`+`autoBuild` gate is already shipped (camelCase; `autoBuild` was renamed from `allowAgents`, the old name now fully removed without an alias); `needsAnswers`, plus the `blocked_by`→`blockedBy` rename and `sliceAfter`, are wired into the same eligibility path by a tracked migration slice (not an inline change), keeping the build/test gate green.

## 5. ADRs live in `docs/adr/`, CONTEXT.md at root, and follow the STANDARD ADR format

ADRs (the durable _why_ of decisions) live in `docs/adr/`; the domain glossary is `CONTEXT.md` at the repo root — the conventional locations the domain-aware skills (`diagnose`/`tdd`/`improve-codebase-architecture`/`zoom-out`) read. We conform to these defaults so those skills work with NO setup. `work/findings/` remains for verified external/domain ground-truth notes (distinct from ADRs).

The **ADR format we follow is the standard one**, transcribed (owned, no external runtime dependency) in **`work/protocol/ADR-FORMAT.md`** — sequential `NNNN-slug.md`, one decision per file, body = 1–3 sentences (context, decision, why), optional `status:`/Considered-Options/Consequences sections, and the three-part "when to write one" bar (hard to reverse + surprising + a real trade-off). `setup` copies that doc into every repo's `work/protocol/`.

### 5a. We dropped the earlier ADR-format deviations (decision: conform to the standard)

Earlier iterations of this repo carried three deviations from the standard format: (1) **slug-named instead of `NNNN-`**, (2) **fat, multi-decision `§1–§N` files**, and (3) a **`proposed`-as-"deciding-stage" lifecycle** (observation → proposed ADR → accepted ADR). **We decided to drop all three and conform to the standard format**, because on inspection none earned its keep:

- The **slug-vs-`NNNN`** choice was low-value house aesthetics; the "counters collide" rationale that (correctly) bans counters for _slices_ does NOT apply to ADRs (they are human-authored, low-frequency, not claimed by parallel agents). With no real reason either way, **compatibility wins** → use `NNNN-slug.md`.
- The **fat sectioned files** were how this repo happened to grow, not a tested benefit; one-decision-per-file is the standard and is clearer to supersede/cross- reference. **New ADRs are one-decision-per-file.**
- The **`proposed`-deciding-stage lifecycle was never used** — across all ADRs only two carry a `status:` at all, both `accepted`; zero were ever `proposed`/`superseded`. It was speculative machinery. `status:` remains available exactly as the standard blesses it (`proposed | accepted | deprecated | superseded by ADR-NNNN`, optional, most ADRs omit it), but we define no special pipeline around it.

**Grandfathering:** the two existing multi-decision files (`execution-substrate-decisions.md` §1–§N, this `methodology-and-skills.md`) stay as-is — valid and not worth churning. The conform-to-standard rule governs ADRs written from here on; existing slug-named/sectioned files are not retro-renamed.
