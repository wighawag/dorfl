---
'dorfl': patch
---

`requeue <slug> -m "<note>"` no longer drops the handoff note when `main` is protected. The push of the note to `main` was refused by the remote, but dorfl read the refusal as `main` moving under it, printed "main advanced under us" five times, then released the lock without the note. A failed push to `main` is now classified by asking the arbiter whether `main` moved: if it did not, the push is reported as refused, quoting the remote's error, and is not retried. The note is then delivered on the kept `work/<type>-<slug>` branch, where the next claim continues and its continue prompt already reads it. If there is no kept branch (for example with `--reset`), the lock is still released, but the note is printed in full and `requeue` exits non-zero, so it is never lost.

A continued run's `## Decisions` block is now recorded in the done record. When a requeued task continued from a kept branch that had already done-moved it, the runner skipped the transcription because the record already held the first run's block, so the later run's decisions were lost. They are now appended under `## Decisions (continued run, YYYY-MM-DD)`, after the earlier run's block, which is kept. A block the record already contains verbatim is still not duplicated.
