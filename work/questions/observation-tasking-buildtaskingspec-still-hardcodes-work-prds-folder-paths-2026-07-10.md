<!-- dorfl-sidecar: item=observation:tasking-buildtaskingspec-still-hardcodes-work-prds-folder-paths-2026-07-10 type=observation slug=tasking-buildtaskingspec-still-hardcodes-work-prds-folder-paths-2026-07-10 allAnswered=false -->

Item: [`observation:tasking-buildtaskingspec-still-hardcodes-work-prds-folder-paths-2026-07-10`](../notes/observations/tasking-buildtaskingspec-still-hardcodes-work-prds-folder-paths-2026-07-10.md)

## Q1

**This observation appears already discharged in the current tree — what becomes of it: delete as stale, or is there residual drift you still want addressed?**

> packages/dorfl/src/tasking.ts:1339-1342 already binds `const specReady = workFolderRel('specs-ready')` / `specTasked = workFolderRel('specs-tasked')` and interpolates `${specReady}/${slug}.md` + `${specTasked}` in the prompt — exactly the fix the observation's 'Suggested fix' section proposes. tasking-protocol-doc.test.ts:209-221 pins this shape with a 'current vocabulary, cannot re-drift' assertion that requires `workFolderRel('specs-ready')` and `workFolderRel('specs-tasked')` and forbids bare `work/prds/*` literals. work-layout.ts:92-93 maps `specs-ready` → `specs/ready` and `specs-tasked` → `specs/tasked`, so the resolved prompt string is on the migrated vocab. The JSDoc mentions of `work/specs/ready/` throughout tasking.ts are on the CURRENT folder names (specs/ready, specs/tasked), not the retired `work/prds/*` the title flags — so the ~20 prose occurrences are correct, not stale. The observation's own body is internally inconsistent (says literals `work/specs/ready/` are stale 'even though data folders migrated to work/specs/*' — same path), suggesting it was authored mid-cutover and the cutover has since completed.

_Suggested default: Delete the observation as already-discharged (the fix it proposes has landed: folder-key indirection in buildTaskingSpec + a drift-guard test pinning it)._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
