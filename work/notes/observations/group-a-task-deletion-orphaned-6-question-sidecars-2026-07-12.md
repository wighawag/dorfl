---
needsAnswers: false
triaged: keep
---

# GROUP-A task deletion in `d4fd53db` orphaned 6 question sidecars (task deleted, sidecar not)

2026-07-12. Spotted while explaining why `work/questions/task-questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21.md` carries a `task-` prefix yet reads as an observation's questions. It is a `task:` sidecar whose owning task no longer exists.

## What happened (verified in git history + on disk)

Commit `d4fd53db` ("fix(work): repair 12 promptless promoted tasks in tasks/ready/ (un-buildable)", 2026-06-25) deleted 6 un-buildable promptless "GROUP A" tasks on the stated plan that the now-fixed observation->task promotion path would re-mint them from their still-present source observations. The commit deleted the TASK files but did NOT delete their per-item QUESTION SIDECARS under `work/questions/`. The re-mint never happened, so all 6 sidecars became ORPHANS: `work/questions/task-<slug>.md` keyed to `item=task:<slug>` where no `work/tasks/*` file exists.

Worse, at least one orphan (`questions-folder-rename-...`) accumulated real HUMAN ANSWERS AFTER its task was deleted (`793d3972 answer(triage)`), so substantive decisions ended up living ONLY in an orphaned sidecar.

The 6 orphaned sidecars (all `allAnswered=false`, all with answered Q/A, source observation present for each):

- `task-questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21.md` (7 Q; ADR-level layout/keying decisions)
- `task-advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md` (4 Q)
- `task-needs-attention-test-cleanup-enotempty-flake.md` (4 Q)
- `task-review-nits-prompt-guidance-test-first-2026-06-21.md` (4 Q; net = drop, overtaken by events)
- `task-review-nits-question-sidecar-human-readable-format-2026-06-20.md` (6 Q)
- `task-scan-autobuild-autoslice-resolved-by-two-different-readers-may-disagree-2026-06-20.md` (5 Q)

## Remediation applied (2026-07-12, manual)

The answered Q/A from each orphan was recovered VERBATIM into a `## Resolution (recovered from an orphaned question sidecar, 2026-07-12)` section appended to its source observation (each observation also had its stale "Triaged: promoted" / "maps onto task:..." footer CORRECTED, since it pointed at a deleted task). The 6 orphan sidecars were then deleted. After this, every remaining sidecar in `work/questions/` maps to a live owning item.

## The process gap (the durable signal)

Task deletion is not sidecar-aware. Deleting a `work/tasks/*` item leaves its `work/questions/<type>-<slug>.md` sidecar behind as an orphan. This is EXACTLY the orphan hazard predicted by the open questions in `questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21` (Q4 self-heal-vs-halt, Q5 force-resolve-should-delete-sidecar): the `needsAnswers <=> sidecar` invariant CATCHES an orphan loudly at the item's next advance tick, but nothing here even reaches that tick (the item is GONE, so it never ticks again), and nothing AUTO-HEALS. A `gc`/lint pass that flags "sidecar whose `item=` identity has no owning file in any tree" would have caught all 6.

## Cross-links

- Feeds the self-heal/gc follow-up items called for in `questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21` (Q4/Q5 of its recovered Resolution).
- Same root class as the "orphan sidecar" analysis in that observation's Discussion round 2 (a sidecar surviving a phase transition its item did not), specialised here to task DELETION rather than force-resolve.
