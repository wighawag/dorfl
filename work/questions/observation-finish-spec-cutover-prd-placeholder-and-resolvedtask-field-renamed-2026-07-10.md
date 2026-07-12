<!-- dorfl-sidecar: item=observation:finish-spec-cutover-prd-placeholder-and-resolvedtask-field-renamed-2026-07-10 type=observation slug=finish-spec-cutover-prd-placeholder-and-resolvedtask-field-renamed-2026-07-10 allAnswered=false -->

Item: [`observation:finish-spec-cutover-prd-placeholder-and-resolvedtask-field-renamed-2026-07-10`](../notes/observations/finish-spec-cutover-prd-placeholder-and-resolvedtask-field-renamed-2026-07-10.md)

## Q1

**What should become of this observation now that its parent task has landed — keep it as a historical decision record, fold its rationale back into the parent spec/task's own notes, or delete it?**

> The note records two PROCEED decisions taken while executing task finish-spec-cutover-protocol-folder-paths-and-frontmatter-field: (1) also renaming ResolvedTask.spec, wrapper/buildAgentPrompt positional param, and the CLAIM-PROTOCOL wrapper <spec> placeholder + its substitution regex beyond the ~8 literal readers listed in B-code; (2) also flipping the stale spec-named LOCK-REF/WORK-BRANCH namespace tokens in CLAIM-PROTOCOL.md + WORK-CONTRACT.md so docs match the already-renamed code. The parent task now sits in work/tasks/done/ and packages/dorfl/src/prompt.ts shows ResolvedTask has the renamed spec field (line 455) with a doc comment referencing the spec, so both decisions have landed and are consistent with current reality. There is no new open engineering question here — only a triage question about the SIGNAL itself.

_Suggested default: Keep it as a historical decision record under work/notes/observations/ (it documents a coherence-check judgement made under the decision-bar rule that future readers may want to trace); no ADR/spec/task needed._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Keep it as a historical decision record under work/notes/observations/. It documents a coherence-check judgement made under the decision-bar rule that future readers may want to trace; no ADR/spec/task is needed and folding it into the parent would bury it.

## Q2

**Does the pre-existing follow-up question in the parent task ('Should parseFrontmatter EVER stop reading the legacy prd: key, or is it a permanent back-compat alias?') want to be lifted out as its own tracked item now that the task is done?**

> Parent task line 43 explicitly parks this as a future decision ('a future task may retire it once all downstream repos are known-migrated'). It is open judgement carried by the item's surface area but was intentionally deferred — surfacing it here so the human can decide whether to mint a follow-up spec/task or leave it parked in the done task's body.

_Suggested default: Leave parked in the done task; mint a follow-up only when a concrete signal (all known downstream repos migrated) arrives._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Leave it parked in the done task. Mint a follow-up for 'should parseFrontmatter EVER stop reading the legacy prd: key' only when a concrete signal arrives (e.g. all known downstream repos have migrated); until then it is a back-compat alias with no forcing reason to change, so a tracked item would just sit idle.
