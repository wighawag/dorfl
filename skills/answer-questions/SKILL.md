---
name: answer-questions
disable-model-invocation: true
description: 'Human-facing: go over the open question sidecars in work/questions/, RESOLVE the factual ones into draft answers FOR THE HUMAN TO RATIFY, and DEFER the genuine-judgement ones with full context + a suggested default. Proposes; never finalises. The human is the clock.'
---

# answer-questions

**The read-side mirror of `surface-questions`.** `surface-questions` FORMULATES the open questions for an item and writes nothing. `answer-questions` walks the questions that already exist (`work/questions/*.md` sidecars) and, for each, does the cheap legwork to **propose a draft answer the human ratifies** — OR, when the answer is genuine judgement, **defers it to the human with enough context to answer in one pass**. It is the operator's "let's clear the question backlog together" skill.

It is a **user-invoked operator skill** (`disable-model-invocation: true`), human- facing like `review` / `promote` — NOT an autonomous engine rung. This invocation boundary is load-bearing: the autonomous `advance` engine applies ONLY human-authored answers and NEVER invents one (the humility law, stated in the `advance-loop` brief and `surface-questions`). So this skill exists only where a human IS present, and even then it **proposes; it never finalises**. A drafted answer is a candidate the human reads and ratifies (or edits, or rejects) — it is not an answer until the human owns it. Reach for it by name; it never fires on its own.

> **Protocol-native.** Assumes the `work/` contract (rules in the repo's `work/protocol/`, copied by `setup`). Every bare "WORK-CONTRACT" / "sidecar" mention is `work/protocol/WORK-CONTRACT.md` / the question-sidecar format (`docs/adr/question-sidecar-human-readable-format.md`) in the repo under work.

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
4. **Batch the output** (below). You WRITE nothing to the sidecar yourself.

## Your output

Emit, across the open sidecars, a single batch the human can act on in one pass — ordered by leverage (the answer that unblocks the most downstream work first), each tagged PROPOSE or DEFER:

```
question backlog: <N sidecars, M open questions>

PROPOSE (factual — ratify or correct):
  - item: <type>:<slug>  (qN)
    question:   <verbatim>
    draft:      <the proposed answer>
    evidence:   <file:line / ADR / tasks/done record / contract clause that settles it>
    disposition: <only on a triage entry — the proposed allowed value>

DEFER (judgement — needs you):
  - item: <type>:<slug>  (qN)
    question:   <verbatim>
    context:    <inline context to answer without opening the item>
    consequence:<what each plausible answer implies>
    default:    <optional suggested default — humility aid, omit if none>
```

If a sidecar's open questions are ALL judgement, it appears only under DEFER; if all factual, only under PROPOSE. An empty backlog (nothing open) is a valid, honest result — say so; never manufacture a question or an answer to look busy.

## How the answer gets PERSISTED (NOT your job — for orientation)

You draft; the HUMAN owns the write. Once the human ratifies a PROPOSE (or answers a DEFER), the answer is recorded by:

- **The `advance` verb's apply rung** — it applies the HUMAN's answered sidecar atomically (item body + sidecar in one commit) and resolves / re-pauses / dispositions the item. It applies only human-authored answers; a ratified draft is human-authored the moment the human accepts it. (Until the `advance` verb lands, the human hand-writes the answer into the sidecar per the documented format.)
- **Hand-writing the answer** into `work/questions/<type>-<slug>.md` under the entry's `**Your answer** (write below this line):` marker (the human-readable sidecar format, ADR `question-sidecar-human-readable-format.md`). The ratified draft text drops straight in — it is a transcription, because you already shaped it as the answer.

You never write the sidecar, never set `answered:`/`allAnswered`, never `git mv`, never commit. You propose and defer; the human ratifies; the apply rung (or the human's own edit) persists.

## Boundaries (the scope fence)

- **`surface-questions` and `answer-questions` are duals, both write-nothing.** Surface FORMULATES open questions for one item; answer READS the formulated questions and drafts/defers. Neither persists; the engine / `advance` verb / human owns every write. Do not let answer re-formulate (that is surface) or persist (that is apply).
- **Propose, never finalise.** Restated because it is the whole point: you resolve only factual questions, and only into DRAFTS the human ratifies; genuine judgement is DEFERRED with context, never auto-answered. The human is the clock.
- **Compose, don't reimplement.** Use `review` / the item bodies / the ADRs / the contract as the single sources of truth your draft cites; do not re-derive their judgement. You gather evidence and shape it into a ratifiable answer.
