---
name: surface-questions
description: "GATHER the open-judgement residue for ONE work/ item and EMIT questions; write NOTHING (doc-shaped, mirrors review). Compose review (task/brief/code) plus the native observation-triage question (promote/keep/delete) plus the item's pre-existing needsAnswers / ## Open questions, each emitted question carrying inline context plus an optional suggested default, in the sidecar entry shape the advance engine persists with zero translation. Use as the advance engine's surface-question rung (spawned fresh-context, the engine writes the sidecar CAS-atomically), or human-invoked for the no-runner path. The humility rule: surface the residue, NEVER invent an answer. Composes review/to-task UNCHANGED; the INVERSE of applying answers."
---

# surface-questions

A **standalone question-formulation discipline** that, for ONE `work/` item, GATHERS every piece of open judgement it carries and **EMITS the questions** — and **writes nothing**. It is the JUDGEMENT half of the retired `batch-qa`, extracted into a fresh skill so that an **engine-loaded** agent and a **human-invoked** agent formulate questions identically — one question/answer contract.

It is **doc-shaped, exactly like `review`** (`skills/review/`): you produce an assessment (here, a set of questions) and the **caller routes/persists it**. You never set `needsAnswers`, never write a sidecar, never `git mv`, never commit. The advance engine's surface-question rung spawns you fresh-context, takes your questions, and **ITSELF writes the sidecar (CAS-atomic)** — exactly as the review gate uses `review`. **The skill judges; the engine persists.**

> **Protocol-native.** This skill assumes the `work/` contract (the rules live in the repo's **`work/protocol/`**, copied there by `setup`). It reviews/triages an item AGAINST those rules. Every bare "WORK-CONTRACT" mention below is `work/protocol/WORK-CONTRACT.md` in the repo under work.

## The two laws (state them; they keep the tool honest)

1. **GATHER-only.** Your job is to FORMULATE the open questions for the item — by composing the existing reviewing/triage judgement, not by re-deriving it. You add no new disposition of the item.
2. **PERSIST-NEVER.** You EMIT questions and **write nothing** (no `needsAnswers` edit, no sidecar, no `git mv`, no commit) — mirroring `review`. The caller (the advance engine, or a human) routes and persists. If you are tempted to write a file, STOP: that is the engine's job (or, by hand, the `advance` verb — see [the no-runner path](#the-no-runner-path-us-34)).

**The humility rule (the heart of it):** you **surface the residue, you NEVER invent an answer.** A `default:` is a _suggested_ default offered for the human's convenience — it is a humility aid, not a decision, and it never substitutes for the human answering. Automating answer creation is REJECTED by design in the `advance-loop` brief; the human is the clock. When judgement is genuinely open, that is a QUESTION — never a guess dressed as a resolution.

## When to use vs. not

- **Use** to formulate the open questions for ONE item before it can advance a lifecycle rung — a task or brief that may carry open judgement, an untriaged observation, code in a work PR — whether you are the advance engine's surface rung or a human doing it by hand with no runner.
- **Don't** use it to PRODUCE an item (that is `to-brief` / `to-task` / the build agent), to APPLY a human's answer or advance the item (that is the engine's apply rung / the `advance` verb), or to PERSIST the questions (the engine, or the `advance` verb, owns the write). And do not use it to invent answers — there is no answer-creation here, by design.

## What you COMPOSE (single sources — do NOT duplicate)

You are a GATHERER. You stand up the existing producers/reviewers and collect what they emit; you do not reimplement their judgement. `to-task` and `review` stay the single sources, **composed and UNCHANGED** — only `batch-qa`'s orchestration is absorbed (by the advance engine), not its composed skills.

1. **`review` (`skills/review/`) — for a task / brief / code.** Run the `review` skill; it EMITS a verdict `{verdict, findings:[{severity, question, context}]}` and writes nothing. ROUTE its **`block`** findings into your emitted questions (a blocking finding is an open question that must be answered before the item advances). A non-blocking finding is a nit — record it as an optional/low-priority question, never as a blocker. Do NOT re-derive review's lenses here; you call review and carry its findings over.
2. **The native observation-triage question — for an observation.** An observation has no gate for `review` to assess; its question is **"what becomes of this signal?"** Emit a single triage question whose answer is a `disposition` (see [the disposition vocabulary](#the-emitted-question-shape-must-match-the-sidecar)). This judgement is NATIVE to this skill (carried over from `batch-qa`) — investigate the observation's claim against current reality (code / tasks / briefs / ADRs) so the inline context and the suggested default are honest, exactly as the triage discipline demands.
3. **The item's PRE-EXISTING open questions.** Collect what the item already carries: a `needsAnswers: true` item's `## Open questions` block, and any open question already written in the body. Carry each over verbatim as an emitted question (with its context). These are open judgement the author already named — they must surface, not be silently dropped.

For each gathered question, attach **inline CONTEXT** (the relevant excerpt / `file:line` / the reasoning — so the human need not open the source item) and, where you can honestly suggest one, an **optional suggested DEFAULT** (the humility aid — never a decision).

## The emitted question shape (MUST match the sidecar)

The questions you emit MUST match the **sidecar entry fields** from the `advance-sidecar-contract` task (`work/tasks/done/advance-sidecar-contract.md`), so the engine persists them with **zero translation**. Emit each question as this shape (the field names are the sidecar's):

```
question:       <the question, verbatim>
context:        <inline context so the human need not open the item>
default:        <optional suggested default — the humility aid; omit if none>
disposition:    <optional — ONLY on a triage/terminal-routing question; the
                 set of allowed answers, see below>
```

- **`question` / `context` / `default`** map 1:1 onto the sidecar entry. `default` is optional (omit when you cannot honestly suggest one — never fabricate a default just to fill the field).
- **`disposition` is present ONLY on a triage / terminal-routing question** (the observation case, or any question whose answer routes the item to a terminal state). Its allowed values are exactly the sidecar's (these are the live code constants the engine parses — carry them VERBATIM so the engine needs zero translation): **`promote-slice` | `promote-adr` | `keep` | `delete` | `dropped` | `needs-attention`**. `dropped` is the GENERIC "won't-proceed" terminal (the runner routes a dropped item to its regime's terminal — `tasks/cancelled/` for a task, `briefs/dropped/` for a brief; the specific REASON — `out-of-scope` / `superseded by <x>` / `duplicate` / `abandoned` — lives in the item body as `reason:`, NOT in the disposition). A plain task/brief answer-question carries NO `disposition`.
- **You do NOT assign ids, `answered:`, `answer:`, or `allAnswered`.** Those are the SIDECAR's machine-owned fields — the engine assigns the stable monotonic id (`q1`, `q2`, …), the human fills `answer:`, and the serialiser derives `answered:`/`allAnswered`. You emit only the four authoring fields above; the engine owns the rest. (This is precisely why you must not write the sidecar: you do not own its machine fields.)

Because the shape is the sidecar's, the engine APPENDS your questions to any existing sidecar (never overwriting an already-answered entry) and writes the whole thing in one CAS-atomic commit. You need not know any of that — you just emit the four fields.

## Your output

Emit, for the item, an ordered list of questions in the shape above — and **write nothing**. Mirror `review`'s output stance exactly: an assessment the caller routes.

```
item: <type>:<slug>                # the namespaced identity (orientation; the resolver owns it)
questions:
  - question:    <…>
    context:     <…>
    default:     <… or omitted>
    # (no disposition — a task/brief answer-question)
  - question:    <… the observation triage question …>
    context:     <…>
    default:     <… e.g. the suggested disposition …>
    disposition: promote-slice | promote-adr | keep | delete | dropped | needs-attention
```

If the item carries **no open judgement** (review approves with no blocking findings, the observation has an obvious conservative disposition the repo's auto-triage bar covers, nothing pre-existing) — emit an **empty question set** and say so. Surfacing nothing is a valid, honest result; do not manufacture a question to look busy.

### How the caller persists your questions (NOT your job — for orientation only)

- **The advance engine's surface-question rung** spawns you fresh-context, takes your emitted questions, and writes them to the sidecar `work/questions/<type>-<slug>.md` CAS-atomically (assigning ids, appending, setting `needsAnswers: true`). The skill judges; the engine persists.
- **A human (no runner)** persists via the `advance` verb (see below), or hand-writes the documented sidecar format.

## The no-runner path (US #34)

You stay **human-invokable**. A human with no runner can invoke this skill by hand, take the emitted questions, and persist them one of two ways:

- **Persist via the `advance` verb** — the apply/surface rung of the `advance` command (a **sibling top-level verb**, like `do` and `run`). It is `advance`, **NOT `do advance`** — `advance` is its own verb, and `do` subcommands are REJECTED in the `advance-loop` brief. (The `advance` verb is built in a later task; until it lands, use the hand-written path below.)
- **Hand-write the documented sidecar format** — write `work/questions/<type>-<slug>.md` by hand per the human-readable Markdown shape below (defined by ADR `docs/adr/question-sidecar-human-readable-format.md`). Because the emitted shape already matches the sidecar entry, this is a transcription, not a translation.

The hand-written sidecar shape (the SAME file is both human-readable on GitHub and machine-parseable — the machine fields hide in HTML comments that GitHub renders as nothing, the human content is real Markdown):

```
<!-- agent-runner-sidecar: item=<type>:<slug> type=<type> slug=<slug> allAnswered=false -->

## Q1

**<the question, verbatim>**

> <inline context so the human need not open the item>

_Suggested default: <optional default; omit the whole line if none>_

<!-- q1 fields: id=q1 disposition=<optional — triage entries only> -->

**Your answer** (write below this line):

## Q2

**<next question…>**

…
```

Notes for the hand-writer:

- The **identity HTML comment** at the top carries `item`/`type`/`slug` and the derived `allAnswered` mirror. Set `allAnswered=false` on first write (no answers yet); the engine recomputes it on every subsequent serialise.
- Each entry opens with a `## Qn` heading (`Q1`, `Q2`, …, monotonic — never reused). The heading is BOTH the entry separator and the answer-region boundary.
- The **question is a bold line**, the **context is a Markdown blockquote** (each line prefixed `> `), the **default is one italic line** prefixed `_Suggested default: ` and closed with `_`. Omit context/default lines entirely when absent.
- The **per-entry HTML comment** carries `id=qN` and, on a triage entry only, `disposition=<value>`. Do NOT add an `answered=` field — the engine derives answered-ness from the answer text and only emits the override when it disagrees with that derivation.
- The fixed marker `**Your answer** (write below this line):` is followed by an empty region; the answer is everything from the marker up to the next `## ` heading (heading-delimited so a `---` inside an answer cannot break parsing).
- The human just types prose under the answer marker — no `key:`, no escaping, no fence.

**No separate write-skill is added.** Hand-writing the sidecar (or the `advance` verb) is enough; a dedicated `record-questions` write-skill is DEFERRED in the brief unless hand-writing proves annoying. Do not invent one here.

## Boundaries (the scope fence)

- **`to-task` / `review` stay COMPOSED and UNCHANGED (US #35).** You call them; you never modify or reimplement them. They are the single sources for slicing/reviewing judgement — only `batch-qa`'s orchestration is absorbed (by the engine), not the producer/reviewer skills.
- **You absorb only `batch-qa`'s question-FORMULATION judgement** (the composed review + native triage + pre-existing-question gather, with inline context + suggested defaults). `batch-qa`'s BOUND / APPLY / ITERATE / one-file orchestration is the ENGINE's job now (or `orchestrate`'s, for the human batch) — NOT yours. You formulate the questions for ONE item; you do not batch, apply, or iterate.
- **You write nothing and you invent no answer.** Both laws, restated because they are the whole point: GATHER-only, PERSIST-NEVER; surface the residue, NEVER invent an answer.
