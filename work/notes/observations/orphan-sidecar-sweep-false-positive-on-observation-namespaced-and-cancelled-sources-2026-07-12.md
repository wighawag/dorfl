# orphan-sidecar sweep false-positives on observation-namespaced + cancelled sources

> Observed 2026-07-12 while cleaning up after a drive-tasks session (`gc --remote-branches` run on `github.com/wighawag/dorfl`).

## What I saw

`dorfl gc --remote-branches --arbiter origin` ran its orphan-question-sidecar sweep and REAPED (deleted) 7 sidecars under `work/questions/`, each with the message `orphan; source task:<slug> is gone`. Example:

```
>> Reaped work/questions/task-advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md (orphan; source task:advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21 is gone).
```

But the sources are NOT gone. Checking every lifecycle folder by hand, all 7 have a live source:

- 6 exist as OBSERVATIONS: e.g. `work/notes/observations/advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md` (the sidecar filename is `task-<slug>.md` but the live item is `observation:<slug>`).
- 1 exists in the CANCELLED terminal: `work/tasks/cancelled/cross-job-ref-based-land-lock.md`.

I restored all 7 (they were staged deletions in the working tree only — nothing was committed) so no live sidecar was lost.

## Mechanism (hypothesis, to confirm)

The sweep appears to derive the source item from the sidecar FILENAME's namespace prefix (`task-<slug>.md` ⇒ `task:<slug>`) and then check only that ONE namespaced path (e.g. `tasks/ready|backlog|done`). It does NOT also check:

1. the OTHER namespaces a sidecar's slug could resolve to — notably `observation:<slug>` under `work/notes/observations/` (a question sidecar is legitimately attached to an observation; `SidecarType` includes `observation`); and
2. the CANCELLED / DROPPED terminals (`tasks/cancelled/`, `specs/dropped/`) — a cancelled task is a RESTING record, not "gone", so its sidecar is not an orphan.

A sidecar filename `task-<slug>.md` for a slug whose live item is an `observation:<slug>` (or which now rests in `cancelled/`) is therefore mis-judged orphaned and reaped.

## Impact

Data-loss risk: a live question sidecar (possibly carrying a human's unmerged ANSWER) can be silently deleted by a routine `gc --remote-branches`. In this instance the deletions were only in the working tree and I reverted them, but if committed+pushed the answers would be lost (recoverable only via git history).

## Fix shape (candidate)

The orphan predicate should resolve the sidecar's source by the SAME `(umbrella, slug)` addressing every scanner uses, checking ALL plausible namespaces for the slug (task AND observation AND spec) across ALL lifecycle folders INCLUDING the terminals (`cancelled/`, `dropped/`), and only declare an orphan when NO source exists under ANY of them. Prefer keying off the sidecar's OWN recorded identity (the `item=<type>:<slug>` in its identity HTML comment) rather than re-deriving the type from the filename prefix.

## Provenance

Spotted directly; `gc --remote-branches` output + a by-hand check of each of the 7 slugs against `work/{tasks,notes,specs}/*` on `main` @ the 2026-07-12 drive-tasks completion state. Not yet turned into a task — capture only.
