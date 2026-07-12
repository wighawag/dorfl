<!-- dorfl-sidecar: item=observation:prd-to-spec-contract-leak-scan-source-part-tree-wide-gate-deferred-2026-07-10 type=observation slug=prd-to-spec-contract-leak-scan-source-part-tree-wide-gate-deferred-2026-07-10 allAnswered=false -->

Item: [`observation:prd-to-spec-contract-leak-scan-source-part-tree-wide-gate-deferred-2026-07-10`](../notes/observations/prd-to-spec-contract-leak-scan-source-part-tree-wide-gate-deferred-2026-07-10.md)

## Q1

**What becomes of this observation? The deferral it records has landed — the follow-on task run-prd-to-spec-on-dorfl-acceptance is now in work/tasks/done/, the parent spec has itself migrated to work/specs/tasked/prd-to-spec-vocabulary-cutover-and-migration-command.md, and both leak-scan tests (packages/dorfl/test/prd-to-spec-leak-scan.test.ts and prd-word-cutover-leak-scan.test.ts) coexist as the source-part + tree-wide gates the note anticipated. Discharge by deletion, or preserve any residue as an ADR footnote / promoted note?**

> Observation body records (a) the source-part identifier-scoped leak scan landed with four carve-outs, (b) the exhaustive tree-wide bi-word gate DEFERRED to run-prd-to-spec-on-dorfl-acceptance, and (c) one ratify-or-reverse decision: the advance CI-template producer flip from prd:<slug> to spec:<slug> in advance-lifecycle-template.ts / docs/ci/advance-loop.yml.template / advance-*-template tests. Current reality on 2026-07-12: run-prd-to-spec-on-dorfl-acceptance sits under work/tasks/done/, contract-spec-hard-cutover-rejection-and-leak-scan is also done, the parent spec migrated into work/specs/tasked/, and no open follow-on task references this observation. The producer-flip decision has been in the tree unreversed for two days and rides on the same closed cutover.

_Suggested default: Delete — the deferred gate has been completed downstream (task done, spec migrated, both leak scans in place) and the ratify/reverse decision has stood unchallenged; nothing durable remains that is not already encoded in the landed tests, the ADR §7e text, and the done tasks._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
