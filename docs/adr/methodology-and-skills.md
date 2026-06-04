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

## 4. The autonomy gate: a slice `humanOnly` field + a per-repo `allowAgents` policy

Replaces the old three-state `afk: true|false|omitted` + `allowUnspecifiedGate`.

- **Slice field `humanOnly: true`** (or undefined) \u2014 the slice declares itself
  human-only (a product/design/security/judgement call; never auto-claim). Most
  slices omit it. This is the ONLY autonomy field on a slice, and it is
  authoritative.
- **Repo policy `allowAgents`** (per-repo config) \u2014 may agents claim *undeclared*
  (not `humanOnly`) slices in this repo? Resolves like `integration`:
  **CLI flag (`--allow-agents` / `--no-allow-agents`) > per-repo > global >
  default (false)**.
- **Resolution:** agent-claimable iff `humanOnly` is not true AND `allowAgents`
  is true. `humanOnly: true` is never agent-claimable regardless.
- **The PRD informs but does not carry the gate:** the `to-prd` conversation
  surfaces which stories/areas are human-only and records it as PROSE; `to-slices`
  uses that to set `humanOnly` on the covering slices. The PRD never has a
  machine gate field (it is a snapshot; a machine gate there would go stale).
- Runtime safety net: an agent that can't responsibly build an undeclared slice
  bounces it to `needs-attention/` (so the gate need not pre-catch everything).

This rename/restructure touches the contract + done code (`scan`, eligibility,
the human dashboard, `run-once`) and is implemented by the `humanonly-gate` slice
(not an inline change).

## 5. ADRs live in `docs/adr/`, CONTEXT.md at root (conform to convention)

ADRs (the durable *why* of decisions) live in `docs/adr/`; the domain glossary is
`CONTEXT.md` at the repo root \u2014 the conventional locations Matt's domain-aware
skills (`diagnose`/`tdd`/`improve-codebase-architecture`/`zoom-out`) read. We
conform to these defaults so those skills work with NO setup. `work/findings/`
remains for investigation/ground-truth notes (distinct from ADRs).
