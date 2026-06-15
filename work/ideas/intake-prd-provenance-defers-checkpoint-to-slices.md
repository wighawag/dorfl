---
title: track issue-intake PRD provenance so an untrusted-author PRD can merge to main directly (a PRD is inert) yet auto-slice into PROPOSE-only slices — moving the human checkpoint from the inert PRD onto the becomes-code slices
slug: intake-prd-provenance-defers-checkpoint-to-slices
type: idea
status: incubating
---

# intake PRD provenance: defer the untrusted-author checkpoint from the (inert) PRD to its (becomes-code) slices

> Captured 2026-06-15 from a design conversation while dogfooding `install-ci` on this repo (the generated `intake.yml` author-trust policy was on screen). NOT built. It refines the EXISTING intake merge-vs-propose policy (PRD `runner-in-ci`, the author-trust table + the generated `intake.yml` `deriveIntakeFlags` shell), so read that first. Names (`origin`, `originAuthorTrust`) are placeholders.

## The insight

The current intake policy treats `--propose-prd` (open a PR for the PRD itself) as the safety mechanism for an UNTRUSTED issue author, and the generated `intake.yml` derives `--propose-prd` specifically when `autoSlice` is ON ("an agent will act on it next, so insert a human PR-review NOW").

That is the wrong checkpoint, and it costs friction for little safety:

- **A PRD is INERT.** It sits in `work/prd/` and does NOTHING until something slices it. There is no risk in the PRD merely existing on `main`. PR-reviewing the abstract PRD text buys little.
- **The real risk is downstream**: when that PRD is auto-sliced and those slices are auto-built (code on a branch). THAT is where a human checkpoint actually matters.

So move the checkpoint to where the risk is: let the inert PRD merge, but gate the slices.

## The proposal

For an issue-intake PRD from an UNTRUSTED author:

1. **`--merge-prd`** — land the PRD on `main` directly (no PR). Safe precisely because a PRD is inert. This INVERTS today's rule (`autoSlice ON ⇒ --propose-prd`) for the untrusted case.
2. **Stamp PROVENANCE onto the PRD** at intake time, e.g. frontmatter `origin: issue` + `originAuthorTrust: untrusted` (+ the issue number), so the artifact records HOW it was born.
3. **`autoSlice: true` still slices it autonomously** — no human needed for the slicing step; the PRD flows through slicing freely.
4. **The slicer (capability B / `do prd:`) PROPAGATES the provenance onto every emitted slice AND forces those slices to `--propose`** (PR), overriding the repo `integration`/`autoBuild` gate when provenance is untrusted. So the slices cannot be built/merged until a human approves them.

Net effect: an issue-intake PRD moves through slicing WITHOUT needing approval, and the human checkpoint lands exactly ONCE, on the concrete SLICES (the thing that becomes code), instead of redundantly on the inert PRD.

## The gap this requires (why it is not buildable today)

Provenance is NOT persisted on the artifact. The author-trust signal currently lives ONLY in the live intake event (`github.event.comment.author_association` / `issue.author_association`), read at runtime by the generated `intake.yml` shell. The moment an intake artifact lands on `main`, its origin is indistinguishable from a human-authored one — the trust signal is LAUNDERED at the merge boundary.

This idea needs provenance that:

- is **stamped at intake time** (the only moment author-trust is known), and
- **propagates across the PRD → slice transform** (the slicer must read the PRD's provenance and carry it onto each emitted slice), so the becomes-code gate survives the PRD-PR/merge boundary.

## Policy delta to be explicit about

This deliberately CHANGES the current intake rule, it does not merely add to it:

- Today: untrusted author + `autoSlice` ON ⇒ `--propose-prd` (checkpoint on the PRD).
- Proposed: untrusted author ⇒ `--merge-prd` + provenance stamp; checkpoint deferred to the slices via propagated provenance forcing `--propose-slice`.

The trusted-author and human-authored paths are unchanged (a human PRD on `main` auto-slices into gate-derived slices as before; a human who reviews+merges any intake PR has already given the checkpoint).

## Open questions for PRD time

- Exact provenance shape + where it lives (PRD frontmatter key? a sidecar?) and how it survives slicing without leaking into the slice's own semantics.
- Does provenance need to propagate further (slice → built PR), or is "force the slice to propose" sufficient (the slice PR IS the checkpoint)?
- Interaction with `surfaceBlockers`/`needsAnswers` on an intake PRD (a blocked intake PRD that gets answered + sliced).
- Should provenance also drive the close-job / issue-thread surface (the issue that spawned an untrusted PRD)?
- Relationship to `make-isolated-the-default-build-mode` / the review gate (the slice PR still runs Gate-2 review on top).
