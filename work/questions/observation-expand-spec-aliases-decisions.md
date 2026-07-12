<!-- dorfl-sidecar: item=observation:expand-spec-aliases-decisions type=observation slug=expand-spec-aliases-decisions allAnswered=false -->

Item: [`observation:expand-spec-aliases-decisions`](../notes/observations/expand-spec-aliases-decisions.md)

## Q1

**What becomes of this decisions observation now that the prd→spec cutover has progressed through many contract/rename batches — discard it, promote its still-load-bearing choices into an ADR, or keep as a historical done-record artefact?**

> work/notes/observations/expand-spec-aliases-decisions.md is a 5-point durable record written 2026-07-09 for the EXPAND step of task expand-spec-frontmatter-and-namespace-aliases (spec prd-to-spec-vocabulary-cutover-and-migration-command). Every point is framed as reversible-by-a-later-contract-batch. Since then work/tasks/done/ carries contract-spec-hard-cutover-rejection-and-leak-scan, rename-spec-* (frontmatter, config+intake, CLI flags, verdict outcome, namespace, remaining src modules a/b), erase-prd-artifact-word-everywhere-spec-is-the-one-vocabulary and finish-spec-cutover-protocol-folder-paths-and-frontmatter-field — i.e. the follow-on migrate/contract batches the observation defers to have all landed. So each decision is either now superseded by the hard cutover (points 1,2,3,5 — dual-key precedence, prd: rejection branch, do-dispatch, prd/spec verdict token both gone) or absorbed as normal config semantics (point 4). Nothing in the file appears still load-bearing, but the file itself explicitly says 'Link this from the task's done record' and the task IS done, so the signal is ambiguous: was the linking ever done, and is the historical record still wanted?

_Suggested default: Discard — the cutover has hard-completed via later contract batches so none of the five choices remain load-bearing; if any nuance is worth preserving durably, lift it into an ADR rather than keeping a per-task decisions note._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Keep as a historical done-record artefact, or delete: the still-load-bearing choices have already been carried into the many landed contract/rename batches, so they do not need to be re-promoted into a standalone ADR. Treat this as archived provenance rather than live work.

## Q2

**Was this file ever linked from the done-record of expand-spec-frontmatter-and-namespace-aliases as its author intended, and if not, does that linkage still need to happen before discharge?**

> The observation's opening paragraph says 'Link this from the task's done record'. work/tasks/done/expand-spec-frontmatter-and-namespace-aliases.md exists; a quick check would confirm whether the link exists. If the intended linkage never happened, discarding the observation silently loses the author's stated intent.

_Suggested default: Check the done record; if unlinked and the human wants the historical context preserved, add the link in the same commit that removes the observation, otherwise just discard._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Do not backfill the link; discard. The decisions are already carried into the many landed contract/rename batches, so whether or not this file was ever linked from the expand-spec-frontmatter-and-namespace-aliases done record, the historical linkage adds no future-lookup value now. Just delete the observation on discharge.
