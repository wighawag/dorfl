---
name: answer-questions
disable-model-invocation: true
description: 'Human-facing: go over the open question sidecars in work/questions/, RESOLVE the factual ones into draft answers FOR THE HUMAN TO RATIFY, and DEFER the genuine-judgement ones with full context + a suggested default. Proposes; never finalises. The human is the clock.'
---

# answer-questions

**The read-side mirror of `surface-questions`.** `surface-questions` FORMULATES the open questions for an item and writes nothing. `answer-questions` walks the questions that already exist (`work/questions/*.md` sidecars) and, for each, does the cheap legwork to **propose a draft answer the human ratifies** — OR, when the answer is genuine judgement, **defers it to the human with enough context to answer in one pass**. It is the operator's "let's clear the question backlog together" skill.

It is a **user-invoked operator skill** (`disable-model-invocation: true`), human-facing like `review` / `promote` — NOT an autonomous engine rung. This invocation boundary is load-bearing: the autonomous `advance` engine applies ONLY human-authored answers and NEVER invents one (the humility law, shared with `surface-questions`). So this skill exists only where a human IS present, and even then it **proposes; it never finalises**. A drafted answer is a candidate the human reads and ratifies (or edits, or rejects) — it is not an answer until the human owns it. Reach for it by name; it never fires on its own.

> **Protocol-native.** Assumes the `work/` contract (rules in the repo's `work/protocol/`, copied by `setup`). Every bare "WORK-CONTRACT" / "sidecar" mention is `work/protocol/WORK-CONTRACT.md` / the documented question-sidecar format in the repo under work.

## The one law (it keeps the tool honest)

**Propose, never finalise — the human is the clock.** You may RESOLVE a question only when the answer is **factual / discoverable** (settled in the code, an ADR, the contract, a `tasks/done/` record, or external truth) — and even then you present it as a DRAFT for the human to ratify, never as a committed answer. The moment a question turns on **preference, product/design/security judgement, or an unresolved fork**, you do NOT answer it — you DEFER it with context and an optional suggested default (the humility aid, never a decision). When in doubt between "factual" and "judgement", treat it as judgement and defer. A confident wrong answer to a judgement question produces drifted work that costs far more than asking.

## When to use vs. not

- **Use** when there is a populated `work/questions/` and a human present who wants to clear it: to go question-by-question, knock out the ones whose answers are just legwork (drafted for ratification), and hand the human a tight batch of the ones that genuinely need them. Compose it from `orchestrate`'s apply step, or invoke it directly to drain the question backlog.
- **Don't** use it to FORMULATE questions (that is `surface-questions`), to PERSIST / commit an answer or advance the item (that is the `advance` verb's apply rung, or the human writing the answer into the sidecar), or to invent an answer to a judgement question (the law forbids it). It READS sidecars and DRAFTS; it does not own the write.

## How to use

For each open sidecar in `work/questions/` (each `<type>-<slug>.md` with an unanswered entry), per question:

1. **Read the question + its context** from the sidecar (the bold question, the blockquote context, any suggested default, and the `disposition=` set on a triage entry). Open the item it asks about (`<type>:<slug>`) only if the inline context is not enough.
2. **Classify factual vs judgement** — do the cheap legwork to decide:
   - **FACTUAL / resolvable** — the answer is settled somewhere checkable: a landed `tasks/done/` record, an ADR in `docs/adr/`, a `work/protocol/` rule, the current code, or external/world fact. Investigate it against current reality (the same honesty `surface-questions`/triage demand) so the draft is grounded, not guessed.
   - **JUDGEMENT** — the answer turns on preference, a design/product/security call, a `humanOnly` concern, or an open fork the evidence does not settle.
3. **Act on the classification:**
   - **FACTUAL → PROPOSE a draft answer.** State the answer, and cite the EVIDENCE (the `file:line` / ADR / done-record / contract clause that settles it) so the human can ratify in seconds rather than re-investigate. For a triage question, the draft answer is one of the entry's allowed `disposition` values, with the evidence for that routing. Mark it clearly as a DRAFT awaiting ratification.
   - **JUDGEMENT → DEFER.** Surface the question with: inline context (so the human need not open the item), the consequence of each plausible answer, and an **optional suggested default** where you honestly have a view (the humility aid — never a decision). Do NOT draft a committed answer.
4. **Batch the output** (below). In phase 1 you WRITE nothing to the sidecar. You write a `**Your answer**` slot ONLY in the optional phase 2, and ONLY for the handles the human explicitly ratified (see "Phase 2" below).

## Your output

Emit, across the open sidecars, a single batch the human can act on in one pass — ordered by leverage (the answer that unblocks the most downstream work first), each tagged PROPOSE or DEFER. Give every entry a **batch-stable handle** (`P1`, `P2`, … for PROPOSE; `D1`, `D2`, … for DEFER), numbered across the WHOLE batch independent of which sidecar it came from, so the human can approve / reject / amend by number in one line (e.g. "approve P1-P6, D3; amend D9 (...); reject D14") instead of re-quoting `<type>:<slug> (qN)`. Keep the `item:`/`(qN)` line too — the handle is for acting, the item id is for locating where the answer persists:

```
question backlog: <N sidecars, M open questions>

PROPOSE (factual — ratify or correct):
  - P1  item: <type>:<slug>  (qN)
    question:   <verbatim>
    draft:      <the proposed answer>
    evidence:   <file:line / ADR / tasks/done record / contract clause that settles it>
    disposition: <only on a triage entry — the proposed allowed value>

DEFER (judgement — needs you):
  - D1  item: <type>:<slug>  (qN)
    question:   <verbatim>
    context:    <inline context to answer without opening the item>
    consequence:<what each plausible answer implies>
    default:    <optional suggested default — humility aid, omit if none>
```

The verbatim `question:` (and, for DEFER, the `context:`) is MANDATORY on every entry — it is the whole point of the batch: the human must be able to DECIDE from the batch alone, without opening each file. A compact TABLE keyed on the same `P#`/`D#` handles is fine for a large batch ONLY IF every row still carries the verbatim question + (for DEFER) context + item id + draft/default + (for PROPOSE) evidence. If that does not fit a table row, use the block form — do NOT drop the question to make it fit. A batch that elides the question forces a manual file lookup to decide and has failed at its job. Where several entries collapse to ONE decision (e.g. a recurring pattern across many sidecars), give the cluster a single handle and list the items it covers, so the human spends one ratification, not N.

If a sidecar's open questions are ALL judgement, it appears only under DEFER; if all factual, only under PROPOSE. An empty backlog (nothing open) is a valid, honest result — say so; never manufacture a question or an answer to look busy.

### Phase 2 (OPTIONAL, human-initiated): ratify-by-handle, then the skill writes the accepted answers

The batch above is phase 1 and writes NOTHING. If — and only if — the human replies naming the handles they accept (e.g. "write P1-P6, D4, D9" or "accept P3, amend D9 to <text>"), you MAY enter phase 2 and write THOSE answers into their `**Your answer** (write below this line):` slots. This is NOT a violation of "propose, never finalise": a handle the human explicitly named is HUMAN-AUTHORED — the human ratified it by naming it — so transcribing it into the slot is a faithful recording, not an invention. The ironclad rules for phase 2:

- **Write ONLY handles the human explicitly named.** Never write an un-named entry, never "helpfully" fill the rest, never write a DEFER's suggested `default:` unless the human named that handle. An entry the human left out stays blank.
- **Amendments are the human's text, verbatim.** If the human says "accept D9 but change X", write their amended text, not your original draft.
- **For a triage entry, write the answer the human ratified** (the disposition + any prose). Match the sidecar's documented `**Your answer**` format exactly.
- **Still NEVER** set `answered:`/`allAnswered`, never `git mv`, never commit, never touch the per-entry/identity machine comments. You write ONLY the prose under the `**Your answer**` marker; the apply rung (or the human) owns everything else (see below).
- **If the human's reply is ambiguous about a handle, do not write it — ask.** A wrong transcription into the trusted slot is the exact forgery the law forbids; when unsure, leave it blank and surface the ambiguity.

> **Why phase 1 goes to the human and never auto-writes the slot.** The only writable human slot per entry (`**Your answer** (write below this line):`) is the one the `advance` apply rung trusts as the human's ratified answer; writing an UNRATIFIED draft there forges the human's signature and an unattended `advance` would apply the guess (the humility law forbids exactly this). So phase 1 emits to the human and writes nothing; phase 2 writes ONLY what the human ratified by handle. There is no sanctioned "draft, ignored-until-ratified" CARRIER in the sidecar (a draft cannot rest in the file across sessions without risking that mistake), so a parked, browsable in-file draft is out of scope for this skill.

## How the answer gets PERSISTED (NOT your job — for orientation)

You draft; the HUMAN owns the write. Once the human ratifies a PROPOSE (or answers a DEFER), the answer is recorded by:

- **The `advance` verb's apply rung** — it applies the HUMAN's answered sidecar atomically (item body + sidecar in one commit) and resolves / re-pauses / dispositions the item. It applies only human-authored answers; a ratified draft is human-authored the moment the human accepts it. (A human with no runner hand-writes the answer into the sidecar per the documented format.)
- **Hand-writing the answer** into `work/questions/<type>-<slug>.md` under the entry's `**Your answer** (write below this line):` marker (the documented human-readable sidecar format). The ratified draft text drops straight in — it is a transcription, because you already shaped it as the answer.

Your ONLY write is the optional phase-2 transcription: dropping the HUMAN-RATIFIED answer text under the `**Your answer**` marker for the handles the human explicitly named. Beyond that you never set `answered:`/`allAnswered`, never touch machine comments, never `git mv`, never commit. You propose and defer; the human ratifies (and may name handles for you to transcribe); the apply rung (or the human's own edit) does the rest — reads the answered slot, sets `answered:`/`allAnswered`, dispositions, and commits.

## Boundaries (the scope fence)

- **`surface-questions` and `answer-questions` are duals.** Surface FORMULATES open questions for one item and writes nothing; answer READS the formulated questions and drafts/defers (phase 1, write-nothing) and, ONLY on explicit human ratification, transcribes the named answers into their slots (phase 2). Neither FORMULATES nor APPLIES: do not let answer re-formulate (that is surface) or set `answered:`/disposition/commit (that is apply). Phase-2 transcription writes the answer PROSE only; it is not "persisting" in the apply sense.
- **Propose, never finalise.** Restated because it is the whole point: you resolve only factual questions, and only into DRAFTS the human ratifies; genuine judgement is DEFERRED with context, never auto-answered. You write a slot ONLY for a handle the human explicitly named (that text is then human-authored); you NEVER write an un-named entry or your own suggested default into a slot. The human is the clock.
- **Compose, don't reimplement.** Use `review` / the item bodies / the ADRs / the contract as the single sources of truth your draft cites; do not re-derive their judgement. You gather evidence and shape it into a ratifiable answer.
