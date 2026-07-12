<!-- dorfl-sidecar: item=observation:flaky-fresh-gate-and-self-renaming-folder-fixture-2026-07-11 type=observation slug=flaky-fresh-gate-and-self-renaming-folder-fixture-2026-07-11 allAnswered=false -->

Item: [`observation:flaky-fresh-gate-and-self-renaming-folder-fixture-2026-07-11`](../notes/observations/flaky-fresh-gate-and-self-renaming-folder-fixture-2026-07-11.md)

## Q1

**What should become of this observation? Reply with a disposition and a reason: resolve (settle it, keep the note on record — say why), promote (mint a task / spec / adr — say which and why), delete (redundant or obsolete — say why), or duplicate (maps onto an existing item — name it).**

> The engine records your disposition from the answer (no token needed); an answered promote mints the artifact, resolve keeps the note settled, delete/duplicate discharge it.

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Resolve (keep the note on record). It is a single unreproduced occurrence with no live signal, so do not mint an investigation task yet, but the failure mode is specific enough ('m.oldName is not a function' + 'No projects found') that the note is worth keeping as a fingerprint. Re-open / promote to an investigation task only if it recurs.
