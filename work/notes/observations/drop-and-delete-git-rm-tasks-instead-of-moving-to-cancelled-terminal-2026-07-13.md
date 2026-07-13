---
title: The `drop` verb and the apply `delete` outcome `git rm` a TASK instead of moving it to the `tasks/cancelled/` won't-proceed terminal
type: observation
status: open
spotted: 2026-07-13
needsAnswers: true
---

## What was seen

While reviewing the `surface-stuck-as-questions-and-retire-stuck-lock-state` spec, a vocabulary/behaviour mismatch surfaced in the EXISTING disposal path (predates that spec):

- The layout DECLARES `tasks/cancelled/` as the task regime's won't-proceed terminal (`work-layout.ts:90`, key `cancelled`), and `CONTEXT.md:17` describes it as "the generic won't-proceed disposition (superseded / out-of-scope / duplicate / abandoned, with the REASON in the item body as `reason:`)" reached by `git mv` (a RETAINED, auditable terminal).
- Yet the `drop <slug>` verb (`drop-source.ts` `dropSource`) and the apply rung's `delete` outcome both `git rm` the source item (+ its sidecar) in one revertible commit, the reason in the COMMIT MESSAGE, git history as the archive. NO move to `cancelled/`.

So a TASK that is given up on leaves by DELETION (history-only), not by moving to its declared `cancelled/` terminal, even though that folder exists specifically for it. `git rm` is the correct terminal for an OBSERVATION ("notes leave by deletion") but arguably NOT for a task, whose `cancelled/` record is meant to be a durable, browsable, reasoned artifact.

## Why it matters

- **The `cancelled/` terminal is half-used.** The folder + layout key + glossary entry all exist, but the disposal verbs never route a task there, so in practice a cancelled task vanishes into git history rather than resting in `tasks/cancelled/`. An adopter reading `CONTEXT.md` would expect cancelled tasks to be `ls`-able; they are not.
- **Auditability.** A retained `cancelled/<slug>.md` with `reason:` in the body is easier to find, review, and reverse than a `git rm` buried in history. For an autonomous loop that cancels tasks, the durable record is the safer default.

## The distinction to preserve (NOT a bug to "fix" by renaming the FOLDERS)

`CONTEXT.md:71-74` deliberately keeps three senses: `drop` (the verb = `git rm`), `dropped` (the SPEC terminal folder), `cancelled` (the TASK terminal folder, a DELIBERATELY different word so a task + spec sharing a slug cannot collide on one terminal path, per the work-tree-taxonomy ADR). So the fix is NOT to rename the FOLDER words; it is to make the task-disposal PATH `git mv` to `tasks/cancelled/` instead of `git rm`.

## Update: the APPLY path is now resolved by the surface-stuck spec (delete -> dispose)

The APPLY-rung half of this is decided in `work/specs/proposed/surface-stuck-as-questions-and-retire-stuck-lock-state.md` resolved decision #5: the apply DISPOSITION TOKEN `delete` (channel `deleteReason`) is renamed to `dispose` (`disposeReason`) and made REGIME-POLYMORPHIC — dispose a task by `git mv -> tasks/cancelled/`, an observation by `git rm`, a spec by `git mv -> specs/dropped/`. So a task can never be hard-deleted, only disposed to its terminal. THIS observation now narrows to the STANDALONE `drop <slug>` CLI verb, which still `git rm`s a task and is NOT covered by that spec.

## Open questions

1. **Should the standalone `drop <slug>` verb ALSO become regime-polymorphic** (a task → `git mv tasks/cancelled/`, retained), MIRRORING the apply `dispose` outcome the surface-stuck spec introduces? Or is the human-invoked `drop` DEFINED as "the direct hard-delete regardless of type" (in which case a SEPARATE `cancel <slug>` verb is the task-terminal move, and `drop` stays `git rm`)? I.e. is the gap "`drop` should match `dispose`" or "`drop` is fine, but there is no `cancel` verb"?
2. **Should the verb be RENAMED for consistency** now that the apply token is `dispose`? (E.g. a `dispose <slug>` verb, with `drop` kept only if a true hard-`git rm` human escape hatch is wanted.) Weigh against churn on an existing verb.
3. **Fold or split from `surface-stuck-...`?** That spec fixes the APPLY path (`delete`→`dispose`); this standalone-verb consistency fix is arguably a separate, smaller slice. Confirm fold-vs-split.

## Refs

- `packages/dorfl/src/drop-source.ts` (`dropSource` = `git rm`); `packages/dorfl/src/work-layout.ts:90` (`cancelled: 'tasks/cancelled'`); `packages/dorfl/src/cli.ts:3845` (`drop <slug>` command).
- `CONTEXT.md:17` (cancelled = git-mv retained terminal), `CONTEXT.md:71-74` (the deliberate drop/dropped/cancelled three-way distinction).
- Surfaced during the review of `work/specs/proposed/surface-stuck-as-questions-and-retire-stuck-lock-state.md` (resolved decision #5).

## Note on scope

A real but SMALL coherence gap in the existing disposal path, orthogonal to (but discovered by) the surface-stuck spec. Likely a one-verb fix (`git mv` a task to `cancelled/`), gated on deciding whether `drop` itself changes or a new `cancel` verb is added. A human decides fold-vs-split (open question #3).
