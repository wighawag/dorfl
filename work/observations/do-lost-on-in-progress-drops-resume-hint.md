---
title: in-place `do` on an already-in-progress item now says "someone claimed it. Pick another item." (claim-CAS `lost`) — it dropped the old `performStart` "if this is your own work, re-run with --resume" hint; consider restoring a resume-style hint
date: 2026-06-08
kind: observation
area: packages/agent-runner/src/claim-cas.ts (the `lost`-on-in-progress message) + src/do.ts (performDo)
severity: low
status: open
---

## Where this came from

Ratifying PR #37 (`do-run-share-isolation-seam`) during an `orchestrate` sitting. That slice routed in-place `do` (`performDo`) through the claim CAS (the `do --remote`/`run` claim-first pattern). A deliberate, RATIFIED side effect: an already-in-progress / done / absent item now returns outcome `lost` (exit 2) via the CAS, where the OLD `performStart`-based path returned `refused`/`usage-error` (exit 1) with a per-case message.

## The small UX regression (accepted, worth a follow-up)

For the **already-in-progress** case the user-visible message changed:

- OLD (`performStart`, `src/start.ts`): `'<slug>' is already in-progress; see \`git log\` for who claimed it; if this is your own work, re-run with --resume.`
- NEW (`claim-cas.ts:268`): `'<slug>' is already in-progress on <arbiter>/main — someone claimed it. Pick another item.`

The NEW message LOST the "if this is your own work, re-run with `--resume`" hint.

Nuance that makes this low-severity (not a true regression of a working feature): in-place `do` **never actually had a `--resume` flag of its own** — that hint was inherited verbatim from `performStart` and was arguably already misleading for `do` (re-running `do --resume` was not a supported path; the human face for "continue my own in-progress item" is `resume`/`work-on`, and `do`'s own continue happens via the requeue→continue flow). So the hint pointed at something `do` didn't honour. Still, "someone claimed it. Pick another item." is unhelpful for the common case where the in-progress item is the user's OWN (e.g. a re-run after an interrupted `do`).

## Suggested follow-up (not built)

Improve the `lost`-on-in-progress message so a user re-running `do` on their OWN in-progress item is pointed at the right next step — e.g.:

> `'<slug>' is already in-progress on <arbiter>/main. If someone else claimed it, pick another item; if it's your own (e.g. an interrupted run), continue it with \`agent-runner resume <slug>\` / \`work-on\`, or recover via \`requeue\`.`

Decide the exact wording + which verbs to name when picked up. Keep the done/absent message (claim-cas.ts:272) as-is (it is already accurate). This is a message-only change (no behaviour/exit-code change — the `lost`/exit-2 contract was the ratified decision).

## Promoted 2026-06-08

PROMOTED to slice `work/backlog/do-lost-on-in-progress-resume-hint.md`. Delete this observation once that slice lands in `done/`.
