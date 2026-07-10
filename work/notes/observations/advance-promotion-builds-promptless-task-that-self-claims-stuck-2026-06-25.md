---
date: 2026-06-25
slug: advance-promotion-builds-promptless-task-that-self-claims-stuck
needsAnswers: false
triaged: keep
---

The autonomous `advance` promotion path mints a task file that has NO `## Prompt`
section, so when a builder is dispatched against it the dispatch fails immediately
("has no '## Prompt' section") and the per-item lock is left `state: stuck`. Producer
and consumer disagree on the buildable-task schema, and nothing validates the body
between creation and claim.

## What was seen (ground truth)

Two `dorfl advance task:<slug> --propose --watch --arbiter origin` invocations both
errored with `'<slug>' is already claimed on origin/main (its per-item lock is held)`:

- `resolvecontinuecontext-doc-still-says-requeue-backlog-claim-gap-2026-06-24`
- `review-nits-allow-backlog-leak-fence-assertions-2026-06-24`

Inspecting the lock refs on origin (`refs/dorfl/lock/<slug>`, payload `lock.md`) showed
NOT a competing worker but a stuck self-claim:

```
action: implement
state:  stuck
holder: dorfl[bot]
since:  2026-06-25T00:17 (~8-9h before observation)
## Reason
agent failed: task '<slug>' (work/tasks/ready/<slug>.md) has no '## Prompt' section
```

Five origin locks are in exactly this `stuck` / `dorfl[bot]` state, all stamped ~00:17
UTC, all with the same "no '## Prompt' section" reason:

- resolvecontinuecontext-doc-still-says-requeue-backlog-claim-gap-2026-06-24
- review-nits-allow-backlog-leak-fence-assertions-2026-06-24
- review-nits-drive-tasks-dispatch-allow-backlog-2026-06-24
- review-nits-work-contract-sanction-deletion-on-apply-discharge-2026-06-24
- stale-work-observations-path-in-log-and-jsdoc-after-notes-taxonomy-reorg-2026-06-24

(The other five origin locks are legitimate `state: active` / `holder: wighawag` runs:
do not touch those.)

Separately, 12 files in `work/tasks/ready/` currently have NO `## Prompt` heading
(`for f in work/tasks/ready/*.md; do grep -q '^## Prompt' "$f" || echo "$f"; done`),
so every one of them is a latent stuck-lock the moment `advance` claims it.

## Root cause (how a promptless task is born)

These tasks were NOT created by issue intake or human `to-task`. `git log --follow`
shows a two-step AUTONOMOUS flow, both commits `by dorfl[bot]`:

1. `advance: surface observation:<slug> (1 question(s))`  — advance's surface-question
   rung turns a review-nit observation into a question-bearing item.
2. `advance: create work/tasks/ready/<slug>.md`  — advance then promotes that
   observation into a `ready/` task. The committed body is: frontmatter +
   (empty) `## What to build` + a `## Non-blocking review findings` prose block.
   NO `## Prompt`.

The body is assembled by `buildPromotedBody()` in
`packages/dorfl/src/triage-persist.ts:~393`. For an `artifact: 'task'` it emits ONLY:
frontmatter (`title`/`slug`/`needsAnswers`/`blockedBy: []`) + `## What to build` +
the observation's mechanism prose + (optional) `## Open questions`. It NEVER synthesizes
`## Prompt` (and leaves `## What to build` empty when the observation's mechanism prose
was split into the findings block). `createAttempt()` in `advancing-lock.ts:~534` writes
that `content` verbatim and CAS-pushes it to `ready/` with no structural validation.

The CONSUMER, `assembleWorkPrompt()` in `packages/dorfl/src/prompt.ts:~623`, REQUIRES a
`## Prompt` heading and throws `task '<slug>' ... has no '## Prompt' section` otherwise.
So the buildable-task schema is enforced only at dispatch time, AFTER the claim lock has
already been taken — hence the stuck lock instead of a clean refusal.

## Which of the three suspected causes it is

The triage question was: skill deficiency, protocol phrasing, or autonomous creation in
do/advance?

- NOT a skill deficiency — no human/agent skill drove these; `dorfl[bot]` produced them
  mechanically via the advance promotion path.
- PARTLY protocol phrasing — the buildable-task shape is documented elsewhere as
  `## What to build` + `## Acceptance criteria` + `## Prompt` (see `intake.ts` renderTask
  scaffold ~L1617 and the lone-task review prose ~L2229), but the PROMOTION path only
  knows the `## What to build` lead heading. The shape is not centralized, so the two
  producers drifted.
- PRIMARILY autonomous task creation in `advance` — `buildPromotedBody` emits a
  structurally-incomplete task (no `## Prompt`) and the create path does not validate it
  before it lands in the pool and becomes claimable.

## Why it matters / candidate fixes (for triage, not decided here)

Each promptless promotion is a guaranteed future stuck lock + wasted dispatch. Options
worth weighing:

1. `buildPromotedBody` should emit a `## Prompt` section (even a thin scaffold seeded
   from the observation prose, like the issue-intake `renderTask` default does), so a
   promoted task is dispatchable on its own. Centralizing the buildable-task shape in one
   renderer would stop producer/consumer drift.
2. Validate the body BEFORE taking the claim lock (a pre-claim well-formedness check in
   `advance`/`do`), so a malformed task is refused cleanly instead of leaving a stuck
   lock — defence in depth even after (1).
3. Consider whether a review-nit observation should auto-promote to a buildable `ready/`
   task at all, vs. stay an observation for human triage; the empty `## What to build` +
   `## Non-blocking review findings` shape suggests these are triage notes, not tasks.

Refs: `triage-persist.ts:~393` (`buildPromotedBody`), `advancing-lock.ts:~534`/`:~590`
(`createAttempt` + `advance: create` commit), `prompt.ts:~623` (`assembleWorkPrompt`
throw), `intake.ts:~1617` (renderTask scaffold WITH `## Prompt`). Lock evidence:
`refs/dorfl/lock/task-<slug>` payload `lock.md`. Create-commit evidence: `532d894`,
`ad99e26`.

## Relation to existing plan (cross-references — keep these consistent)

This is the SAME `promoteObservation` / `buildPromotedBody` machinery already targeted by
the tasked PRD
`work/specs/tasked/observation-discharge-by-deletion-self-contained-promotion-and-prd-route.md`
(origin observation
`work/notes/observations/advance-promote-leaves-resolved-note-in-inbox-and-mints-non-self-contained-stub-2026-06-24.md`).
That PRD's Defect B ("non-self-contained promotion") is the closest sibling, and its
keystone task `promotion-self-contained-body-and-delete-on-promote-task-route` (now in
`work/tasks/done/`) reworked `buildPromotedBody` to carry the observation's mechanism
prose so the note is safely deletable. BUT that landed fix did NOT add `## Prompt`:
`grep -n Prompt packages/dorfl/src/triage-persist.ts` returns nothing, and the live
proof `532d894` (created 2026-06-24, AFTER that work) shows a promoted body with an
empty `## What to build` + `## Non-blocking review findings` and no `## Prompt`. So this
is a RESIDUAL gap against that PRD's US #1 ("the task is buildable on its own"):
self-containment of CONTENT was delivered; structural dispatchability (a `## Prompt`
that `assembleWorkPrompt` accepts) was not. A future task should treat "buildable on its
own" as including "passes `assembleWorkPrompt` without throwing".

The intake-centralization angle the maintainer flagged is recorded in that PRD's
Resolved decision 1: "Sharing the prd-body RENDERING with intake may be extracted later,
but the WRITER is the CAS one." The `## Prompt`-synthesis fix is a natural fit for that
extraction: `intake.ts`'s `renderTask` (~L1617) ALREADY emits the full
`## What to build` + `## Acceptance criteria` + `## Prompt` shape, while
`triage-persist.ts`'s `buildPromotedBody` emits only `## What to build`. Centralizing the
buildable-task RENDERER (one function both the intake front-door and the triage/advance
promotion path call) would fix THIS defect and prevent the producer/consumer drift from
recurring — consistent with that Resolved-decision-1 extraction note. Any task that
acts on this observation should reference that PRD + its done keystone so the two plans
stay one plan, and the "validate body before claiming" defence (cause 2 above) is
orthogonal and can land independently of the renderer centralization.

## Update 2026-06-25 — artifacts written

Two `work/` items now carry this signal (born in staging for human review; not
auto-committed):

- INTERIM guard: `work/tasks/backlog/promoted-task-emits-prompt-and-pre-claim-wellformedness-guard.md`
  — `buildPromotedBody` emits a `## Prompt` + a pre-claim well-formedness check so a
  promptless body is refused BEFORE the claim lock is taken (cause 1 + cause 2). Lands
  independently and fast.
- DURABLE fix: `work/specs/proposed/centralize-buildable-task-renderer-shared-by-intake-and-promotion.md`
  — one shared buildable-task renderer used by both `intake.renderTask` and
  `triage-persist.buildPromotedBody` (the deferred Resolved-decision-1 extraction). It
  SUPERSEDES the interim task's `## Prompt` synthesis while KEEPING its pre-claim guard.

A residual-against-US-#1 pointer was also added to the Further Notes of the tasked PRD
`observation-discharge-by-deletion-self-contained-promotion-and-prd-route` so the plans
stay linked. This observation should be deleted (discharged) once the interim task lands
carrying its signal.
