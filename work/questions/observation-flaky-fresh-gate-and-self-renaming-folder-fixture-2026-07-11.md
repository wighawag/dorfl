<!-- dorfl-sidecar: item=observation:flaky-fresh-gate-and-self-renaming-folder-fixture-2026-07-11 type=observation slug=flaky-fresh-gate-and-self-renaming-folder-fixture-2026-07-11 allAnswered=false -->

Item: [`observation:flaky-fresh-gate-and-self-renaming-folder-fixture-2026-07-11`](../notes/observations/flaky-fresh-gate-and-self-renaming-folder-fixture-2026-07-11.md)

## Q1

**What should become of this observation? Reply with a disposition and a reason: resolve (settle it, keep the note on record — say why), promote (mint a task / spec / adr — say which and why), delete (redundant or obsolete — say why), or duplicate (maps onto an existing item — name it).**

> The engine records your disposition from the answer (no token needed); an answered promote mints the artifact, resolve keeps the note settled, delete/duplicate discharge it.

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Resolve (keep the note on record as a fingerprint). This matches the disposition already recorded in the note body's 'Applied answers 2026-07-12' section: a single unreproduced occurrence with no live signal, so do not mint an investigation task, but the failure mode ('m.oldName is not a function' + 'No projects found') is a specific enough fingerprint to keep. Note also that the underlying `/tmp` fixture teardown race class has since been hardened (retry-hardened `rmrf` + git auto-gc-off in `packages/dorfl/test/helpers/gitRepo.ts`), which makes recurrence less likely; re-open / promote only if it recurs anyway.
