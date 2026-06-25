<!-- dorfl-sidecar: item=observation:close-job-via-prd-code-literal-vs-renamed-brief-field type=observation slug=close-job-via-prd-code-literal-vs-renamed-brief-field allAnswered=false -->

## Q1

**This signal was already TASKED and that task is in work/tasks/done/, yet the code change it claimed never actually landed. The observation was minted into `work/tasks/done/fix-scan-json-brief-pool-jq-and-close-job-via.md` (frontmatter `brief: code-identifier-slice-prd-to-task-brief-rename`), whose Fix 2 + done criterion was: "close-job.ts discriminator is `via: 'issue' | 'brief'` (no `'prd'` literal)". But the LIVE code still carries the stale `'prd'` literal end-to-end. So: what becomes of this observation now? Re-open it as a fresh task (the done-task's Fix 2 regressed or was never applied), keep it as a standing signal pending the wider `code-identifier-slice-prd-to-task-brief-rename` cutover, or delete it as superseded?**

> Live-code check (working tree clean, only commit on the file is 67a19ca 'Rename project from agent-runner to dorfl'):
> - packages/dorfl/src/close-job.ts STILL has `via: 'issue' | 'prd'` (L74, L149), `via: 'prd'` object literals (L153, L170), `closeComment(via: 'issue' | 'prd', ...)` (L214), and the `cand.via === 'prd'` branch (L242).
> - packages/dorfl/test/close-job.test.ts:225-226 ASSERTS `.via).toBe('prd')` — the exact opposite of the done-task's stated done criterion. The gate is green BECAUSE the test still expects `'prd'`, so nothing flags the regression.
> - grep for `via: 'brief'` / `'brief'` in both close-job.ts and frontmatter.ts returns NOTHING.
> The done-task `fix-scan-json-brief-pool-jq-and-close-job-via.md` is dated 2026-06-23 and explicitly closes this very observation. Its Fix 2 is therefore not present in the tree: either it never landed or the agent-runner->dorfl rename / a later edit reverted it.

_Suggested default: re-open as a small fresh task under the existing `code-identifier-slice-prd-to-task-brief-rename` brief: rename the close-job discriminator `'prd'` -> `'brief'` (type, literals, `cand.via === 'prd'` branch, `closeComment`) AND flip the `close-job.test.ts:225-226` assertion to `toBe('brief')` in the same unit — because the supposedly-done fix is absent and the green test is currently masking the gap._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**The observation's own premise is partly inaccurate against current reality: it states `resolveClosingIssue` "returns `via: 'brief' | 'issue'`", implying the close-job `'prd'` literal is the lone laggard. But `frontmatter.ts:441-451` `resolveClosingIssue` STILL returns `{via: 'prd'; prd: string} | {via: 'issue'; issue: number}` — it has NOT been renamed to `'brief'`. Should the triage record that the `'prd' -> 'brief'` rename is actually unstarted across BOTH `frontmatter.ts` (the source of `via`) and `close-job.ts` (the consumer), so any re-tasking covers the whole `via` lineage rather than just close-job's local copy?**

> packages/dorfl/src/frontmatter.ts:441 `export function resolveClosingIssue(... ): {via: 'prd'; prd: string} | {via: 'issue'; issue: number} | undefined`. The `brief:` frontmatter field rename has not reached the code: `resolveClosingIssue` reads `frontmatter.prd`, not `frontmatter.brief`. So the observation's note that close-job is stale "vs the renamed `brief:` field" describes a future/forward-looking state, not the current tree — the field rename is itself still pending in code.

_Suggested default: scope any re-tasking to the full `via`/`prd:` lineage (frontmatter.ts `resolveClosingIssue` + close-job.ts + their tests), folding it into the `code-identifier-slice-prd-to-task-brief-rename` brief rather than treating close-job's literal as an isolated, already-renamed-upstream laggard._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):
