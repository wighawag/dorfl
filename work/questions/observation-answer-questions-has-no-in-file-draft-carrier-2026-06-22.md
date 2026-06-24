<!-- dorfl-sidecar: item=observation:answer-questions-has-no-in-file-draft-carrier-2026-06-22 type=observation slug=answer-questions-has-no-in-file-draft-carrier-2026-06-22 allAnswered=false -->

## Q1

**What becomes of this observation — promote to a slice (task/brief), promote to an ADR, keep as an open observation, drop, delete, or flag for attention?**

> Observation captured live 2026-06-22 by maintainer mid-`answer-questions` run. It names TWO linked gaps:
>   (A) no "draft, ignored-until-ratified" carrier near the question in the sidecar — protocol-level (touches ADR `question-sidecar-human-readable-format` AND `sidecar-apply.ts` apply semantics);
>   (B) no sanctioned skill step for "human ratifies handle P1/D4/… → skill writes the accepted answer into the `**Your answer**` slot" — skill-level, NO format change.
> The note explicitly declines to choose a fix: "this note does NOT pick a fix shape — that is a JUDGEMENT call … and must not be guessed." It also says "(B) can land first and independently of (A)." Cross-refs: `needs-attention-may-have-no-human-visible-outcome-after-lock-cutover-surface-as-questions-2026-06-21.md`, `questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21.md` (same family — may co-land in one ADR); distinct from `review-nits-question-sidecar-human-readable-format-2026-06-20.md` (those ratify existing parse rules; this ADDS new region/semantics). The observation carries `needsAnswers: true` with two open sub-questions below, which need a destination.

_Suggested default: promote-slice for (B) as a small skill-only task (`answer-questions` phase-2 ratify-by-handle, no format change, lowest risk, delivers the maintainer's actual workflow); promote-adr for (A) as a protocol/format decision, ideally co-landed with the related sidecar-keying / questions-folder ADR family. Keep this observation open until those land._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

## Q2

**(gap B — cheap, no format change) Should `answer-questions` gain a sanctioned phase-2 step where, after the skill emits a handle-tagged batch and the human replies "write P1, D4, …", the skill writes ONLY those named answers into their `**Your answer**` slots (treating the human's handle-pick as the ratification, so it is faithful recording — not invention)? It still never writes an un-named answer, never sets `answered:`/`allAnswered`, never `git mv`/commits.**

> From the note's §"Open questions to NOT guess" Q1 and shape (d). The maintainer's stated intent for numbering was "ratify-by-handle-then-delegate-the-write, NOT for the human to transcribe by hand." Already hand-applied once on 2026-06-22 as a one-off; the question is whether to make it a standing part of the skill. The skill text must draw the ratified-vs-unratified line crisply so an over-eager run never writes an answer the human did not explicitly name. Orthogonal to (A) — can ship first and independently.

_Suggested default: Yes — add it as a standing phase-2 of `answer-questions`, with explicit skill-text guardrails: (i) phase-1 is write-nothing emit as today; (ii) phase-2 writes ONLY handles the human explicitly named in their reply; (iii) any draft/default the human did NOT name is dropped, never written; (iv) the skill still never touches `answered:`/`allAnswered`/`git mv`/commit (those stay with the `advance` apply rung)._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

## Q3

**(gap A — load-bearing, format change) Should the sidecar format + `advance` apply rung ALSO gain a "draft, ignored-until-ratified" carrier so an unratified draft can rest IN the file near the question (surviving across sessions) without the autonomous engine ever mistaking it for a human answer — and if so, which shape: (a) HTML-comment draft region above `**Your answer**` (zero schema, manual move-to-accept), (b) typed `draft=`/`proposed=` field in the per-entry identity comment + dedicated marked block + a human-only `--accept-drafts` verb that promotes draft→answer in one pass, or (c) leave it chat-only (status quo)?**

> From the note's §"Open questions to NOT guess" Q2 and §"Sketch of the fix shapes" (a)/(b)/(c). This touches the humility law's enforcement surface: the autonomous `advance` apply rung treats whatever sits in the `**Your answer**` slot as the human's ratified answer; a draft written there is forgery. So a new region must be PROVABLY ignored by `advance` (must not satisfy `answered`/`allAnswered`, must not be applied, must survive or clear deterministically when the human writes the real answer). The note flags this as the heavier of the two gaps and recommends co-landing in the ADR family with `needs-attention-may-have-no-human-visible-outcome…` and `questions-folder-rename-and-kind-axis-prefix-vs-subfolder…`.

_Suggested default: Open the design as an ADR (co-landed with the related sidecar-keying / questions-folder ADRs). Tentative lean: (a) HTML-comment draft region — zero new schema, invisible on GitHub render, smallest blast radius on the apply rung's trust model; promote to (b) only if batch-approve ergonomics prove necessary. Reject (c) only because the maintainer's flagged ergonomic gap is real, but (c) is acceptable if (B) alone closes enough of the workflow pain to defer (A) indefinitely._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):
