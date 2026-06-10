---
title: do-lost-on-in-progress-resume-hint — improve the claim-CAS `lost`-on-in-progress message to point a user re-running do on their OWN item at the right recovery verb (resume/work-on/requeue)
slug: do-lost-on-in-progress-resume-hint
covers: []
---

> Self-contained UX/message slice — derives from NO PRD (`covers: []`), so per WORK-CONTRACT.md it omits `prd:` and is its own source of truth. Source signal: `work/observations/do-lost-on-in-progress-drops-resume-hint.md`. The ratified `lost`/exit-2 contract it sits on is recorded in `work/observations/review-nits-do-run-share-isolation-seam-2026-06-08.md` (`## Decisions`). This is a MESSAGE-ONLY change \u2014 no behaviour/exit-code change.

## What to build

After `do-run-share-isolation-seam` routed in-place `do` through the claim CAS, an already-in-progress item returns outcome `lost` (exit 2) with the message (`claim-cas.ts:268`):

> `'<slug>' is already in-progress on <arbiter>/main — someone claimed it. Pick another item.`

This DROPPED the old `performStart` hint ("if this is your own work, re-run with --resume"). The common case \u2014 a user re-running `do` on their OWN interrupted in-progress item \u2014 is now told unhelpfully to "pick another item." Restore a resume-style hint pointing at the RIGHT recovery verb(s) for `do` (the old hint named `--resume`, which `do` never actually honoured \u2014 so name the verbs that DO work: `resume` / `work-on` for continuing your own item, `requeue` for recovery).

Suggested wording (finalise the exact verbs at build time):

> `'<slug>' is already in-progress on <arbiter>/main. If someone else claimed it, pick another item; if it's your own (e.g. an interrupted run), continue it with \`agent-runner resume <slug>\` (or \`work-on\`), or recover via \`requeue\`.`

Keep the done/absent message (`claim-cas.ts:272`) AS-IS \u2014 it is already accurate.

## Acceptance criteria

- [ ] The `lost`-on-in-progress message names the right recovery path for a user re-running `do` on their OWN item (resume/work-on, and/or requeue) \u2014 verify the exact verbs exist in the CLI before naming them.
- [ ] The done/absent `lost` message (`claim-cas.ts:272`) is UNCHANGED.
- [ ] NO behaviour/exit-code change \u2014 the `lost`/exit-2 contract (ratified) is untouched; this is message text only.
- [ ] A test asserts the in-progress message contains the recovery hint and the done/absent message does not (mirror existing `claim-cas` / `do` message tests).
- [ ] `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Blocked by

- None.

## Prompt

> Improve the claim-CAS `lost`-on-in-progress message so a user re-running `do <slug>` on their OWN interrupted in-progress item is pointed at the right recovery verb, restoring (in corrected form) the hint that `do-run-share-isolation-seam` dropped. Source: `work/observations/do-lost-on-in-progress-drops-resume-hint.md`. MESSAGE-ONLY \u2014 do NOT change behaviour or the `lost`/exit-2 contract (that contract is RATIFIED \u2014 see `work/observations/review-nits-do-run-share-isolation-seam-2026-06-08.md`).
>
> WHERE: `src/claim-cas.ts` ~line 268 (the in-progress `lost` message). VERIFY the recovery verbs exist before naming them \u2014 grep the CLI (`src/cli.ts`) for `resume` / `work-on` / `requeue` and name only the real ones. Keep the done/absent message (~line 272) as-is.
>
> DRIFT CHECK FIRST: confirm the in-progress message still reads "…someone claimed it. Pick another item." (no hint). If a hint is already present, this slice is done \u2014 close it.
>
> "Done" = the in-progress message names the correct recovery path, the done/absent message is unchanged, a test pins both, no behaviour change, and `pnpm -r build && pnpm -r test && pnpm -r format:check` green.

## Needs attention

acceptance gate failed (exit 1)

## Needs attention

continuing the kept work/do-lost-on-in-progress-resume-hint: rebase onto the latest main conflicted (aborted, never auto-resolved) — resolve against the latest main, or `requeue --reset` to discard and start fresh
