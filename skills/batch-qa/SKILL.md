---
name: batch-qa
description: "Gather every OPEN question across a work/ repo — observations, PRDs, and slices (ideas excluded) — into ONE file the human answers in a single sitting, then apply the answers back, advancing each item exactly one lifecycle step, and iterate. Use when open judgement is scattered across many work/ items and answering one-at-a-time across sessions is the bottleneck; when you want to batch-triage observations and clear needsAnswers in bulk. Composes the review skill (for slice/PRD/code questions) and to-slices (for the ready-PRD→slices step). Writes files into the tree but NEVER commits/moves — the human reviews and commits."
---

# batch-qa

Batch the human-in-the-loop. Instead of processing one slice / one PR / one
question at a time across many sessions, `batch-qa` collects **every open question**
across a `work/` repo into **one file**, the human answers them all in a single
sitting, and the skill **applies the answers back** — advancing each item exactly
**one lifecycle step**, then iterating. The human stays the decision-maker; the
skill removes the serialisation and the per-item context re-establishing.

This is a methodology skill (prose you follow), like `to-slices`/`to-prd`/`review`
— NOT a runner command. It **composes** two existing skills: `review`
(`skills/review/`) for the slice/PRD/code question pass, and `to-slices`
(`skills/to-slices/`) for the ready-PRD→slices step.

## When to use vs. not

- **Use** when open judgement is scattered across many `work/` items and answering
  one-at-a-time is the bottleneck; to batch-triage `observations/`; to clear
  `needsAnswers` on slices/PRDs in bulk; to get a set of items "ready" together.
- **Don't** use it to *build* a slice or *ship* a PRD all the way (it advances each
  item only ONE step — see the invariant), nor as a GATE (it FEEDS the per-item
  gates; it is not one). `ideas/` are left untouched (incubating, no readiness to
  force).

## The loop

### 0. BOUND the batch (self-limiting — no orchestration)

The human describes the scope at invocation in natural language ("just the
observations", "the autoslice PRDs", "everything"). Then:

- **Select from items that are STILL unresolved** — derive the candidate set fresh
  from current item state (slices/PRDs with `needsAnswers: true` or an unanswered
  `## Open questions` block; untriaged observations). **State lives in the items**,
  not in any side-ledger — the work items ARE the ledger. A resolved item naturally
  drops out, so selection is **stateless** and you never read prior batch files.
- **Narrow** to the human's description and **self-limit** to a context-sized chunk
  if the set is still large. Record the studied set in the batch-file header.
- **Scaling = run again on the next subset.** Sequential self-bounding batches; no
  fan-out, no orchestration, no cross-batch state. The next run re-derives "still
  unresolved" and takes the next chunk.

### 1. GATHER (the B→A pass) — produce questions, per scope

Write ONE human-fillable file `work/questions/<date>-batch.md` (header + per-scope
sections + a READINESS footer — see [shape](#the-batch-file)). Each question
carries **inline context + a suggested default**, so the human answers without
opening the source item.

- **slices / PRDs / code → run the `review` skill** (`skills/review/`; compose, do
  NOT reimplement). It EMITS verdicts `{verdict, findings[severity, question,
  context]}` and writes nothing — you ROUTE its `block` findings into the batch
  file (blocking vs non-blocking per the review skill's severity). ALSO collect the
  **pre-existing** questions: `needsAnswers: true` items and their `## Open
  questions` blocks.
- **observations → the triage question is batch-qa-NATIVE** (NOT a `review`
  verdict). An observation has no gate for `review` to assess; its question is
  "what becomes of this signal?": **promote-to-slice / promote-to-ADR / keep-
  watching / delete**.
- **`ideas/` → excluded.** Do not gather them.

### 2. The human answers the one file.

### 3. APPLY (one step per item)

Read the answered file and advance each item exactly **one** lifecycle rung (see
the invariant), per scope:

- **slice / PRD (`needsAnswers: true`) →** merge the answers into the item body and
  **clear `needsAnswers` only where FULLY resolved** (leave it set, with the
  remaining questions, otherwise).
- **observation (promoted) →** draft the produced work: a NEW `work/backlog/<slug>.md`
  stub slice (or a `docs/adr/<slug>.md` stub for promote-to-ADR). Set its
  `needsAnswers: false` ONLY if the human's answer fully specified it; ELSE
  `needsAnswers: true` with the genuine open questions in the body (the usual case
  — an observation rarely contains a full spec). Do NOT do full `to-slices`
  judgement here — produce an honestly-flagged stub. (keep / delete: record for the
  human to action; you do not delete.)
- **PRD already `needsAnswers: false` at run start →** slice it by composing
  `to-slices` → `review` (the ready-PRD rung): run `to-slices` to produce
  `work/backlog/` slices, THEN run `review` on them and route blocks into the batch
  file. The produced slices are `needsAnswers: true` unless the PRD specified them
  crisply enough. This is the **no-lock human path** (autoSlice off, you driving) —
  do not grow a slicing lock; if contention were possible, defer to the locked
  `do prd:` path instead.

### The ONE-STEP invariant

`batch-qa` advances each item **exactly one step, then STOPS** — it never runs an
item all the way to shipped. "Before" is the state **at RUN START**:

| scope | before | one step | after | next verb (NOT batch-qa) |
|---|---|---|---|---|
| observation | untriaged | promote → draft stub | new `backlog/` slice (usually `needsAnswers: true`) | a later batch-qa run |
| slice | `needsAnswers: true` | answer → apply | `needsAnswers: false` | `claim`/`do` builds it |
| PRD | `needsAnswers: true` | answer → apply | `needsAnswers: false` | a later run slices it |
| PRD | `needsAnswers: false` | `to-slices` → `review` | new `backlog/` slices | a later run answers them |

A PRD you *answer* this run lands `needsAnswers: false` and **waits for the NEXT
run** to be sliced (slicing it now would be two rungs). Every step produces an item
in a state batch-qa already advances, so the **loop eats its own output** — the new
items re-enter the stateless pool and later runs advance them. That is why it
converges: each closed batch removes items by resolving them.

### 4. ITERATE + READINESS

Re-run GATHER over THIS batch's bounded set. **Soft-floor stop:** halt when only
**non-blocking** issues remain — still WRITE the non-blocking nits, but they do not
keep the loop alive; the human may choose to keep engaging. Also stop if the human
stops answering. **Never re-ask a resolved question.** Emit a READINESS footer:
READY (now passes its gate) / OPEN (blocking remains) / NON-BLOCKING-ONLY (human's
call to continue). Non-blocking-only items are skipped by default in later runs
(re-includable via the footer) — no cross-run nit treadmill.

The batch file is **ephemeral**: once APPLY has merged its answers, its content is
redundant and it may be deleted (git history is the archive).

## The batch file

```
work/questions/<date>-batch.md

# BATCH <date> — studying: <slug>, <slug>, …   (the items in THIS batch; ephemeral)

## OBSERVATIONS (triage — batch-qa-native, not review)
### <slug>  [observation]
  context: <the spotted signal, inline>
  Q: still real? disposition? → [promote-slice | promote-adr | keep | delete]
  > ANSWER:

## PRDS (slice-readiness)
### <slug>  [prd · needsAnswers: <yes/no>]
  Q (review-surfaced or pre-existing): <question>   [suggested default: …]
  > ANSWER:

## SLICES (build-readiness)
### <slug>  [slice · needsAnswers: true — BLOCKING]
  context: <the ## Open questions block, inline>
  Q1: <question>   [suggested default: …]
  > ANSWER:
  #### non-blocking nits (recorded; do NOT block readiness)
  N1: …

## READINESS (<date>, round <n>)
  READY: <slugs that now pass their gate>
  OPEN (blocking): <slugs still needing answers>
  NON-BLOCKING ONLY: <slugs with only nits left — human's call to continue>
```

## Boundaries (state these; they keep the tool honest)

- **It FEEDS the per-item gates — it is NOT a gate.** The existing gate model
  (`review`, `needsAnswers`, the autoslice gate) is per-item, binary, and lets the
  *agent* proceed without a human. `batch-qa` is cross-scope and human-batching: it
  lets the *human* clear judgement in bulk, so the items then pass their own gates.
  Do not mistake it for a gate.
- **It NEVER commits / deletes / moves / pushes.** It writes the batch file and
  applies edits/drafts into the working tree, and REPORTS the paths — the human
  reviews and commits (repo git etiquette, like `to-prd`/`to-slices`). "Delete" an
  observation = recommend it; the human deletes.
- **review composes ON TOP of `to-slices`** (you run review as a separate step
  after slicing) — you do NOT modify `to-slices`. `to-slices` stays a pure
  producer; you mix in review by choice.
- **Honest `needsAnswers`.** An emitted stub or a partially-answered item keeps
  `needsAnswers: true` with the real open questions in its body. Never emit an
  under-specified item as if it were ready (the same humility check `to-slices`
  and `review` use).
