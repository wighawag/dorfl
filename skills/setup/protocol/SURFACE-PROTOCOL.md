# SURFACE-PROTOCOL

The **surface-questions discipline** the autonomous runner invokes by name on ONE `work/` item before that item can advance a lifecycle rung. The runner spawns a fresh-context agent and tells it to "run the surface protocol"; that agent reads THIS doc and applies its standard.

The protocol describes how work is AUTHORED (`WORK-CONTRACT.md`, the templates), CLAIMED and BUILT (`CLAIM-PROTOCOL.md`, the `verify` floor), JUDGED BEFORE LANDING (`REVIEW-PROTOCOL.md`) and — when judgement is genuinely open — has its OPEN QUESTIONS SURFACED for a human to answer (this doc). It is in-band in every set-up repo, never host-specific. (The human-facing pointer is `skills/surface-questions/SKILL.md`; the standard lives here.)

> This doc is **protocol-native**: it assumes the repo uses the `work/` contract and surfaces the open-judgement residue of an item AGAINST that contract. Every bare "WORK-CONTRACT" / "REVIEW-PROTOCOL" mention below refers to `work/protocol/<doc>` in the repo under work.

It is **doc-shaped, exactly like `review`**: you produce an assessment (here, a set of questions) and the **caller routes/persists it**. You never set `needsAnswers`, never write a sidecar, never `git mv`, never commit. The advance engine's surface-question rung spawns you fresh-context, takes your questions, and **ITSELF writes the sidecar (CAS-atomic)** — exactly as the review gate uses `review`. **The skill judges; the engine persists.**

## The two laws (state them; they keep the tool honest)

1. **GATHER-only.** Your job is to FORMULATE the open questions for the item — by composing the existing reviewing/triage judgement, not by re-deriving it. You add no new disposition of the item.
2. **PERSIST-NEVER.** You EMIT questions and **write nothing** (no `needsAnswers` edit, no sidecar, no `git mv`, no commit) — mirroring `review`. The caller (the advance engine, or a human) routes and persists. If you are tempted to write a file, STOP: that is the engine's job (or, by hand, the `advance` verb — see [the no-runner path](#the-no-runner-path)).

**The humility rule (the heart of it):** you **surface the residue, you NEVER invent an answer.** A `default:` is a _suggested_ default offered for the human's convenience — it is a humility aid, not a decision, and it never substitutes for the human answering. Automating answer creation is rejected by design; the human is the clock. When judgement is genuinely open, that is a QUESTION — never a guess dressed as a resolution.

## When to use vs. not

- **Use** to formulate the open questions for ONE item before it can advance a lifecycle rung — a task or prd that may carry open judgement, an untriaged observation, code in a work PR — whether you are the advance engine's surface rung or a human doing it by hand with no runner.
- **Don't** use it to PRODUCE an item (that is `to-prd` / `to-task` / the build agent), to APPLY a human's answer or advance the item (that is the engine's apply rung / the `advance` verb), or to PERSIST the questions (the engine, or the `advance` verb, owns the write). And do not use it to invent answers — there is no answer-creation here, by design.

## What you COMPOSE (single sources — do NOT duplicate)

You are a GATHERER. You stand up the existing producers/reviewers and collect what they emit; you do not reimplement their judgement. `to-task` and `review` stay the single sources, **composed and UNCHANGED**.

1. **`review` (`work/protocol/REVIEW-PROTOCOL.md`) — for a task / prd / code.** Run the `review` discipline; it EMITS a verdict `{verdict, findings:[{severity, question, context}]}` and writes nothing. ROUTE its **`block`** findings into your emitted questions (a blocking finding is an open question that must be answered before the item advances). A non-blocking finding is a nit — record it as an optional/low-priority question, never as a blocker. Do NOT re-derive review's lenses here; you call review and carry its findings over.
2. **The native observation-triage question — for an observation.** An observation has no gate for `review` to assess; its question is **"what becomes of this signal?"** Emit a single triage question whose answer is a `disposition` (see [the emitted question shape](#the-emitted-question-shape-must-match-the-sidecar)). This judgement is NATIVE to this skill — investigate the observation's claim against current reality (code / tasks / prds / ADRs) so the inline context and the suggested default are honest, exactly as the triage discipline demands.
3. **The item's PRE-EXISTING open questions.** Collect what the item already carries: a `needsAnswers: true` item's `## Open questions` block, and any open question already written in the body. Carry each over verbatim as an emitted question (with its context). These are open judgement the author already named — they must surface, not be silently dropped.

For each gathered question, attach **inline CONTEXT** (the relevant excerpt / `file:line` / the reasoning — so the human need not open the source item) and, where you can honestly suggest one, an **optional suggested DEFAULT** (the humility aid — never a decision).

## The emitted question shape (MUST match the sidecar)

The questions you emit MUST match the **sidecar entry fields**, so the engine persists them with **zero translation**. The runtime PARSER (`parseSurfaceEmit`) is the source of truth for the shape; this prose mirrors what it enforces.

Emit a single JSON object of this exact shape (no prose OUTSIDE it):

```json
{
	"item": "<type>:<slug>",
	"questions": [
		{
			"question": "…",
			"context": "…",
			"default": "… (optional; omit if none)",
			"disposition": "promote-task|promote-adr|keep|delete|dropped|needs-attention (ONLY on a triage question; omit otherwise)"
		}
	]
}
```

- **`item`** — OPTIONAL, the namespaced identity the surface is for (orientation only; the resolver owns identity — the parser tolerates absence).
- **`questions`** — REQUIRED, an ORDERED array. An EMPTY array is VALID — the honest "no open judgement" result; absence is NOT (the parser rejects it, never a silent surface). Each entry is:
  - **`question`** — REQUIRED, the question verbatim. An all-whitespace question is dropped as a placeholder.
  - **`context`** — OPTIONAL, inline context so the human need not open the item (the relevant excerpt / `file:line` / reasoning).
  - **`default`** — OPTIONAL, the suggested default — the humility aid; omit when you cannot honestly suggest one (never fabricate a default just to fill the field).
  - **`disposition`** — OPTIONAL, present ONLY on a triage / terminal-routing question (the observation case, or any question whose answer routes the item to a terminal state). Its allowed values are exactly the sidecar's (the live code constants the engine parses — carry them VERBATIM so the engine needs zero translation): **`promote-task` | `promote-adr` | `keep` | `delete` | `dropped` | `needs-attention`**. `dropped` is the GENERIC "won't-proceed" terminal (the runner routes a dropped item to its regime's terminal — `tasks/cancelled/` for a task, `prds/dropped/` for a prd; the specific REASON — `out-of-scope` / `superseded by <x>` / `duplicate` / `abandoned` — lives in the item body as `reason:`, NOT in the disposition). A plain task/prd answer-question carries NO `disposition`. An unrecognised disposition is dropped by the parser.

You do NOT assign ids, `answered:`, `answer:`, or `allAnswered`. Those are the SIDECAR's machine-owned fields — the engine assigns the stable monotonic id (`q1`, `q2`, …), the human fills `answer:`, and the serialiser derives `answered:`/`allAnswered`. You emit only the four authoring fields above; the engine owns the rest. (This is precisely why you must not write the sidecar: you do not own its machine fields.)

Because the shape is the sidecar's, the engine APPENDS your questions to any existing sidecar (never overwriting an already-answered entry) and writes the whole thing in one CAS-atomic commit. You need not know any of that — you just emit the four fields.

If the item carries **no open judgement** (review approves with no blocking findings, the observation has an obvious conservative disposition the repo's auto-triage bar covers, nothing pre-existing) — emit an **empty `questions` array** and say so. Surfacing nothing is a valid, honest result; do not manufacture a question to look busy.

### How the caller persists your questions (NOT your job — for orientation only)

- **The advance engine's surface-question rung** spawns you fresh-context, takes your emitted questions, and writes them to the sidecar `work/questions/<type>-<slug>.md` CAS-atomically (assigning ids, appending, setting `needsAnswers: true`). The skill judges; the engine persists.
- **A human (no runner)** persists via the `advance` verb (see below), or hand-writes the documented sidecar format.

## The no-runner path

You stay **human-invokable**. A human with no runner can invoke this discipline by hand, take the emitted questions, and persist them one of two ways:

- **Persist via the `advance` verb** — the apply/surface rung of the `advance` command (a **sibling top-level verb**, like `do` and `run`). It is `advance`, **NOT `do advance`** — `advance` is its own verb.
- **Hand-write the documented sidecar format** — write `work/questions/<type>-<slug>.md` by hand per the human-readable Markdown shape below. Because the emitted shape already matches the sidecar entry, this is a transcription, not a translation.

The hand-written sidecar shape (the SAME file is both human-readable on GitHub and machine-parseable — the machine fields hide in HTML comments that GitHub renders as nothing, the human content is real Markdown):

```
<!-- dorfl-sidecar: item=<type>:<slug> type=<type> slug=<slug> allAnswered=false -->

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

**No separate write-skill is added.** Hand-writing the sidecar (or the `advance` verb) is enough. Do not invent one here.

## Boundaries (the scope fence)

- **`to-task` / `review` stay COMPOSED and UNCHANGED.** You call them; you never modify or reimplement them. They are the single sources for tasking/reviewing judgement.
- **You formulate the questions for ONE item; you do not batch, apply, or iterate.** Batching, applying answers, and iterating are the ENGINE's job (or `orchestrate`'s, for the human batch) — NOT yours.
- **You write nothing and you invent no answer.** Both laws, restated because they are the whole point: GATHER-only, PERSIST-NEVER; surface the residue, NEVER invent an answer.
