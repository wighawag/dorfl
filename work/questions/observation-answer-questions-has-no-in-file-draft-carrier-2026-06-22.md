<!-- dorfl-sidecar: item=observation:answer-questions-has-no-in-file-draft-carrier-2026-06-22 type=observation slug=answer-questions-has-no-in-file-draft-carrier-2026-06-22 allAnswered=false -->

## Q1

**Gap B is now BUILT — the observation's open question #1 ("make the ratify-by-handle phase a standing part of answer-questions?") is resolved in the live skill. What becomes of this observation now: retire/delete it (its purpose served), narrow it down to the still-open gap A and re-task, or keep it open as the umbrella note tracking gap A?**

> The observation flags TWO gaps. Gap B (phase-2 ratify-by-handle -> skill writes accepted answers; OQ #1) is the one the maintainer actually asked for and the note says was "hand-applied once on 2026-06-22 as a one-off; the question is whether to make it a standing part of the skill." It now IS standing: skills/answer-questions/SKILL.md has a documented '### Phase 2 (OPTIONAL, human-initiated): ratify-by-handle' section (lines 64-74) with ironclad rules (write only human-named handles, amendments verbatim, never set answered/allAnswered, ask when ambiguous), plus the dual restated at lines 87-89. So the observation is now PARTLY stale: gap B is shipped, only gap A remains. The triage question is genuinely open because the note bundles a now-done item with a still-open one.

_Suggested default: Keep open but narrow to gap A only (note in the body that gap B shipped in skills/answer-questions/SKILL.md Phase 2 on/after 2026-06-22), so it stays the single tracker for the unresolved draft-carrier decision rather than being deleted wholesale or re-surfacing the resolved half._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Keep the observation open but NARROW it to gap A only. Gap B (ratify-by-handle) shipped in `skills/answer-questions/SKILL.md` Phase 2, so note that in the body and let this observation remain the single tracker for the unresolved draft-carrier decision (gap A / Q2). Do not delete it wholesale and do not re-surface the resolved half.

## Q2

**Gap A (OQ #2): should the sidecar FORMAT + advance apply rung gain a "draft, ignored-until-ratified" carrier so an unratified draft can rest in the file near its question across sessions without the autonomous engine ever mistaking it for a human answer — and if so, which shape: (a) inert HTML-comment draft region above the answer line, (b) a typed draft=/proposed= identity-comment field promoted by a human-only --accept-drafts pass, or (c) leave it chat-only (status quo)?**

> This is the load-bearing, format-touching half and is STILL OPEN: skills/answer-questions/SKILL.md explicitly states "There is no sanctioned 'draft, ignored-until-ratified' CARRIER in the sidecar ... a parked, browsable in-file draft is out of scope for this skill" (line 74); docs/adr/question-sidecar-human-readable-format.md has no draft region; packages/dorfl/src/sidecar-apply.ts has no draft/proposed/ratify handling at all. The note is explicit this is a JUDGEMENT call that must not be guessed (it touches the humility law's enforcement surface — get it wrong and you re-open the forge-the-signature hole the carrier is meant to avoid). It also flags this may want to land in the SAME ADR as the cross-referenced sidecar-keying / questions-folder-rename design questions (the same family of "how much structure should the sidecar carry" decisions).

_Suggested default: Defer the build decision but record a leaning toward shape (a) the inert HTML-comment region (zero new schema, invisible on GitHub render, parser treats it as inert), as the lowest-risk way to add a carrier the apply rung provably ignores; do NOT commit to (b)'s new human-only verb surface without a concrete need. Consider folding the format decision into the shared sidecar-structure ADR rather than a standalone one._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Defer the build decision, but record a leaning toward shape (a): an inert HTML-comment draft region above the answer line (zero new schema, invisible on GitHub render, the parser treats it as inert). Do NOT commit to (b)'s new human-only --accept-drafts verb surface without a concrete need, and don't settle for chat-only (c) if we're going to carry drafts at all. This touches the humility-law enforcement surface, so it must not be guessed at build time: fold the format decision into the shared sidecar-structure ADR (same family as sidecar-keying and the questions-folder-rename design questions) rather than a standalone one. This is a recorded leaning, not a build order.
