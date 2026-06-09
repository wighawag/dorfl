---
title: §5a's ADR `status:` value set (`proposed | accepted | superseded`) drifts from Matt Pocock's canonical ADR-FORMAT.md set (`proposed | accepted | deprecated | superseded by ADR-NNNN`) — compatibility question for the human to decide
date: 2026-06-09
kind: observation
area: docs/adr/methodology-and-skills.md (§5a)
severity: low
status: open
---

## The signal

While hardening the `migrate` skill for compatibility with Matt Pocock's skill set (`~/dev/github/mattpocock/skills/`), I noticed a **drift in the ADR `status:` value set**:

- **`docs/adr/methodology-and-skills.md` §5a** declares the set as: `proposed | accepted | superseded`.
- **Matt's canonical `grill-with-docs/ADR-FORMAT.md`** (which §5 says we conform to, and which the domain-aware skills read) declares: `proposed | accepted | deprecated | superseded by ADR-NNNN`.

Two concrete differences:

1. **`deprecated` is missing** from our set — a value Matt's format blesses (an ADR that is no longer in force but was not replaced by a specific successor).
2. **`superseded` vs `superseded by ADR-NNNN`** — Matt's form names the successor. Note we _also_ deliberately deviate from his sequential `ADR-NNNN` numbering (§5b, slug-named), so even if we adopt `superseded by …` we'd name the successor by slug, not a number. So this isn't a clean "just copy his string" — it interacts with §5b.

## Why it is only an observation (not a fix)

§5a is an **accepted ADR** (a decision document). Aligning its `status:` vocabulary to canonical is plausibly the safe direction (the stated goal of §5 is "conform to Matt's conventions so his skills work with no setup"), BUT:

- It is a change to a _decision record_, which a human should ratify, not an agent widen on its own initiative.
- The `superseded by <slug>` form interacts with the §5b numbering deviation and needs a deliberate call, not a mechanical copy.
- Consumer skills read ADRs for _context_ / "do not re-litigate" and do **not** appear to hard-parse the status value (see `improve-codebase-architecture/SKILL.md`), so the drift is unlikely to _break_ anything today — it is a latent consistency gap, not an active bug. That is why this is `severity: low`.

## Suggested resolution (for a human)

If keeping conformance with Matt's format as §5 intends: update §5a's value set to `proposed | accepted | deprecated | superseded by <successor-slug>` (the slug form, reconciling with §5b), in a deliberate edit to the ADR. Otherwise, record in §5a that the reduced set is an intentional deviation (the §5b pattern: "recorded so it is not 'fixed'").

## Provenance

Spotted while reading `~/dev/github/mattpocock/skills/skills/engineering/grill-with-docs/ADR-FORMAT.md` (2026-06-09) against `docs/adr/methodology-and-skills.md` §5a, during work on the `migrate` skill.

## Update (2026-06-09) — RESOLVED, safe to delete

Resolved by conforming to the standard ADR format rather than reconciling the reduced set. We dropped ALL the earlier deviations (slug-naming, fat sectioned files, and the `proposed`-deciding-stage lifecycle — the latter was never used: 0 ADRs were ever `proposed`), and transcribed the standard format (Matt-free in content, owned) into **`work/protocol/ADR-FORMAT.md`**, which `setup` now copies into every repo. The status set is the standard `proposed | accepted | deprecated | superseded by ADR-NNNN` (optional). §5/§5a of `docs/adr/methodology-and-skills.md` were rewritten to record this decision; the two existing multi-decision files are grandfathered.

The drift this note flagged no longer exists. **This observation can be deleted** once the change is reviewed and committed (per the agreement: keep until happy, then remove).
