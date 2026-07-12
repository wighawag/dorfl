# 2026-07-12 — `prd-word-cutover-leak-scan` + `prd-to-spec-leak-scan` still red on `main` after 7be9bd2d

Second continuation attempt of `mint-rename-expand-checklist-finding`. The requeue note claimed the leak-scan failure had been fixed at `7be9bd2d` (sweeping two task bodies), and the item was requeued on that basis. Verified against `origin/main` @ `6afef7e2` on a clean worktree (`pnpm -r build && pnpm --filter dorfl test`) that the fix is **insufficient**: three tests are still red on `main`, entirely independent of this task's content (a markdown addition under `work/notes/findings/`).

Concrete failures currently on `main`:

- `test/prd-to-spec-leak-scan.test.ts:618` — `docs/adr/vocabulary-cutover-word-vs-identity-boundary-and-preserve-list.md:{11,20}` still contains `work/prd-tasked/` (whole-literal dead prd/brief token path).
- `test/prd-word-cutover-leak-scan.test.ts:694` — the artifact word `prd`/`PRD` leaks in ~14 sites across `work/tasks/ready/*.md` (including this task's own body `mint-rename-expand-checklist-finding.md:42` in the requeue note runner-prose), one observation (`rename-spec-emit-sites-batch-4d-decisions.md`), and the requeue-handoff prose in several other `ready/` task bodies. Most of these are runner-authored requeue notes.
- `test/prd-word-cutover-leak-scan.test.ts:715` — provenance file `word-scan-exempts-prd-cutover-task-bodies-2026-07-10.md` is missing from `work/notes/`.

Root cause pattern: the leak scan does not exempt the runner's own requeue-note prose in `ready/` task bodies, so every requeue that mentions "prd-word leak-scan" as a diagnosis re-introduces a leak. There is already a `ready/` task named `exempt-work-questions-sidecars-from-prd-word-leak-scan.md` covering an adjacent case — a similar exemption for task-body prose (or a rewording rule for the runner's requeue notes) may be needed.

Not touched here — this task's scope is the finding file only. The finding file is written and matches the spec; the pre-existing gate failure is out of scope. Flagging so the signal is captured for the human/runner to route.
