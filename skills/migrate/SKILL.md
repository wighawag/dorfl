---
name: migrate
description: "Convert an EXISTING repo's material into the file-based work/ contract — its task tracker / TODOs / design docs into PRDs and slices, and an understanding of its codebase into work/findings/ (NOT ADRs). Judgement-heavy and model-driven: it maps fuzzy existing artifacts onto the right buckets, sets the two gate axes, and FLAGS candidate decisions for a human to promote to ADRs — it NEVER auto-authors an ADR (an ADR records a DECISION + its why, which is not recoverable from code; reverse-engineered code is a finding, a description). Composes the setup skill for the scaffold (does not reimplement it). Use when adopting a populated/legacy repo, converting a tasks/ folder or issue export or design docs into work/ items, or generating a findings overview of an unfamiliar codebase. For a fresh/empty repo or just the scaffold, use setup directly."
---

# migrate

Convert an **existing** repo's material into the `work/` contract. This is the
**judgement-heavy** counterpart to `setup`: where `setup` is deterministic
scaffolding, `migrate` READS existing artifacts (a task tracker, TODOs, design docs,
source) and MAPS them onto the right contract buckets — work that needs a model and
human ratification, not a template.

It composes `setup`: run that FIRST for the scaffold, then do the three conversion
passes below. Keep the boundary — `setup` creates the skeleton; `migrate` fills it
from what already exists.

## The one discipline that matters most: NEVER auto-author an ADR

An **ADR** (`docs/adr/`) records a **DECISION + its why** — the rejected options, the
constraints, the reasoning. That is **usually NOT recoverable from code or docs**.
Reverse-engineering a codebase yields **description / ground-truth** = a **`finding`**,
not a decision. So:

- **migrate writes `work/findings/` (or a `docs/` overview), NEVER `docs/adr/`.**
- When migrate spots something that LOOKS like a decision (a design doc says "we chose
  X over Y because Z"), it **FLAGS it as a candidate ADR for a human to promote** — it
  does not author the ADR itself. Auto-authoring ADRs pollutes the one thing ADRs are
  precious for (the durable record of deliberate choices).
- This is non-negotiable. A finding can be wrong and re-verified cheaply; a fabricated
  ADR corrupts the decision record silently.

## Procedure

### 0. Inventory enough to seed, THEN scaffold (compose `setup`)

Glance over the repo FIRST (READMEs, top-level docs, the manifest(s), CI config, the
directory shape) — just enough to form two seeds for `setup`:

- a **proposed one-to-two-sentence description** of what the repo is + its core
  domain nouns; and
- a **proposed `verify` gate** discovered from the repo, NOT guessed from the
  ecosystem (read CI `.github/workflows/*` first, then the real task-runner/scripts;
  treat the manifest only as a hint — the same detect-don't-assume order `setup`
  step 3 spells out). You are already reading the code, so you are well placed to
  spot decoys (e.g. a Rust crate that also ships an npm install-wrapper
  `package.json` with no build/test scripts — the gate is `cargo`, not the wrapper).

Then run the **`setup`** skill, **handing it both seeds** so its adoption
conversation becomes "here is what I think this repo is — correct me?" (not a cold
"what is this repo about?") and its gate step becomes "here is the `verify` I detected
— confirm?" (not a re-derivation). (`setup` still owns the conversation, the gate
write, and the never-clobber detection, and the human still ratifies both; `migrate`
only spares the cold opens, because it has already read the repo.) `setup` scaffolds
the `work/` skeleton, `CONTEXT.md`, and the `.agent-runner.json`, working identically
on this populated repo. Do NOT reimplement any of that here. When `setup` returns, you
have the buckets to fill.

### 1. Inventory the existing material (read-only first)

Survey what the repo already has (this deepens the glance from step 0), and classify
each source by what it should BECOME — do NOT convert yet, just map:

- **A task/issue system** — a `tasks/` folder, a TODO.md, an issue-tracker export,
  GitHub issues → candidate **slices** (one ask, one slice) or **PRDs** (a coherent
  ask needing >1 slice). The 1-slice-vs-PRD rule: a single buildable ask is a
  **slice**; an ask that needs **>1 slice** (a shared vision spanning several units of
  work) is a **PRD**.
- **Design docs / RFCs / architecture notes** — read each: is it a north-star plan
  (→ **PRD** or **idea**), a decision-with-rationale (→ **candidate ADR**, FLAG for
  human), or a description of how something works (→ **finding**)?
- **READMEs / wikis / inline docs** — domain vocabulary → seed/extend `CONTEXT.md`'s
  glossary; how-it-works content → **finding**.
- **The source code itself** — pass 3 (generate understanding) — → **findings**.
- **Loose "we should…" / "known issue" notes** → **ideas** (proposed) or
  **observations** (spotted, unverified).

Produce a short **mapping table** (source → target bucket + a one-line why) and SHOW
it to the user before converting. This is the highest-judgement step — get the
routing agreed before writing files.

### 2. Convert the task/work system → PRDs + slices (the core value)

For the agreed task-system sources, produce contract items by COMPOSING the producer
skills — do NOT reimplement slicing/PRD-writing:

- A single, clear, buildable ask → a **`work/backlog/<slug>.md`** slice (use
  `to-slices`' slice shape; `covers: []`, no `prd:` — its own source of truth).
- A coherent ask that needs >1 slice → a **`work/prd/<slug>.md`** PRD (use `to-prd`'s
  framing). Slice it only if asked (separate `to-slices` step) — usually leave the PRD
  for the human to slice.
- **Set the two gate axes honestly per item** (WORK-CONTRACT §3b): `humanOnly: true`
  where building needs human judgement/security; `needsAnswers: true` where the source
  was under-specified (list the open questions in the body — do NOT guess a spec from a
  vague TODO; an honest `needsAnswers` stub is correct, a confident wrong slice is not).
- **Slice ↔ PRD link:** a self-contained slice (chore/refactor/build-fix, covering no
  PRD user stories) carries `covers: []` and **omits `prd:`** — it is its own source
  of truth (a standalone *What to build* + *Prompt*). A slice that points into a PRD's
  user stories MUST set `covers: [...]` AND name that PRD in `prd:` (the rule is
  `prd` **required iff `covers` is non-empty** — see WORK-CONTRACT.md). Do not invent
  a `prd:` link for a slice that derives from no PRD.
- Content-derived slugs, never counters. Preserve any traceability (e.g. an
  `issue: N` link on a PRD) if the source had it.

### 3. Generate understanding from the code → `findings/` (with the ADR caveat)

Where useful (an unfamiliar/legacy codebase), produce a **`work/findings/`** overview
(or a `docs/` architecture doc) describing how the system actually works — the
modules, the seams, the external protocols/APIs it integrates with (verified
ground-truth, the legitimate use of a finding). As you go:

- **FLAG candidate ADRs** — when the code/docs reveal a deliberate choice with
  rationale, record it as "**candidate decision** (for a human to promote to an ADR):
  …" in the finding or a separate list. Never write the ADR.
- Keep findings as ground-truth description; keep speculation in `observations/`.

### 4. Report + hand off (no auto-commit)

- REPORT every file created, grouped by bucket, plus the **candidate-ADR list** the
  human must review/promote, plus anything you left as `needsAnswers`/`observations`
  for them to resolve.
- **Update `CONTEXT.md` to reflect what migrate actually populated:** fold any
  domain vocabulary you surfaced into its glossary, and — since `setup`'s template
  only mentions the buckets generically — note which buckets this repo now uses (e.g.
  "this repo carries reverse-engineered `findings/` for X" / "open questions live in
  `needsAnswers` slices"). Append/merge only; never clobber what `setup` or the human
  already wrote there.
- **Git etiquette:** do NOT stage/commit/push — leave everything in the working tree
  for the user to inspect and commit (the producer convention shared with
  `setup`/`to-prd`/`to-slices`). Migrating a big repo is iterative: bound each run to a
  subset (one source area at a time), report, let the human review, run again — the
  same self-bounding discipline as the batching skills.

## Boundaries

- **NEVER auto-author `docs/adr/`** — flag candidates only (the §discipline above).
- **Compose, don't reimplement:** `setup` for the scaffold, `to-prd`/`to-slices` for
  PRD/slice shapes. migrate adds only the inventory/mapping judgement + the
  code→findings pass.
- **findings = verified external/domain ground-truth**, NOT internal post-mortems
  (those are observations) and NOT decisions (those are ADRs). See WORK-CONTRACT.md.
- It converts; it does not BUILD or claim anything (that is the runner). A migrated
  slice is just another `backlog/` item the normal engine then advances.
