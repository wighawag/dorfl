---
name: migrate
description: "Convert an EXISTING repo's material into the file-based work/ contract — its task tracker / TODOs / design docs into PRDs, slices, or ideas (a vague wish is an idea, NOT a needsAnswers slice), and an understanding of its codebase split by polarity: EXTERNAL behaviour it integrates with into work/findings/ (each with a source/provenance), our own code's shape into CONTEXT.md/docs (NOT findings), and deliberate decisions into ADRs by ELICITING the why from the human (NEVER inventing it). Judgement-heavy and model-driven: it maps fuzzy existing artifacts onto the right buckets, sets the two gate axes, and writes an ADR for a decision IFF the user supplies the why (asked live during the run); if the user is absent/unsure/declines it writes NOTHING and lets the code stand as its own pre-ADR — it NEVER infers a why or persists a pre-ADR/candidate holding artifact. Composes the setup skill for the scaffold (does not reimplement it). Use when adopting a populated/legacy repo, converting a tasks/ folder or issue export or design docs into work/ items, or generating an external-integration findings overview of an unfamiliar codebase. For a fresh/empty repo or just the scaffold, use setup directly."
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

> **Where the contract docs live:** `setup` copies the protocol reference docs into
> the target repo's **`work/protocol/`** (`WORK-CONTRACT.md`, `ADR-FORMAT.md`, the
> templates, `CLAIM-PROTOCOL.md`). Every bare "WORK-CONTRACT" / "ADR-FORMAT" mention
> below refers to `work/protocol/<doc>` in the repo you are migrating — read them
> there, not from a sibling skill folder.

## The one discipline that matters most: an ADR is written IFF we have the WHY — else write nothing; the code is the pre-ADR

An **ADR** (`docs/adr/`) records a **DECISION + its why** — the rejected options, the
constraints, the reasoning. The *why* is **usually NOT recoverable from code or docs**;
the *what* (the decision the code embodies) often IS. Reverse-engineering a codebase
yields **description / ground-truth**, not a rationale. So migrate's rule is simple and
absolute:

- **Write an ADR if and ONLY if you have a complete, clear decision — the *what* AND a
  real *why*.** The only legitimate source of the why is the **human**.
- When migrate spots something that LOOKS like a decision (a design doc or the code
  reveals "we chose X over Y") AND it is **ADR-worthy** — i.e. all three of *hard to
  reverse* AND *surprising without context* (a future reader would wonder "why on
  earth this way?") AND *the result of a real trade-off* (there were genuine
  alternatives) — it **ASKS the user, during the `/migrate` run: "Why was this done?
  What were the alternatives and constraints?"** If the user answers, migrate writes a
  **complete ADR in `docs/adr/`** from THAT answer — the why came from the human, so
  the record is honest. (Keep it short: an ADR can be a single paragraph stating the
  context, the decision, and the why; sections like options/consequences only if they
  add value.)
- **If the user is absent, declines, or does not know the why — migrate writes
  NOTHING.** No `proposed`/pre-ADR, no `docs/adr/candidates/` folder, no holding doc,
  no candidate-flag, no question-list file. The **code itself remains the pre-ADR**:
  it already embodies the decision, is always current, and re-surfaces the same "why is
  this so?" question to the next reader who cares — who can then ask a human and record
  the answer as an ADR. A stored "open question" artifact nobody maintains would just
  rot; the absence of one is the feature.
- **This is non-negotiable.** migrate NEVER writes an ADR whose *why* it inferred from
  code — a fabricated rationale corrupts the decision record silently. No why from a
  human → no ADR. (If you genuinely think an un-answered observation is worth keeping,
  the normal `observations/` judgement still applies — but do NOT route there by
  default; over-using it just rebuilds the graveyard this rule exists to avoid.)

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
  GitHub issues. Route each by *how buildable it actually is*, NOT by default to a
  slice (the common mistake — see the buildability gate in step 2):
  - a **scoped, buildable** ask → a **slice** (one ask, one slice);
  - a **coherent ask needing >1 slice** (a shared vision) → a **PRD**;
  - a **wish / “maybe” / blocked-on-external / one-line sketch** (e.g. “support X
    once upstream Y lands”, “access Z?”) → an **idea**, NOT a slice. A vague TODO
    line is an `idea`, not a `needsAnswers` slice (see step 2).
- **Design docs / RFCs / architecture notes** — read each: is it a north-star plan
  (→ **PRD** or **idea**), a decision-with-rationale (→ if it carries a real *why*,
  it may seed an **ADR**; if the *why* is absent, ASK the user — answered → ADR, else
  write nothing; see the discipline above), or a description of how something works
  (→ split by polarity: *external* behaviour → **finding** with a `source:`; *our own*
  code's shape → **`CONTEXT.md` / `docs/`**, never `findings/`)?
- **READMEs / wikis / inline docs** — domain vocabulary → seed/extend `CONTEXT.md`'s
  glossary; how-our-code-works content → **`CONTEXT.md` / `docs/`**; how-an-external-
  thing-works content → **finding** (with `source:`).
- **The source code itself** — pass 3 (generate understanding). Reading our code
  yields description of OUR code → **`CONTEXT.md` / `docs/`**; only the *external
  behaviour our code integrates with* (an API's real responses, a wire format, a spec)
  becomes a **finding** — and a code-derived finding records `source:` = the code it
  was read from (weakest provenance; see WORK-CONTRACT findings box).
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
- **Buildability gate — decide slice-vs-idea BEFORE writing anything to `backlog/`.**
  A `backlog/` slice is for a **scoped, buildable** ask. `needsAnswers: true` is for a
  **near-complete spec with a few SPECIFIC open questions listed in the body** — it is
  *almost a slice*, not a wish. A vague one-liner ("support zksync once hardhat v3
  lands", "companion-network access?") is NEITHER a slice nor a `needsAnswers` slice —
  it is an **`idea`**. The contract is explicit: *under-specified items should not be
  written into `backlog/` until they are ready* (WORK-CONTRACT, needs-attention §).
  **When in doubt, route to `ideas/`, not `backlog/`.** Do NOT manufacture a
  `needsAnswers` slice to "capture" a wish — that pollutes the grabbable-work folder
  with non-work; an `idea` is the honest home, and it can graduate to a PRD/slice once
  the human firms it up.
- **Set the two gate axes honestly per item** (WORK-CONTRACT §3b), once you have
  decided the item really is a slice: `humanOnly: true` where building needs human
  judgement/security; `needsAnswers: true` where the spec is *near-complete but has
  specific listed open questions* (NOT where it is merely vague — that is an `idea`).
  An honest `needsAnswers` slice lists real, answerable questions; a confident wrong
  slice, and an empty-shell `needsAnswers` slice, are both wrong.
- **Slice ↔ PRD link:** a self-contained slice (chore/refactor/build-fix, covering no
  PRD user stories) carries `covers: []` and **omits `prd:`** — it is its own source
  of truth (a standalone *What to build* + *Prompt*). A slice that points into a PRD's
  user stories MUST set `covers: [...]` AND name that PRD in `prd:` (the rule is
  `prd` **required iff `covers` is non-empty** — see WORK-CONTRACT.md). Do not invent
  a `prd:` link for a slice that derives from no PRD.
- Content-derived slugs, never counters. Preserve any traceability (e.g. an
  `issue: N` link on a PRD) if the source had it.

### 3. Generate understanding from the code — split by POLARITY (not all of it is a finding)

Where useful (an unfamiliar/legacy codebase), produce understanding — but route each
piece by its **polarity**, because describing our OWN code in `findings/` corrupts the
bucket (findings = *external* ground-truth, and our code changes so it would rot with
no status-flow to retire it). Three destinations:

- **Our own code's shape** (package layout, module seams, internal conventions,
  dependency flow) → **`CONTEXT.md`** (vocabulary) and/or a **`docs/architecture.md`**
  overview. This is NOT a finding. The code is its own current-truth source.
- **External/domain ground-truth our code integrates with** (a third-party API's real
  behaviour, a wire/artifact format, an EIP/spec, an external tool's contract) → a
  **`work/findings/<slug>.md`**, and it **MUST carry a `source:` (provenance)**
  (WORK-CONTRACT findings box + frontmatter): how, and how *currently*, you came to
  believe it. A finding *derived from reading our own code* records `source:` = that
  file (+ commit) and is the **weakest** provenance — it assumes our code is correct,
  so SAY so in the source string ("derived from <file> @ <commit>") so a later "our
  code was buggy" can revise it traceably. Prefer upgrading the source to a dated
  external authority or a captured trace when you can. (There is no separate
  `confidence:` field — a rich, dated `source:` carries the weight; see WORK-CONTRACT.)
- **A deliberate, ADR-worthy choice** (hard to reverse + surprising without context +
  a real trade-off — the bar in the discipline above) → do NOT write it as a finding.
  **ASK the user the *why*** ("why was this done; what were the alternatives/
  constraints?"). If they answer → write a complete ADR in `docs/adr/` from their
  answer. If they are absent/unsure/decline → **write NOTHING**; the code stands as its
  own pre-ADR (see the discipline at the top). Never author an ADR whose why you
  inferred from the code.
- Keep verified ground-truth in `findings/` (with `source:`); keep speculation /
  spotted-but-unverified concerns in `observations/`.

### 4. Report + hand off (no auto-commit)

- **Ask the *why* of ADR-worthy decisions while the user is present (batch them).** For
  each ADR-worthy decision pass 3 surfaced, ASK "why was this done?". Write
  a complete ADR for each one the user answers; for each they cannot/will not answer,
  write **NOTHING** — the code is its own pre-ADR. (Optionally mention the un-answered
  ones in the report below so the human knows they exist, but persist no file for them.)
- REPORT every file created, grouped by bucket, plus anything you left as
  `needsAnswers`/`observations`/`ideas` for the human to resolve, and (ephemerally, in
  the report only) any ADR-worthy decisions whose *why* went un-answered. Note any
  `findings/` whose `source:` is code-derived (weakest provenance) so the human knows
  to verify them.
- **Update `CONTEXT.md` to reflect what migrate actually populated:** fold any
  domain vocabulary you surfaced into its glossary, and — since `setup`'s template
  only mentions the buckets generically — note which buckets this repo now uses. Be
  precise about polarity: `findings/` holds **external** ground-truth (with sources),
  our own architecture lives in `CONTEXT.md`/`docs/`, open questions live in `ideas/`
  (vague) or `needsAnswers` slices (near-spec). Do NOT write "this repo carries
  reverse-engineered `findings/` about our code" — that is the polarity mistake step 3
  exists to prevent. Append/merge only; never clobber what `setup` or the human wrote.
- **Git etiquette:** do NOT stage/commit/push — leave everything in the working tree
  for the user to inspect and commit (the producer convention shared with
  `setup`/`to-prd`/`to-slices`). Migrating a big repo is iterative: bound each run to a
  subset (one source area at a time), report, let the human review, run again — the
  same self-bounding discipline as the batching skills.

## Boundaries

- **An ADR is written IFF you have the *why* (from the human).** Ask the user during
  the run; if they answer → write a complete ADR; if not → write NOTHING and let the
  code stand as the pre-ADR. NEVER author an ADR whose why you inferred from the code,
  and do NOT create a `proposed`/pre-ADR/candidate holding artifact as a consolation
  (the §discipline above) — an un-maintained one just rots.
- **Compose, don't reimplement:** `setup` for the scaffold, `to-prd`/`to-slices` for
  PRD/slice shapes. migrate adds only the inventory/mapping judgement + the
  code→understanding pass (split by polarity).
- **findings = verified EXTERNAL/domain ground-truth, each with a `source:`**, NOT a
  description of our own code (that is `CONTEXT.md`/`docs/`), NOT internal post-mortems
  (those are observations), NOT decisions (those are ADRs). See WORK-CONTRACT.md.
- **A `backlog/` slice is a scoped, buildable ask.** A wish/maybe/blocked one-liner is
  an `idea`; `needsAnswers` is for a near-complete spec with specific listed questions,
  not a vague stub. When in doubt → `ideas/`, not `backlog/`.
- It converts; it does not BUILD or claim anything (that is the runner). A migrated
  slice is just another `backlog/` item the normal engine then advances.
