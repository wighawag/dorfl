## Context

The observation `work/observations/observation:answer-questions-has-no-in-file-draft-carrier-2026-06-22.md` was raised mid-`answer-questions` run and flagged TWO linked gaps:

- **gap B** — a sanctioned ratify-by-handle → skill-writes-the-accepted-answer step (no format change needed). The observation's OQ #1.
- **gap A** — a sidecar-format + `advance` apply-rung "draft, ignored-until-ratified" carrier so an unratified draft can rest in the file near its question across sessions without the autonomous engine ever mistaking it for a human answer. The observation's OQ #2.

The human has now answered both open questions:

1. **Gap B is BUILT.** The ratify-by-handle phase shipped as Phase 2 of `skills/answer-questions/SKILL.md`. OQ #1 is resolved in the live skill.
2. **Gap A is DEFERRED, with a recorded leaning toward shape (a)** — an inert HTML-comment draft region above the `**Your answer**` line (zero new schema, invisible on GitHub render, parser treats it as inert). Explicitly NOT committing to shape (b)'s new human-only `--accept-drafts` verb surface without a concrete need, and NOT settling for chat-only (c) if we're going to carry drafts at all. Because this touches the humility-law enforcement surface, the eventual build decision must not be guessed — it should fold into the SHARED sidecar-structure ADR (same family as `needs-attention-may-have-no-human-visible-outcome-after-lock-cutover-surface-as-questions-2026-06-21.md` and `questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21.md`) rather than a standalone ADR. This is a recorded LEANING, not a build order.

The human's directive: **keep the observation open**, but **narrow it to gap A only**, so it remains the single tracker for the unresolved draft-carrier decision. Do NOT delete it wholesale and do NOT re-surface the resolved half as an open question.

## What to do

Edit `work/observations/observation:answer-questions-has-no-in-file-draft-carrier-2026-06-22.md` IN PLACE so it is a coherent, gap-A-only tracker:

1. **Frontmatter:** keep `status: open` and `needsAnswers: false` (the open questions have been answered; the item is now a standing tracker, not a question sidecar's worth of unanswered prompts). Preserve `title` and `date` (title may be tightened to drop the gap-B half — e.g. something like `answer-questions has no in-file "draft, ignored-until-ratified" carrier near the question (gap A) — draft-carrier format + advance apply-rung decision, deferred with a leaning toward an inert HTML-comment region`). Do not invent new frontmatter keys.
2. **Body — retitle / restructure so it is gap A only:**
   - Rewrite "## The signal" so it describes ONE gap (the missing UNRATIFIED-draft carrier near the question), not two. Keep the load-bearing WHY intact: the sidecar has exactly one writable human slot (`**Your answer**`), the autonomous `advance` apply rung trusts whatever sits there as the human's ratified answer, and the humility law forbids the engine from applying an invented answer — so an unratified draft has no safe destination today.
   - Add a short "## Status of the sibling gap (B) — shipped" paragraph noting that the ratify-by-handle → skill-writes-the-accepted-answer workflow is now Phase 2 of `skills/answer-questions/SKILL.md` (cite the file path), so OQ #1 from the original note is resolved and is NOT what this observation tracks anymore. Frame it as context so a future reader understands why the note used to mention two gaps.
   - Keep "## Why it matters" but trim references that only applied to gap B (e.g. the ratify-by-handle ergonomic argument) — the remaining WHY is the edit-in-place ergonomic AND that gap A is genuinely a PROTOCOL change touching both the sidecar human-readable format ADR and `advance` / `sidecar-apply.ts` semantics.
   - Keep the "## Sketch of the fix shapes" section but restrict it to the (a)/(b)/(c) options for gap A. Drop shape (d) (that was the gap-B answer and is now shipped).
   - **Record the leaning** in a new short "## Recorded leaning (not a build order)" section: leaning toward shape (a) — an inert HTML-comment draft region above the `**Your answer**` line — because it adds zero new schema, renders invisibly on GitHub, and lets the parser treat the region as inert. Explicitly note we are NOT committing to shape (b)'s `--accept-drafts` verb surface without a concrete need, and NOT settling for chat-only (c) if we are going to carry drafts at all. Explicitly say this is a leaning, not a build order.
   - **Route the eventual decision:** add a sentence saying the format+apply-rung decision should be folded into the SHARED sidecar-structure ADR (same family as the sidecar-keying and questions-folder-rename design questions), NOT a standalone ADR, because it touches the humility law's enforcement surface and must not be guessed at build time. Cross-reference the two sibling observations by filename as the observation already does.
   - Rewrite "## Open questions to NOT guess" so ONLY the gap-A question remains, and reframe it as a design question the shared sidecar-structure ADR must answer (not an unanswered prompt on THIS sidecar). Remove OQ #1 entirely.
3. **Do not** touch `skills/answer-questions/SKILL.md`, `docs/adr/`, or any other file — the shipped Phase 2 skill is already the resolution for gap B, and the ADR work is explicitly deferred. This task is purely a body-narrowing edit to the observation file.
4. **Do not** rename or `git mv` the observation file — the slug stays as `observation:answer-questions-has-no-in-file-draft-carrier-2026-06-22.md`. The runner/human owns git-state transitions.

## Acceptance

- The observation file still exists at the same path with `status: open`.
- Its body is coherent as a gap-A-only tracker: a reader who has never seen the original two-gap note understands what is unresolved, what the leaning is, and where the decision will land (shared sidecar-structure ADR).
- Gap B is mentioned only as shipped context pointing at `skills/answer-questions/SKILL.md` Phase 2, not as an open question.
- The recorded leaning toward shape (a) is present and explicitly labelled as a leaning, not a build order.
- No new files, no ADR, no skill edits, no git operations.
- `pnpm -r build && pnpm -r test && pnpm format:check` remains green (this is a docs-only edit; run `pnpm format` if needed before the check).

## Prompt

> Build the task 'narrow-answer-questions-draft-carrier-observation-to-gap-a', described above.
