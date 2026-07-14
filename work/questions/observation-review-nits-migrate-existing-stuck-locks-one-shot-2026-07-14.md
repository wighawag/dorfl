<!-- dorfl-sidecar: item=observation:review-nits-migrate-existing-stuck-locks-one-shot-2026-07-14 type=observation slug=review-nits-migrate-existing-stuck-locks-one-shot-2026-07-14 allAnswered=false -->

Item: [`observation:review-nits-migrate-existing-stuck-locks-one-shot-2026-07-14`](../notes/observations/review-nits-migrate-existing-stuck-locks-one-shot-2026-07-14.md)

## Q1

**What should become of this observation? Reply with a disposition and a reason: resolve (settle it, keep the note on record — say why), promote (mint a task / spec / adr — say which and why), delete (redundant or obsolete — say why), or duplicate (maps onto an existing item — name it).**

> The engine records your disposition from the answer (no token needed); an answered promote mints the artifact, resolve keeps the note settled, delete/duplicate discharge it.

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

resolve, with one carve-out. Ratify nits 2-4 (skipped-no-item-form leaves `slice-*`/`prd-` legacy refs reported-but-in-place at exit 0; exit 1 only on lost/errors with body-absent drain as exit 0; the body-absent + skipped-no-item-form test-coverage gap is acceptable given small branches reusing tested primitives) and keep this note on record as their durable home. But FIRST split off nit 1 as a promote: mint a small task to backfill the where-it-runs decision into `work/tasks/done/migrate-existing-stuck-locks-one-shot.md` (a `## Decisions` block or an ADR link), because the prompt explicitly required "RECORD the where-it-runs decision durably, linked from the done record" and it currently lives only as an inline code comment in cli.ts (lines 3909-3920); the done record has no Decisions block and no link. Once that task is minted, resolve this note.
