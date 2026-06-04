---
title: Methodology & skills — how the work/ system relates to Matt Pocock's skills
slug: methodology-and-skills
type: adr
created: 2026-06-03
---

# ADR: methodology & skills

Records the decisions about how this monorepo's `work/` methodology relates to
the third-party "Matt Pocock" engineering skills, and the PRD/slice/triage/gate
shape — so future sessions don't re-litigate them. (This monorepo IS the project:
the `work/` methodology + tooling; `packages/agent-runner` is one implementation;
`skills/` holds the methodology skills.)

## 1. The monorepo owns the methodology skills

`skills/to-slices/` (the slicer + the `work/` contract: `WORK-CONTRACT.md`,
`CLAIM-PROTOCOL.md`, `scripts/claim.sh`) and `skills/to-prd/` live in this
monorepo. `packages/agent-runner` *consumes* them. The contract stays
tool-agnostic (any repo can adopt `work/`); the monorepo is just its home.

## 2. Matt's tracker skills are disabled; we use `work/`-native equivalents

Matt's `to-issues` / `to-prd` / `triage` assume an **issue tracker** (configured
by `setup-matt-pocock-skills` → `docs/agents/*.md`). Our tracker is the `work/`
contract instead. So:

- **`to-issues` → `to-slices`** (ours). Better for our contract (bakes in
  status-as-folder, content slugs, `humanOnly`, `prd:`, the `## Prompt` block).
- **`to-prd` → `skills/to-prd`** (ours). Kept CLOSE to Matt's (its structure
  works), with two changes: writes a FILE (`work/prd/<slug>.md`, no tracker/no
  setup), and is explicitly a **launch snapshot** (see §4).
- **`triage` → NO skill.** Matt's triage is a label state-machine; our state is
  folders + a gate, so triage is *decomposed* into mechanisms we already have:
  AFK/human gate (set at slice time), `needs-attention/` (post-claim stuck),
  `out-of-scope/` (wontfix), and `git mv` between folders (transitions). If a
  real recurring "backlog-review ritual" emerges, write a small `work/`-native
  skill then — do NOT port Matt's label machine.
- **No setup skill.** Conforming to defaults (ADR §5 below) means there is
  nothing to configure.

Matt's **engineering** skills (`diagnose`, `tdd`, `prototype`, `grill-me`,
`grill-with-docs`, `improve-codebase-architecture`, `zoom-out`) are NOT
tracker-coupled — used upstream, verbatim.

## 3. The PRD is a launch snapshot; it is trimmed at slice-time, not maintained

Verified: nothing in Matt's skill set ever updates/syncs a PRD — it is write-once,
read-as-source. We adopt the same stance. A PRD WILL be outrun by the work; that
is expected. We do NOT fight staleness with ongoing maintenance. Instead:

- `to-prd` writes a fat launch PRD (Problem/Solution/User Stories/Implementation
  Decisions/Testing Decisions/Out of Scope) with a "launch snapshot, not
  maintained" banner.
- `to-slices`, after slicing, does a ONE-TIME **trim**: the technical detail moved
  into the slices, so it is removed from the PRD; durable rationale is relocated
  to an ADR. The PRD settles to durable framing (Problem/Solution/Stories/Scope)
  and is then stable *because* the stale-prone part was relocated, not maintained.

## 4. The autonomy gate: TWO orthogonal axes (`humanOnly` × `needsAnswers`) + the per-repo `allowAgents` policy

Supersedes the single-`humanOnly` gate (which replaced the three-state `afk` +
`allowUnspecifiedGate`). The gate is now TWO orthogonal binary fields, present on
BOTH slices and PRDs (default omitted = false), because "an agent must not run on
this" has two genuinely different *reasons*, and Matt's single HITL/AFK binary
conflated them:

- **`humanOnly: true` — the DECIDED axis.** A human must drive this, *regardless
  of how complete the spec is* (product/design/security/judgement, or an
  `AGENTS.md`-type rule). Driven by a decision — in the PRD conversation, or the
  slicer's own judgement. On a PRD: a human must drive the slicing. On a slice: a
  human must drive the build.
- **`needsAnswers: true` — the DISCOVERED axis.** Unresolved questions block
  autonomous progress; the spec is incomplete. The **open questions live in the
  body**. Once answered the flag clears and an agent may proceed. This is what
  makes the doc *honest about its own completeness* instead of forcing a
  completeness bar (no ADR-rigor gate, no confidence heuristic — just flag it).
- They are **orthogonal**: four honest states (e.g. fully-specified-but-human-owns
  vs anyone-once-answered). Keeping both is more expressive than one flag.
- **Repo policy `allowAgents`** (per-repo config) — may agents claim *undeclared*
  items here? Resolves like `integration`: **CLI flag
  (`--allow-agents`/`--no-allow-agents`) > per-repo > global > default (false)**.
- **Predicate (same shape at both levels):** auto-eligible iff `needsAnswers` is
  not true AND `humanOnly` is not true AND `allowAgents` is true. A human is never
  bound by it (the gate binds the agent, like the runner-vs-human stance on
  `verify`).
- **The PRD now CARRIES the gate (it did not before).** With auto-slicing, the
  human checkpoint that `to-slices` step 4 ("quiz the user") used to provide is
  removed for the agent path. So whatever that quiz would have extracted must
  either be pre-committed OR the doc must say it isn't: `to-prd` sets `humanOnly`
  (decided) and/or `needsAnswers` + body questions (discovered); the auto-slicer
  refuses to slice a PRD with either flag. This is symmetric, not new machinery.
- Runtime safety net unchanged: an agent that can't responsibly proceed bounces
  the item to `needs-attention/` (so the gate need not pre-catch everything).

Field-naming: all frontmatter/config keys are **camelCase** (matches the JSON
config + the TS parser; 1:1 property mapping). The `humanOnly`+`allowAgents` gate
is already shipped (camelCase); `needsAnswers`, plus the `blocked_by`→`blockedBy`
rename and `sliceAfter`, are wired into the same eligibility path by a tracked
migration slice (not an inline change), keeping the build/test gate green.

## 5. ADRs live in `docs/adr/`, CONTEXT.md at root (conform to convention)

ADRs (the durable *why* of decisions) live in `docs/adr/`; the domain glossary is
`CONTEXT.md` at the repo root — the conventional locations Matt's domain-aware
skills (`diagnose`/`tdd`/`improve-codebase-architecture`/`zoom-out`) read. We
conform to these defaults so those skills work with NO setup. `work/findings/`
remains for investigation/ground-truth notes (distinct from ADRs).

### 5a. ADR `status:` lifecycle (the "deciding" stage has a home)

ADRs carry a **`status:`** frontmatter field — `proposed | accepted | superseded`
— which is the OPTIONAL-but-blessed field of the canonical ADR format
(`grill-with-docs/ADR-FORMAT.md`: *"Status frontmatter … useful when decisions are
revisited"*). This fills a real gap in the lifecycle: between an **observation**
(spotted, unverified) and an **accepted ADR** (decided) sits the *deciding* stage
— a VERIFIED problem with candidate options, not yet resolved. That stage is a
**`status: proposed` ADR**: it states the contradiction/forces + the considered
options + a recommended direction, explicitly NOT yet accepted. A later design
session flips it to `accepted` (recording the chosen option) or writes a
superseding ADR. So the decision pipeline is:

> observation (`work/observations/`, unverified) → **proposed ADR** (verified
> problem + options, undecided) → **accepted ADR** (decided) → slices (build).

Use a proposed ADR (not an `idea`) when it is a *problem/decision* (backward-
looking, "the current model contradicts itself"), not a forward-looking
opportunity (those stay `work/ideas/`).

### 5b. Deliberate deviation from Matt's ADR numbering (recorded so it is not "fixed")

Matt's `ADR-FORMAT.md` prescribes **sequential, one-decision-per-file**
(`0001-slug.md`, …, thin, often a paragraph). **We deliberately deviate:** our
ADRs are **slug-named** (`execution-substrate-decisions.md`,
`claim-ledger-vs-protected-main.md`) and may be **fat + sectioned** (one file
gathering related decisions as `§1–§N`). This is intentional house style, not an
oversight — recorded here per Matt's own rule ("deliberate deviations from the
obvious path… stop the next engineer from ‘fixing’ something that was
deliberate"). The domain-aware skills read ADRs for *context* (and to not
re-litigate); they do not hard-parse the sequential number, so this degrades
gracefully — a cross-reference is by slug/section rather than `ADR-NNNN`.
