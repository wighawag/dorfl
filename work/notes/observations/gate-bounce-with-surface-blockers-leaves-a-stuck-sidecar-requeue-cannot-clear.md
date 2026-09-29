---
title: 'A gate bounce under surfaceBlockers writes a stuck sidecar and releases the lock, so the drive-tasks requeue recovery (and the do message) no longer fit'
date: 2026-09-29
status: spotted
---

Seen by the conductor of a drive-tasks run over this repository (dorfl 0.14.3, `dorfl.json` has `surfaceBlockers: true`). `dorfl do task:merge-question-surfacer-finds-namespaced-work-branches --isolated --allow-backlog --propose --no-review` failed its fresh-worktree gate only on 5-second vitest timeouts in unrelated tests (`needs-attention-as-stuck-lock-state`, `centralise-bounce-branch-push`, `bounce-atomic-cutover-primitives`) while the host load average was about 12; the diff touched only `merge-question-surfacer.ts` and its test, which no production code imports.

The run printed "marked '...' stuck on its per-item lock (surfaced by status; `requeue` once resolved)", but what it actually did was the retired-stuck-lock bounce of CLAIM-PROTOCOL.md step 7b: it committed `work/questions/task-<slug>.md` (a `kind=stuck` entry) and `needsAnswers: true` on the task body straight to `main` (commit 8d6f12dd), and released the lock. `dorfl requeue <slug> --arbiter origin -m ...` then refused with "has no held per-item lock". Two consequences:

- The `do` / `integration-core.ts` wording ("stuck on its per-item lock", "`requeue` once resolved") describes the retired stuck-lock state; it should say a stuck question was surfaced and name the answer verbs (`keep` / `reset` / `cancel`).
- `skills/drive-tasks/SKILL.md` "Recovering a needs-attention item (requeue)" still prescribes `requeue` keep+continue for a flake. Under the current bounce the conductor's recovery is answering the stuck sidecar (`keep`) and letting the apply rung drain it, which is a human answer the skill does not currently let a conductor give. The skill should say which it is.

Related: `requeue-after-gate-bounce-reports-no-held-lock-and-drops-handoff-2026-09-29.md` (same symptom without `surfaceBlockers`). The 5-second timeouts themselves are the known load-sensitive flake class (`flaky-fresh-gate-and-self-renaming-folder-fixture-2026-07-11.md`).
