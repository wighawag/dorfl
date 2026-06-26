<!-- dorfl-sidecar: item=observation:review-nits-sidecar-kind-field-2026-06-26 type=observation slug=review-nits-sidecar-kind-field-2026-06-26 allAnswered=false -->

## Q1

**What becomes of this signal — the non-blocking Gate-2 nits raised on 'sidecar-kind-field' (no Decisions block on the PR; ratify (a) token spelling 'kind=<value>', (b) field order 'kind=' after 'answered=', (c) unknown 'kind=' silently dropped on re-serialise so round-trip is not byte-preserving for unknowns)? Promote to a follow-up task, fold into an ADR / protocol-doc edit, or delete as already-resolved?**

> Source: work/notes/observations/review-nits-sidecar-kind-field-2026-06-26.md (Gate 2 APPROVED, nits only).
> Reality check:
>   - 'sidecar-kind-field' is already in tasks/done/ (work/tasks/done/sidecar-kind-field.md) — the implementation landed, so this is purely a documentation/ratification residue, not a code blocker.
>   - The three nits are decisions made during build but never written down: (a) the literal token spelling, (b) its position in the per-entry HTML comment relative to 'answered=', (c) the unknown-token drop policy on re-serialise (tested in packages/dorfl/src/sidecar.test.ts).
>   - No '## Decisions' block exists on the merge commit (git log -1 --format=%B is just the conventional-commit title), so these choices currently live ONLY in code + tests, not in protocol/ADR docs that future implementers would read.
>   - Candidate homes if promoted: an ADR under docs/adr/ (the durable 'why' of OUR decisions), or an edit to work/protocol/SURFACE-PROTOCOL.md / the sidecar shape spec referenced there (the sidecar entry format is documented in SURFACE-PROTOCOL.md '## The emitted question shape (MUST match the sidecar)').
>   - Capture-bucket rule: a note leaves the inbox by deletion the moment it stops being a live signal; if the answer is 'doc it', the spawned ADR/protocol edit must be SELF-CONTAINED (carry the mechanism, not just a back-pointer) before this note can be discharged.

_Suggested default: Promote to a small follow-up task that records the three decisions in an ADR (or amends SURFACE-PROTOCOL.md's sidecar shape section) — specifically: ratify 'kind=<value>' spelling, order 'kind=' after 'answered=' in the per-entry HTML comment, and document that unknown 'kind=' values are silently dropped on re-serialise (round-trip is not byte-preserving for unknown tokens, by design — matches silent-on-malformed). Then delete this observation in the same atomic commit as the ADR/doc edit lands._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
