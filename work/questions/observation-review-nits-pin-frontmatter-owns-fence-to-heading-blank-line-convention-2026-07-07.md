<!-- dorfl-sidecar: item=observation:review-nits-pin-frontmatter-owns-fence-to-heading-blank-line-convention-2026-07-07 type=observation slug=review-nits-pin-frontmatter-owns-fence-to-heading-blank-line-convention-2026-07-07 allAnswered=false -->

Item: [`observation:review-nits-pin-frontmatter-owns-fence-to-heading-blank-line-convention-2026-07-07`](../notes/observations/review-nits-pin-frontmatter-owns-fence-to-heading-blank-line-convention-2026-07-07.md)

## Q1

**What should become of this observation overall — promote its nits to a task, keep it open as a durable record, or delete it?**

> Observation records two non-blocking Gate-2 nits on the (approved, integrated) pin-frontmatter task. Its stated purpose is durable triage: promote / keep / delete. Neither nit blocks anything; both are minor documentation-hygiene items on already-shipped work.

_Suggested default: Delete — both nits are small, retrospective, and the substantive artefacts (the ADR, the sibling task's cross-reference) already exist._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Nit 1: the task's Done-when required the done record to note which convention form (ADR-lite vs Decisions block) was chosen and why, but the ready→done move was a pure rename with no such note. Amend the done record retroactively, mint a follow-up task, or accept-as-is?**

> work/notes/observations/review-nits-...md bullet 1; git shows ae2d69f8 as similarity-index-100 rename. The ADR docs/adr/frontmatter-owns-fence-to-heading-blank-line.md is discoverable and the sibling intake-adopts-renderer task cross-references it, so real-world impact is small.

_Suggested default: Accept-as-is — the cross-reference already exists on the sibling side; retroactively editing a done record is high-friction for low gain._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Nit 2: which ADR-filename convention wins going forward — the protocol doc's prescribed 0001-slug.md numbering, or the on-disk plain-slug pattern that all 19 existing ADRs (including this new one) follow?**

> work/protocol/ADR-FORMAT.md says 'sequential numbering: 0001-slug.md'; docs/adr/ contains 19 slug-only files, zero numbered. The new frontmatter-owns-fence-to-heading-blank-line.md follows the established on-disk convention, not the protocol doc. Ratifying either direction resolves the drift; the choice likely warrants an ADR of its own since ADR-FORMAT.md is a protocol-source doc mirrored into skills/setup/protocol/.

_Suggested default: Ratify plain-slug on-disk convention and update ADR-FORMAT.md (in both skills/setup/protocol/ and work/protocol/) — 19 existing files vs a doc line is strong revealed preference; numbering adds ordering pain for little benefit._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
