---
title: review-gate non-blocking nits for 'pin-frontmatter-owns-fence-to-heading-blank-line-convention' (Gate 2 approve)
date: 2026-07-07
status: open
reviewOf: pin-frontmatter-owns-fence-to-heading-blank-line-convention
needsAnswers: true
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'pin-frontmatter-owns-fence-to-heading-blank-line-convention' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-task / keep / delete.

- The task's Done-when says: 'The done record for THIS task notes explicitly which of the two forms (ADR-lite vs Decisions block on the sibling done record) was chosen and why, so the sibling intake-adopts-renderer task can find it.' The done record was moved ready→done unchanged — no such note was appended. The ADR is still discoverable at docs/adr/frontmatter-owns-fence-to-heading-blank-line.md (and the promotion-side comment cross-references it), so impact is small, but the sibling task will not find a pointer on the done record itself.
  (git show ae2d69f8: work/tasks/ready/...md → work/tasks/done/...md is a pure rename (similarity index 100%).)
- ADR filename does not use the sequential 0001- prefix that work/protocol/ADR-FORMAT.md prescribes; however every existing entry in docs/adr/ uses plain slugs (no numbering), so the new file follows the established in-repo convention. Worth ratifying which convention wins — the protocol doc or the on-disk pattern.
  (docs/adr/ listing shows 19 slug-only ADRs, zero numbered. ADR-FORMAT.md says: sequential numbering: 0001-slug.md.)
