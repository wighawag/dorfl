<!-- dorfl-sidecar: item=observation:review-nits-merge-retries-gate-precedence-2026-06-26 type=observation slug=review-nits-merge-retries-gate-precedence-2026-06-26 allAnswered=false -->

## Q1

**What becomes of this observation — the three non-blocking nits from the Gate-2 review of 'merge-retries-gate-precedence'? Should each nit be promoted to a task/PRD, ratified-and-closed, or deleted?**

> Observation file: work/notes/observations/review-nits-merge-retries-gate-precedence-2026-06-26.md. Review APPROVED the PR but recorded three nits that need a triage disposition:
>   1) The shipped default is 1000 (engine's DEFAULT_MERGE_RETRIES), but the PRD lens-1 paragraph at line 158 still says DEFAULT_MERGE_RETRIES = 5. Either ratify 1000 and update the PRD, or pick a smaller modest default.
>   2) Cross-task scope: only run/do/complete entry points were threaded with mergeRetries. tasking.ts:632, intake.ts:1157 + :1297, and recover-isolated.ts:169 also call performIntegration in merge mode but do not forward a resolved mergeRetries, so per-repo/env/flag caps are silently lost on those paths (engine default takes over).
>   3) No Decisions block was surfaced in the commit/PR body (git log -1 74f3899d --format=%B is empty). The in-scope decisions (1000 as modest default; flag parse-or-drop on negatives/non-integers/'' mirroring --review-max-rounds; resolve ONCE per performComplete; intake/tasking/recover not threaded) should have been listed for ratify.
> The observation has no review gate of its own; this triage question is the protocol-native 'what becomes of this signal?' for an open observation.

_Suggested default: Promote nit-1 (ratify 1000 + update PRD line 158) and nit-2 (thread mergeRetries through tasking/intake/recover-isolated performIntegration calls) to follow-up tasks; treat nit-3 (missing Decisions block) as a process note — ratify the four decisions inline in the answer and delete, since the commit has already landed and rewriting its body is not worth the churn._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Promote nit-1 (ratify 1000 as the default AND update the stale PRD line 158 that still says 5) and nit-2 (thread mergeRetries through the tasking.ts, intake.ts, and recover-isolated.ts performIntegration calls so per-repo/env/flag caps are not silently lost on those paths) to follow-up tasks, these can be one small task. Nit-2 is a real correctness gap. Treat nit-3 (missing Decisions block) as a process note: ratify the four decisions inline here and do not rewrite the landed commit body. Then delete this observation.
