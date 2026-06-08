---
name: review
description: "A standalone, protocol-native discipline for reviewing work/-protocol artifacts — slices, PRDs, code-vs-its-slice, and captured notes (observations/findings/ADRs) — thoroughly and adversarially, ending in a destination check against the PRD/ADR goal. Use when reviewing a slice before it lands or is claimed, code in a work PR against the slice that specified it, a PRD before slicing, or a captured note for bucket/quality — i.e. before any protocol artifact is trusted. Reviews AGAINST the work/ contract and its design (it assumes the protocol). Emits a verdict; the caller routes it."
---

# review

A **standalone reviewing discipline** that makes your review of a `work/`-protocol
artifact **more thorough and easier**. Reach for it whenever an artifact is about
to be *trusted* — a slice before it lands/is claimed, code in a work PR against the
slice that specified it, a PRD before slicing, or a captured note (observation /
finding / ADR) for correct bucket + quality.

It is **protocol-native**: it is meant for a repo that uses the `work/` contract,
so it *assumes the protocol's rules and design* and reviews the artifact **against
them**. That assumption is the point — it makes the review catch real,
protocol-specific defects (a dishonest gate axis, a wrong bucket, a missing
isolation test, drift) instead of offering a generic checklist.

You **emit a verdict; you do not act on it** — see [Your output](#your-output).
Routing the verdict (to `needsAnswers`, `needs-attention/`, a batch file, a merge)
is the caller's job. This skill is the *assessment*, not the disposition.

## When to use vs. not

- **Use** to review: a **slice** (well-cut? claim-ready?); **code** in a work PR
  (does it deliver the slice it claims?); a **PRD** (sliceable? gate axes honest?);
  a **note** (right bucket? actionable?); or a **set of slices** (do they compose
  into the PRD/ADR goal?).
- **Don't** use it to *produce* the artifact (that's `to-prd` / `to-slices` / the
  build agent), nor to *route* the verdict (that's the caller — a review gate, a
  conductor skill, or a human). This skill only assesses.

## The core disciplines (what makes a review thorough, not shallow)

These are *why* this beats a single "looks fine" pass — apply them throughout:

1. **Run a SEQUENCE of distinct angles, not one pass.** Each lens below is a
   different framing. Re-running the *same* angle converges on nothing fast;
   changing the angle keeps finding distinct *classes* of defect. Stop when a full
   pass across the angles finds nothing NEW.
2. **A reviewer is ADVERSARIAL.** Try to *break* the artifact ("attack these
   slices: granularity? dependency order? gate correctness? drift? a missed
   seam?"), don't confirm it. Self-review in the producing context rubber-stamps;
   review as if someone else wrote it (ideally a fresh/cold read).
3. **Verify against what ACTUALLY LANDED, not intent or memory.** Read the real
   code / the committed artifact — not what you *think* a change did. Edits silently
   fail; specs drift. Trust the bytes on disk.
4. **A SECOND instance of the same finding is a SIGNAL, not noise.** "I've seen
   this shape before" → generalise the fix, don't patch instances one by one (this
   applies to the artifact's defects *and* to your own repeated mistakes).
5. **Defects concentrate in the SLICE/SPEC more than in the code.** Agents build
   what they're told, correctly; the expensive bugs are an ambiguous premise, a
   wrong "reuse X", an assumed-but-absent seam, a stale central assumption. Spend
   the most scrutiny on the spec.
6. **Flag, don't guess.** When something is genuinely unresolved, that is a
   `block`/`needsAnswers` finding — not a guess dressed as approval. A false "looks
   fine" ships wrong-but-compiling work; a flagged question costs one human glance.
7. **Weight findings by REAL impact — do not cargo-cult the lenses.** A finding is
   only worth raising if acting on it changes an outcome someone would actually
   hit. A technically-true nit that no reader/builder/runtime will ever be bitten
   by is NOT a `block` (often not even worth recording). Running a lens as a
   checklist and reporting conformance misses ("this optional field is empty", "a
   list could be renumbered") as blocking is the failure mode this rule exists to
   stop: it buries the findings that matter under bookkeeping noise. Ask of each
   finding: *who hits this, and what breaks?* No answer → drop it. The lenses find
   candidates; impact decides severity.

## The lenses — apply IN ORDER, ending in the destination check

For each lens: *what it catches* + *how to apply it (against the contract)*.

### 1. Claim-vs-reality

Every concrete claim the artifact makes, checked against the real world.

- Slice/PRD: each referenced symbol, path, function signature, "reuse X" — does it
  exist and have the assumed shape? (Catches ghost paths, wrong module homes,
  "reuse X" where X is private / wrongly-shaped.)
- Code: does the diff actually do what its slice/commit claims?
- Any doc: does it match what landed in `done/` and the relevant ADRs/findings?
- **Drift is a `needs-attention` / `needsAnswers` signal**, never something to
  paper over (WORK-CONTRACT.md). A slice built on a stale premise is a `block`.

### 2. Cleanup-vs-behaviour

Anything framed as removal / dead-code / no-op, checked for **hidden live
behaviour**. (Real catch: a `--by` flag "just cleanup" was actually feeding the
claim commit and being read back.) If a "cleanup" changes behaviour, that's a
defect or an unowned scope.

This lens also owns **acceptance-criteria conformance** for code:

- Does the code meet every acceptance criterion of its slice?
- **Shared-write isolation rule (WORK-CONTRACT.md):** if the code writes to a
  shared/global location (a real home/config dir, a system path, a shared service,
  an external tool's store), do its tests ISOLATE that location (temp/scratch via
  the named env/config lever) AND assert the real one is UNTOUCHED? A missing
  isolation test is a `block` — it silently pollutes and can crash unrelated tools.

### 3. Cross-artifact composition (contract conformance)

Do the artifacts COMPOSE, and do they obey the contract?

- **Composition:** handoffs (one slice ships a stub another fills), shared helpers
  with no owner, two slices editing the SAME file/command in parallel (a merge
  conflict waiting to happen — should carry a `blockedBy` to serialise), one slice
  deleting another's live tooling, cross-slice side-effects.
- **Contract conformance (assume these rules; flag violations):**
  - **status = folder**, never a frontmatter field; **one file per item**; **no
    shared index/manifest**.
  - **content-derived slug**, never a counter; **camelCase** field names
    (`humanOnly`, `needsAnswers`, `blockedBy`, `sliceAfter`).
  - **gate axes set HONESTLY** — `humanOnly` (a human must drive this) and
    `needsAnswers` (open questions, listed in the body) reflect the artifact's real
    nature; a slice's gate is decided from *building that slice*, NOT inherited from
    its PRD; a falsely-complete `needsAnswers:false` is a defect.
  - **`blockedBy` / `prd` / `covers`** present and correct (`prd` required iff
    `covers` is set); deps reference real slugs.
  - **bucket polarity** for notes: *observation* = spotted/unverified (append-only);
    *finding* = verified EXTERNAL/domain ground truth; *ADR* = a decision WE made +
    why (in `docs/adr/`). A note in the wrong bucket is a finding.
  - **a slice's `## Prompt`** is self-contained (an AFK agent could start from the
    file alone) and includes the drift-check.

### 4. Conceptual coherence (does it fit the system's LANGUAGE?)

The artifact may be internally correct yet INCOHERENT against the concepts the
system already has. This lens catches the conflation that mechanical conformance
(lens 3) and claim-checking (lens 1) miss — it is how, in practice, a single
concept got applied at the WRONG LAYER and the inconsistency survived multiple
slices + PRDs (the `autoSlice` gate that gated the `do prd:` VERB when it should
have gated only the autonomous SELECTION — see
`work/findings/autoslice-gate-conflates-verb-autonomy-and-review-loop.md`).

For each concept / flag / config key / verb / status the artifact introduces or
touches, ask three questions:

- **(a) Consistent meaning?** Is the term used the SAME way it is already defined
  elsewhere (the project's `CONTEXT.md` glossary is the source of truth, plus the
  ADRs, other slices, the code)? A term that silently RE-MEANS an existing word —
  or means two different things in two places — is incoherent.
- **(b) Right layer?** Is the concept placed at the conceptual layer it actually
  belongs to? (A policy gate on the autonomous-SELECTION step vs on the explicit
  VERB; a knob on the loop vs on the one-shot; a check on "who invoked" when the
  system cannot even distinguish the invokers.) A correct mechanism at the wrong
  layer is incoherent.
- **(c) Duplicate / overlap?** Does it FORK an existing concept under a new name
  instead of reusing or renaming the one that already exists? (Two flags meaning
  "isolate"; a new status that is really an existing one; a second lock primitive.)
  If it overlaps, the artifact should reuse/rename, not add.

A concept that is coherent in ISOLATION but incoherent against the system's
existing language is a `block` (or, for a slice/PRD not yet built, a
`needsAnswers` / re-scope). Coherence is a first-class quality, not a nicety: an
incoherent concept is debt that compounds silently across every artifact that
later reuses the muddled term. When you spot the muddle, also check whether the
GLOSSARY (`CONTEXT.md`) needs the term pinned so the next author cannot re-fork it.

### 5. The destination check (the final, highest-value move)

*"If every slice is built / the code is merged exactly as written, do we END UP
WITH the system the PRD/ADR describes?"* — distinct from per-piece correctness, and
the strongest signal a decomposition is trustworthy (especially with no human).

- Take the PRD/ADR end-state as the spec; **map every promised element to a
  delivering slice** — a hole = an element no slice delivers.
- Confirm **coverage is complete + non-duplicated** — every user story covered
  exactly once.
- Audit the **deletion sweep** — a new system means the OLD surface is GONE; every
  removal owned by exactly one slice, none unowned or double-owned.
- Check for **orphans** (a slice delivering something the end-state doesn't need)
  and that assumed-pre-existing foundations actually exist.
- Confirm **deliberate non-deliveries are flagged** as named follow-ups, not
  silently missing.

**`approve` must mean "provably reaches the PRD/ADR goal," not "each piece looks
fine."** If this lens finds a hole, it is the most important thing to `block`.

## Your output

Emit a verdict per reviewed item — and **write nothing** (no frontmatter edits, no
`git mv`, no file changes). The caller routes it.

```
per item → { verdict: "approve" | "block",
             findings: [ { severity: "blocking" | "non-blocking",
                           question: <the question / defect, with enough context to act>,
                           context:  <the relevant excerpt, file:line, or reasoning> } ] }
```

- **blocking** keeps the item out of "ready"; **non-blocking** is recorded but does
  not block (a nit, a future improvement). Be honest about which.
- Give each finding enough context that a reader can act WITHOUT re-deriving it.

### How callers route your verdict (not your job — for orientation only)

- a **review GATE** routes a `block` → set `needsAnswers: true` on the artifact
  (question in its body) or `git mv` to `needs-attention/`; `approve` → let it land
  / auto-merge.
- a **conductor** (e.g. `drive-backlog`/`orchestrate`) routes a `block` → into its
  stuck-set / batched questions for the human; `approve` → merge / advance.

## Scope fence

This skill is the review *protocol/discipline* only. The review **gates** — *when*
review runs (slice-time / PR-time), per-repo toggles, the model override, the
`--propose` PR arbiter, auto-merge-on-approve, the role/seam wiring, the trust
resolver — are NOT here; they live in the runner machinery (`work/prd/review.md`).
This skill assumes nothing about its caller beyond "you will route my verdict."
