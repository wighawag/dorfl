---
'dorfl': patch
---

A tasking (`spec:`) review that DISAPPROVES now exits 0 (green CI leg) and, in propose mode, CLOSES a stale open PR with the review as the closing comment while keeping the branch.

Two coupled fixes to the tasking disapprove path:

- **A clean park-for-human is a SUCCESS, not a failure.** When a tasking review disapproves the produced task SET (or the tasker loop can't converge, or a co-located sidecar / unparseable verdict blocks), `performTask` cleanly surfaces the spec for the human (`needsAnswers: true` body + a question sidecar on `main`, lock RELEASED) and now returns exit 0 instead of exit 1 — so the `advance-propose` CI leg is GREEN, matching the build path (which already treats a clean-surface bounce as exit 0). This stops a normal "I've surfaced a question, over to you" outcome from reddening CI every time and training operators to ignore red. The surface messaging was reworded to say the item is "parked for your attention" rather than the misleading "marked the per-item lock stuck" (the stuck lock state is retired; the lock is released, not held).

- **Disapprove closes the stale PR (keeps the branch); a later approving re-task reopens it.** Because the earlier multi-run bug could already have opened a tasking PR, a disapprove now closes that PR — with the disapproving review as the closing comment (so the reason is visible ON the PR) — while KEEPING the branch as the recovery point. Only-if-exists: it never opens a PR just to close it, and merge mode (no PR) never consults the seam. A new advisory, never-throw `ReviewProvider.closeRequestOnBranch` (GitHub: `gh pr close <branch> --comment` with NO `--delete-branch`) does the close; `openRequest` now REOPENS a previously-closed PR (`gh pr reopen`) instead of opening a duplicate, so an approving re-task lands back on the same PR with its history and closing-comment thread intact.
