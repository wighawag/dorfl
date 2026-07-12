<!-- dorfl-sidecar: item=observation:erase-prd-word-cutover-decisions-2026-07-10 type=observation slug=erase-prd-word-cutover-decisions-2026-07-10 allAnswered=false -->

Item: [`observation:erase-prd-word-cutover-decisions-2026-07-10`](../notes/observations/erase-prd-word-cutover-decisions-2026-07-10.md)

## Q1

**What becomes of this signal — the four decisions recorded here (verb-alias prose preservation; word-vs-identity boundary; setup migration-map SOURCE preservation; sweeping historical folder-key literals in tasks/done/ records)?**

> work/notes/observations/erase-prd-word-cutover-decisions-2026-07-10.md is a decision-bar note written while landing the erase-prd-artifact-word cutover task (spec prd-to-spec-vocabulary-cutover-and-migration-command). It is already linked from the done record and mainly documents choices baked into the shipped code + the new prd-word-cutover-leak-scan.test.ts gate (so the boundary rule cannot re-drift). It flags one live residue as OUT-OF-SCOPE (advance-lifecycle-template.ts / advance-ci-template.ts / tasking-lock.ts JSDoc still say the retired word) and points at a sibling observation advance-lifecycle-template-src-prose-still-says-prd-2026-07-10.md that already tracks that follow-up. Nothing here is contradicted by current reality: the leak-scan test exists, the aliases still parse, and the migration-map LEFT column still carries the legacy folder names.

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**Should any of the four decisions be promoted to an ADR (in particular the word-vs-identity boundary rule + PRESERVE-list discipline, which is now enforced by a gate test and may govern future vocabulary cutovers)?**

> Decision (2) encodes a reusable policy — sweep at word boundaries, exempt camelCase / snake identifiers / enumerated slug identities / namespace tokens — and Decision (1) encodes a rule about not re-meaning a live CLI alias surface via a prose sweep. Both are the kind of cross-cutting choice future cutover tasks (e.g. any next artifact-word retirement) will want to look up as a standing rule, not rediscover from a decisions note attached to one done task.

_Suggested default: No — keep as historical decision-record only; open a spec/ADR later only if a second vocabulary cutover actually needs the shared rule._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Yes, promote the word-vs-identity boundary rule + the PRESERVE-list discipline to a small ADR. These two are now enforced by a gate test and are the load-bearing pair likely to govern future vocabulary cutovers, so they warrant a durable, citable decision record. The other two decisions (verb-alias prose preservation; setup migration-map SOURCE preservation) do not need promotion beyond this note.
