---
title: 'answer-questions emits drafts only to chat: two gaps — (A) no "draft, ignored-until-ratified" carrier near the question, and (B) no sanctioned ratify-by-handle → skill-writes-the-accepted-answer step — because the only writable slot (`**Your answer**`) is the human-authored one the apply rung trusts and acts on'
date: 2026-06-22
status: open
needsAnswers: true
---

## The signal

While running the `answer-questions` operator skill against a populated `work/questions/` (32 sidecars), the maintainer raised TWO linked ergonomic points:

1. **"Write the drafts INTO the files"** — so deciding is "edit or blank it in place" rather than transcribing from a chat batch; and crucially so the QUESTION + CONTEXT sit next to the draft (a chat batch that elides the verbatim question forces a manual file lookup to decide, defeating the point).
2. **"Number each so I can tell YOU which to write"** — the maintainer's intended workflow is: skill emits a handle-tagged batch (`P1`, `D4`, …); human replies "write P1, D4, D9"; the SKILL then writes those accepted answers into the files. The numbering was for ratify-by-handle-then-delegate-the-write, NOT for the human to transcribe by hand.

The skill cannot write to the trusted slot UNPROMPTED, and the reason is load-bearing, not a limitation of effort: a question sidecar has exactly ONE writable human slot per entry — `**Your answer** (write below this line):` — and the autonomous `advance` apply rung treats whatever sits in that slot as **the human's ratified answer** and acts on it (resolves the item, routes the `disposition`, commits item-body + sidecar atomically). The humility law (stated in `surface-questions` and the `advance-loop` brief) is that the engine applies ONLY human-authored answers and NEVER an invented one. So if the skill writes an UNRATIFIED draft into that slot, it forges the human's signature: the next unattended `advance` run cannot distinguish a machine guess from a human decision and will apply it. A confident wrong triage on a JUDGEMENT question then produces drifted work — exactly the failure the law exists to prevent.

The KEY distinction the maintainer's point (2) sharpens: writing the slot is only forgery when the answer is UNRATIFIED. Once the human says "write P1", P1 IS human-authored — the human ratified it by handle — and transcribing it into the slot is a faithful recording, not an invention. So there are really TWO gaps, not one:

- (gap A) no place to park an UNRATIFIED draft near the question that `advance` provably ignores; and
- (gap B) no sanctioned skill step for "human ratified handle P1 → skill writes P1 into the slot", which needs NO format change at all (the slot already exists; the human's pick is the ratification) and is the more immediately useful of the two.

## Why it matters

- **It is the difference between a transcribe-from-chat workflow and an edit-in-place workflow.** Today clearing a backlog means: read the chat batch, then hand-write each ratified answer into each sidecar. An in-file draft carrier would collapse that to "open the sidecar, move the draft below the line or type your own" — far less friction at the exact moment a human is draining the queue (the skill's whole reason to exist).
- **It is genuinely a PROTOCOL change, not a skill edit.** A draft carrier touches (1) the human-readable sidecar FORMAT (ADR `question-sidecar-human-readable-format`) — a new marker region the serialiser may emit and the parser must recognise; and (2) the `advance` apply rung / `sidecar-apply.ts` semantics — it must treat the draft region as NON-answer (an unratified draft must not satisfy `answered`/`allAnswered`, must not be applied, and must survive or be cleared deterministically when the human writes the real answer). Getting this wrong re-opens the exact forge-the-signature hole the carrier is meant to avoid.
- **`answer-questions` already shaped its output to be ratifiable** (PROPOSE drafts cite evidence and are written AS the answer), so the only missing piece is a safe destination. The skill is doing its half; the format + apply rung are missing the other half.

## Sketch of the fix shapes (not chosen — this is the open question)

For gap A (carrier for UNRATIFIED drafts):
- (a) **Draft-comment region above the answer line.** The skill (or a future apply rung) may write the draft inside an HTML-comment block ABOVE `**Your answer**`, e.g. `<!-- DRAFT (answer-questions, unratified) ... -->`. Accepting = move text below the line (or delete the comment and type your own). The parser must treat the region as inert; `advance` must never read it as an answer. Pro: zero new schema, invisible on GitHub render. Con: "accept" is a manual move, not a one-keystroke ratify.
- (b) **A typed `draft=`/`proposed=` field** in the per-entry identity comment (sibling to `disposition=`), with the draft text in a dedicated marked block. Apply rung renders it, `--accept-drafts` (human-invoked, never autonomous) promotes draft→answer in one pass. Pro: machine-actionable, supports batch "approve P1-P6". Con: more format + a new human-only verb surface.
- (c) **Leave it chat-only (status quo).** Accept that `answer-questions` emits to chat and the human transcribes. Pro: nothing to build, no risk to the apply rung's trust model. Con: the ergonomic gap the maintainer flagged persists.

For gap B (ratify-by-handle → skill writes the accepted answer), which the maintainer actually asked for and which needs NO format change:
- (d) **A sanctioned second phase of `answer-questions` itself.** The skill emits the handle-tagged batch (phase 1, write-nothing); the human replies with the handles they accept; the skill THEN writes ONLY those accepted answers into their `**Your answer**` slots (phase 2), because a handle the human named is human-authored. It still NEVER writes an unaccepted/auto-defaulted answer, never sets `answered:`/`allAnswered`, never `git mv`/commits — those stay with the apply rung / human. Pro: zero format/parser change, lowest risk, delivers the maintainer's exact workflow, and is orthogonal to (a)/(b) (it can ship first and independently). Con: requires the skill to be re-entered with the human's picks (a two-turn interaction), and the skill text must draw the ratified-vs-unratified line crisply so an over-eager run never writes an answer the human did not explicitly name.

## Scope / provenance

- Captured live 2026-06-22 by the maintainer (wighawag) mid-`answer-questions` run, in response to "why not write it in the files."
- The constraint is REAL and verified against the skill's own law and the sidecar/apply contract; this note does NOT pick a fix shape — that is a JUDGEMENT call (ironically, an `answer-questions`-style one) and must not be guessed.
- Cross-ref: the sidecar-keying design question in `needs-attention-may-have-no-human-visible-outcome-after-lock-cutover-surface-as-questions-2026-06-21.md` and `questions-folder-rename-and-kind-axis-prefix-vs-subfolder-2026-06-21.md` — both also touch how much structure the sidecar/apply mechanism should carry; a draft carrier is the same family of decision and may want to land in the same ADR.
- Distinct from any parser nit in `review-nits-question-sidecar-human-readable-format-2026-06-20.md` (those ratify existing parse rules; this ADDS a new region/semantics).

## Open questions to NOT guess

1. **(gap B, cheap, no format change)** Should `answer-questions` gain a sanctioned phase-2 "the human ratified handles P1/D4/… → the skill writes those accepted answers into their `**Your answer**` slots" step (shape (d))? This needs no parser/format change and delivers the maintainer's actual workflow; the only design care is drawing the ratified-vs-unratified line so the skill never writes an answer the human did not explicitly name. (This was hand-applied once on 2026-06-22 as a one-off; the question is whether to make it a standing part of the skill.)
2. **(gap A, load-bearing, format change)** Should the sidecar format + `advance` apply rung ALSO gain a "draft, ignored-until-ratified" carrier so a draft can rest IN the file near the question (and survive across sessions) without the autonomous engine ever mistaking it for a human answer — and if so, which shape (a)/(b)/(c)? This touches the humility law's enforcement surface and is the heavier of the two.

Both surfaced, never auto-decided. (B) can land first and independently of (A).
