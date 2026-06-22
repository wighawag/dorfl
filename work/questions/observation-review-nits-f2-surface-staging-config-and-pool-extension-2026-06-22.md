<!-- agent-runner-sidecar: item=observation:review-nits-f2-surface-staging-config-and-pool-extension-2026-06-22 type=observation slug=review-nits-f2-surface-staging-config-and-pool-extension-2026-06-22 allAnswered=false -->

## Q1

**Nit 1 (empty Decisions block / four silent decisions): how do you want this signal routed — RATIFY the four decisions (surfaceStaging library-default false vs config-default true; four new LedgerReadStrategy methods rather than extending resolveLocal/MirrorState; gate consumed by the gather not the pure builder; surfaceStaging in REPO_ALLOWED_KEYS) by recording them in an ADR (promote-adr), spin a follow-up slice to amend the slice doc / extend an interface differently (promote-slice), KEEP as a durable nit, or DELETE because the sibling observation 'decisions-block-convention-repeatedly-skipped-enforce-or-relax' already owns this pattern?**

> Observation body §1: the slice commit/PR has no `## Decisions` block; four non-obvious choices were made silently. The decisions-block-convention-repeatedly-skipped observation already exists at work/notes/observations/decisions-block-convention-repeatedly-skipped-enforce-or-relax-2026-06-22.md, so the META pattern is tracked separately — what is at stake HERE is whether THESE FOUR SPECIFIC decisions get ratified/reversed.

_Suggested default: promote-adr — the four choices (especially the asymmetric default and the public-interface widening) are exactly the kind of load-bearing decisions ADRs exist for; tracking the meta-pattern stays in the sibling observation._

<!-- q1 fields: id=q1 disposition=promote-adr -->

**Your answer** (write below this line):

## Q2

**Nit 2 (mirror gather staging widening is not directly tested): promote a small follow-up slice that adds a bare-mirror test seeding a staged `needsAnswers` item and asserting `gatherLifecycleMirror({gates:{surface:true,surfaceStaging:true}}).surface` enumerates it (and is empty when surfaceStaging:false), or KEEP / DELETE?**

> Observation body §2: packages/agent-runner/test/surface-staging-config-and-pool.test.ts covers gatherLifecycleInPlace + scanRepoPaths but never invokes gatherLifecycleMirror or the new resolveMirror*Staging methods. The mirror path (readTaskStagingFromTree / readBriefStagingFromTree via `git ls-tree`+`git show`) is the actual code path CI's propose-matrix executes against the bare hub mirror, so this is the higher-risk untested path.

_Suggested default: promote-slice — the untested path is precisely the one CI exercises in production; a single targeted test is cheap and high-value._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**Nit 3 (stranded-sidecar edge case on surfaceStaging on→off flip): is the intended invariant that `apply` CONSUMES answered sidecars REGARDLESS of gate state (i.e. apply re-enumerates without consulting surfaceStaging)? If yes, this is a real bug → promote-slice to fix the gather/builder so apply still sees minted+answered staged items. If no (gate gates both create AND consume symmetrically), this is by design → KEEP as documentation of the invariant, or DELETE.**

> Observation body §3: under surfaceStaging:false, gatherLifecycleInPlace skips the staging read entirely, so buildLifecyclePools never sees the candidate even if a sidecar was already minted and answered. ADR ci-config-policy-and-gate-family §4 states the create-vs-consume invariant — the question is which side staging falls on. The observation notes off→on is the realistic direction and impact is small, but the invariant should be explicit.

_Suggested default: promote-slice — `apply` is documented elsewhere as 'CONSUME, always-on'; honouring that for staged items too matches the stated invariant and the fix is small (apply path enumerates regardless of surfaceStaging, or sidecar presence forces enumeration)._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
