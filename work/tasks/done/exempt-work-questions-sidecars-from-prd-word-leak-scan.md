---
promotedFrom: observation:prd-word-leak-scan-fails-on-bot-generated-triage-sidecars-2026-07-12
---
> **DONE 2026-07-13 (already-satisfied, no code needed).** The specified fix — exempting `work/questions/` from the prd-word leak scan's `work/**` walk in `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` — already landed on `origin/main` in commit `970ce7eb` (fix(leak-scan): exempt derived question sidecars). `isExcludedDir` already returns true for `work/questions/` with a WHY comment citing the source observation. `pnpm -r test` is green. No source change was needed; the task premise (a failing test) no longer holds. Resolved by moving to done/ with this record.


## What to build

Narrow the tree-wide `prd`/`PRD`/`Prd` cutover leak scan so that bot-generated triage sidecars under `work/questions/` are NOT gated. These sidecars are DERIVED, machine-generated content that legitimately quotes the source observation's body verbatim (as provenance/context); when the surfaced observation is itself about the `prd→spec` cutover, its body MUST mention the retired word, and the scan then fires on the quote. That is a structural false positive — it is not a live alias leak in authored prose, it is the loop quoting its own subject.

Concretely:

- Edit `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` so its walk over `work/**` skips the `work/questions/` directory entirely (or, equivalently, adds `work/questions/**` to the PRESERVE allow-list with a comment explaining WHY: bot-generated sidecars quote source bodies as provenance, and sidecars are transient — deleted on apply — so they are not the authored-prose surface the cutover policy is protecting).
- Do NOT also exempt `work/notes/observations/` bodies. That is a broader carve-out and is deliberately left out of scope for this task; if it becomes necessary later it will be decided separately.
- Keep every other scope (docs, code, other `work/` subtrees) UNCHANGED. This is the narrowest correct fix: policing authored prose, not machine-derived question text that quotes a source.
- Add/adjust a test-file comment or a small fixture assertion so the intent ("sidecars are derived; the scan targets authored surfaces") is legible to a future reader.
- Verify: `pnpm -r build && pnpm -r test && pnpm format:check` must be green. In particular, the previously-failing `prd-word-cutover-leak-scan.test.ts` must now pass on a tree that still contains bot-generated `work/questions/observation-*.md` sidecars quoting `prd`-word bodies.

Out of scope (handled separately, in parallel): discharging the currently-landed 32-ish `prd`-quoting sidecars on `main`. That drain is already in progress via triaging the underlying cutover observations (answering their sidecars → apply → the bot sidecars are deleted with them). This task ONLY stops the loop from re-tripping the gate on future surface writes.

## Prompt

> You are implementing a narrow scope fix to the `prd`-word cutover leak scan in this repo.
>
> Context: `pnpm -r test` on `origin/main` currently fails ONE test — `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` — because the advance-lifecycle loop landed bot-generated triage sidecars in `work/questions/observation-*.md` that quote source observation bodies verbatim as provenance. Some of those source observations are about the `prd→spec` cutover itself, so their bodies legitimately contain `prd`/`PRD`, and the tree-wide `work/**` scan trips on the quoted text. This is a structural false positive: sidecars are derived, machine-generated, transient (deleted on apply), and are not the authored-prose surface the cutover is policing.
>
> The decided fix (adopted by the human, option 1 of the source observation): exempt `work/questions/` sidecars from the scan. Do NOT also exempt `work/notes/observations/` bodies — that broader carve-out is deliberately out of scope here.
>
> Do this:
> 1. Reproduce the failure first: `pnpm -r test` and confirm `prd-word-cutover-leak-scan.test.ts` reports leaks under `work/questions/observation-*.md`.
> 2. Edit `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` so the walk skips `work/questions/` entirely (either by pruning that directory during traversal, or by adding `work/questions/**` to the PRESERVE allow-list). Whichever mechanism the file already uses, match it. Leave a short inline comment stating WHY: sidecars are bot-generated derived content that quote source bodies as provenance, not authored prose.
> 3. Do NOT change gating for any other path (docs, code, other `work/` subtrees, `work/notes/observations/`).
> 4. Keep the other assertions in that test file intact — only the `work/questions/` scope changes.
> 5. Run the acceptance gate: `pnpm format` first, then `pnpm -r build && pnpm -r test && pnpm format:check`. All three must be green.
> 6. Do NOT attempt to delete or discharge the currently-landed `work/questions/observation-*.md` sidecars — that drain is happening in parallel via the normal answer/apply loop and is not your concern.
>
> Deliverable: a minimal diff to `packages/dorfl/test/prd-word-cutover-leak-scan.test.ts` (plus any small test-support change strictly needed) that makes `pnpm -r test` green on a tree that still contains `prd`-quoting sidecars under `work/questions/`, with a comment in the test file explaining the carve-out.
