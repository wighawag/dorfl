---
title: 'Answered-merge messages name the pre-namespace `work/<slug>` branch'
slug: apply-merge-action-messages-name-un-namespaced-branch
date: 2026-09-29
status: spotted
---

`packages/dorfl/src/apply-merge-action.ts` (HOLD/DROP/MERGE notes around lines 425-540) and `advance.ts:1287` print `` `work/${input.slug}` `` in user-facing messages, but the build branch is now `work/task-<slug>` (`workBranchRef`), so the messages name a branch that does not exist. Spotted while fixing `merge-question-surfacer-finds-namespaced-work-branches`; not verified whether any of these paths also USE that string as a ref.

Re-filed by the drive-tasks conductor from the discarded first build (kept branch commit 0d54d666, lost when its stuck question was answered `reset`). Still true on `main@071cb5a1`: `apply-merge-action.ts` lines ~377-492 print `` `work/${input.slug}` `` in the HOLD / DROP / MERGE messages.
