---
'dorfl': patch
---

The CI split of the build path now carries every build outcome, not only the success case. Under the hidden, CI-only `--phase`, the agent phase hands over a red gate, a blocked review or a rebase conflict as needs-attention, the deadline checkpoint, the agent's deliberate STOP and an agent failure, each with its work-in-progress commit bundled; the apply phase pushes that work, then surfaces the item, or (for a deadline checkpoint under `maxAutoCheckpoints`, read from the repository config at the base) releases the lock so the next run continues. Continuing a kept work branch now rebases it only locally in the agent phase; the apply phase publishes it with a lease on the tip the lock phase saw and writes nothing if the branch moved since. Every lock release in the apply phase is leased on the lock job's sha, so it never releases a lock another run has taken since. Nothing changes without `--phase`.
