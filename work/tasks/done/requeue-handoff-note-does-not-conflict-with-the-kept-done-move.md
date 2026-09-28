---
title: 'A requeue -m handoff note must not make the continued branch's rebase conflict with its own done-move'
slug: requeue-handoff-note-does-not-conflict-with-the-kept-done-move
blockedBy: []
---

## What to build

During the CI-split drive, the conductor ran `dorfl requeue <slug> -m "<note>"` on `ci-split-landed-vs-gated-report` after a Gate-3 block. `-m` appends the note to the END of the task body on `main` (`tasks/backlog/<slug>.md`). The kept work branch had already renamed that file to `tasks/done/<slug>.md` AND appended its Decisions block at the end. The next claim's continue rebase then conflicted on the file tail and routed the item to needs-attention, so the requested fix could never be built from the kept branch. Workaround used later in the drive: requeue without `-m` and insert the note before `## Acceptance criteria` on `main`, which rebases cleanly.

Make `-m` safe: either write the handoff note where it cannot collide with the done-move's tail append (a dedicated section before `## Acceptance criteria`, or a sidecar the continue prompt reads), or have the continue rebase resolve this one known shape (the item's own body file, edited on `main` only by the requeue note) deterministically. Whichever you choose, the note must still reach the continuing agent's prompt.

## Acceptance criteria

- [ ] A requeue with `-m` on an item whose kept branch done-moved and appended to its body continues and rebases cleanly (tested against a bare arbiter).
- [ ] The note reaches the continuing agent's prompt (tested through the prompt builder).
- [ ] `requeue` without `-m` is unchanged.
- [ ] The acceptance gate is green (`pnpm -r build && pnpm -r test && pnpm format:check`).

## Blocked by

- None. Can start immediately.

## Prompt

> Goal: make `dorfl requeue -m` compatible with the continue-from-kept-branch flow. Read the requeue path that appends the handoff note (`needs-attention.ts` / the CLI `requeue` command), the continue rebase (`continue-branch.ts`, `rebaseContinuedBranchOntoMain`), and how the continue prompt picks up the note (`agent-prompt-continue-context`). Reproduce the conflict in a test first.

> FIRST, check this task against current reality (it is a launch snapshot and may have DRIFTED): does it still match the code in `tasks/done/`, the relevant ADRs, and the tasks it depends on? If the premise no longer holds, do NOT build on it: route the task to needs-attention with the discrepancy as the reason (WORK-CONTRACT.md "Drift is a needs-attention signal").
>
> RECORD non-obvious in-scope decisions you make while building in a `## Decisions` block at the end of your FINAL REPORT (see `work/protocol/task-template.md`). Do no git. Bound every exploratory shell command (`timeout 30`, capped output) and never run an unbounded regex over `node_modules`, `dist` or lockfiles.

## Decisions

- **Where the note goes instead of making the rebase resolve the conflict.** I chose to insert the note before the first `## Acceptance criteria` heading. The other option the task offered was teaching `rebaseContinuedBranchOntoMain` to resolve this one conflict shape itself. I rejected that because ADR §10 says the continue rebase never auto-resolves, and a special case there would weaken that rule. A sidecar file would have meant a new artifact kind, and bodies only get a sidecar under specific rules (WORK-CONTRACT rule 8). This choice is also the workaround people already used by hand during the CI-split drive. It affects the `requeue -m` help text and where notes land in body files; the prompt side is unchanged.
- **Bodies without `## Acceptance criteria`.** The note goes at the end, exactly as before. This avoids guessing a different anchor heading for bodies that do not follow the template. The downside is that the original conflict can still happen for those bodies.
- **Bodies that already have a note at the end (written before this change).** A new note will land before Acceptance criteria, so it appears before the older one and the "oldest first" order breaks for that item only. I accepted this because the alternative, placing it after the last existing note, would put it back at the end of the file and bring the conflict back. It only affects items requeued before this change.
