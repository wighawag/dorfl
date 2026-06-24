---
title: Agentic question-resolution — retire the disposition vocabulary, generalize the decision engine
slug: agentic-question-resolution-retire-disposition-vocabulary
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/tasks/ready/` tasks. (The technical-detail sections below are trimmed by `to-task` once the work is tasked — they move into tasks/ADRs and this prd settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

The question-resolution system uses a hard-coded **disposition vocabulary** —
`promote-task | promote-prd | promote-adr | keep | delete | dropped |
needs-attention` — carried as a `disposition=` field in the sidecar's per-entry
HTML comment. This has accreted into several coherence problems (surfaced while
draining the question backlog, 2026-06-24):

- **The engine acts on a TOKEN the human never sees, not the human's words.** The
  `disposition=` field is the SURFACE AGENT's suggested default; the human answers
  in natural-language prose under `**Your answer**`. The apply rung reads the
  `disposition=` field (`sidecar.ts` parses it from the HTML comment), NOT the
  prose. So a human who writes "yeah just drop it" while the field still says
  `disposition=promote-task` gets the WRONG action. There is no natural-language
  understanding of the human's answer.
- **`keep` is mis-named and is a resting-state contradiction.** To a human, `keep`
  reads as "leave the question unanswered / not-yet-decided"; it actually means
  "retain the observation as a settled signal + stamp `triaged:keep` + stop
  asking" — which leaves a "resolved" note resting in the inbox, the exact state
  WORK-CONTRACT.md L67 calls a contradiction.
- **`needs-attention` as a triage ANSWER is redundant.** "Escalate to a human" is
  circular when a human is already answering the question. (The `needs-attention/`
  LIFECYCLE state — a bounced build, a stuck lock — is a SEPARATE concern and is
  NOT in scope.)
- **`delete` vs `dropped` is a subtle type-split** (`dropped` = work-item terminal
  folder; `delete` = note removal; observation `dropped` auto-downgrades to
  `delete`), and the vocabulary forces a most-decisive-disposition PICKER
  (`apply-persist.ts`) to arbitrate when a human "spread dispositions across
  entries" — complexity that exists only because disposition is per-ENTRY when it
  is conceptually per-ITEM.
- **No orphan-sidecar GC.** A sidecar's lifecycle is coupled to its item only on
  the resolve path; if a human deletes an observation out-of-band (notes leave by
  deletion, per the contract), its question sidecar is orphaned and never reaped.

The deeper observation: these are not really distinct "dispositions" — they are
just **what an agent decides to DO with an answered question**, which is exactly
the shape `intake` already has (read input → emit a typed verdict → dispatch).

## Solution

From the operator's perspective: I answer a question in my own words; I never
learn or type a vocabulary. The system READS my answer (together with the source
item it is about) and acts on it — turning the signal into a task, a PRD, or an
ADR; deleting it if that's what my answer means; or asking me a follow-up if it
needs more. A sidecar is just an open conversation: open questions I answer, and
the agent may append more. If I want to throw something away outright, I (or a
one-line CLI) just delete it — no ceremony. And a question whose source I deleted
no longer lingers.

## User Stories

1. As an operator, I answer questions in PLAIN LANGUAGE and never type or learn a
   disposition token — the system understands my answer.
2. As an operator, when I answer an observation's question, the apply rung runs a
   DECISION AGENT that reads my answer + the source item and acts: mint a
   self-contained task, mint a PRD, mint an ADR, delete the source, or ask me a
   follow-up.
3. As an operator, the agent's decision is grounded in the SOURCE ITEM's full
   context (its body, type, and surrounding signal), not just the latest answer
   text — the analogue of intake reading the whole issue thread.
4. As an operator, when the agent needs more from me, it APPENDS follow-up
   questions to the same sidecar (monotonic ids, prior answers preserved) and
   re-pauses, so the conversation accumulates — reusing the existing
   append/re-pause loop.
5. As an operator, "delete this signal" is a DIRECT action — I (or the
   `answer-questions` skill, or a new `dorfl` CLI helper) delete the source + its
   sidecar straight, with the reason in the commit message; it does not round-trip
   through the engine. (The agent MAY also reach `delete-source` as a verdict when
   my answer makes deletion the sensible outcome.)
6. As a maintainer, the `disposition=` field and the whole token vocabulary
   (`promote-* | keep | delete | dropped | needs-attention`) are GONE from the
   sidecar, the parser, the apply rung, and the surface/skill prose — a sidecar
   entry is binary (no-answer | answered), nothing else.
7. As a maintainer, the `keep` disposition and its `triaged:keep` resting-state
   machinery are removed (there is no "retain as resolved" state; a signal is
   either still-open, acted-on, or deleted).
8. As a maintainer, `needs-attention` is removed as a triage ANSWER, while the
   `needs-attention/` LIFECYCLE state (bounced build / stuck lock) is left
   entirely untouched.
9. As a maintainer, the decision engine is GENERALISED: a shared
   `decide(input, allowedOutcomes) → verdict` core, parameterised by an
   input-adapter and an allowed-outcome set, so intake and advance-apply share the
   machinery without being forced to identical verdicts or inputs.
10. As an operator, a question sidecar whose source item was deleted out-of-band
    is reaped by an orphan-sidecar GC, so a question never outlives its source.
11. As an operator, a destructive `delete-source` verdict is git-recoverable (a
    one-commit, revertible deletion with the reason in the commit message), so a
    wrong inference is never catastrophic.

### Autonomy notes (the two gate axes)

- **`humanOnly` (DECIDED):** OMITTED — building this is ordinary agent work
  (though the FEATURE is about how human answers are resolved). Tasking does not
  require a human to drive it once the open questions are answered.
- **`needsAnswers` (DISCOVERED):** OMITTED — the three forks raised at design time
  are RESOLVED (see Resolved decisions 11–13): delete is direct/no-confirm;
  intake's core is extracted ONLY where it makes sense (not a forced refactor);
  intake does NOT gain `adr` (the engine is outcome-agnostic so it can be added
  later). The PRD launches tasking-ready.

## Resolved decisions

1. **Disposition vocabulary is REMOVED entirely.** No `disposition=` field, no
   `promote-* | keep | delete | dropped | needs-attention` tokens, no
   most-decisive-disposition picker. A sidecar entry is binary: no-answer (open)
   or answered (human prose). The conceptual per-item decision moves to the
   decision AGENT, not a per-entry field.
2. **Apply becomes AGENT-DRIVEN (the core shift).** Today `applyAnsweredQuestions`
   branch 2 is deterministic disposition-routing. Replace it with a decision agent
   (`prompt → verdict`) over `(the answered question(s), the source item + its
   type/context)`, emitting one of the allowed outcomes. The lock model already
   puts the expensive agent phase post-lock, so this fits the advance tick.
3. **The decision engine is GENERALISED + parameterised by `(input-adapter,
   allowed-outcomes)`.** Shared machinery = `prompt → verdict → dispatch` (intake's
   stubbable seam). The allowed-outcome SET is a parameter: advance-apply allows
   `{mint-task | mint-prd | mint-adr | delete-source | ask-follow-up}`; intake
   keeps its current `{task | prd | ask | bounce}`. The INPUT adapter differs per
   front door (issue thread vs answered sidecar + source item) and is NOT forced
   to be shared. Share what is natural; do not force it.
4. **Apply fires ONLY on a FULLY-answered sidecar; follow-ups are BATCHED.** The
   apply rung already gates on `allAnswered` (it refuses a sidecar with any
   pending entry — `apply-persist.ts`), so a half-answered sidecar never triggers
   the decision agent: the human answers ALL open questions, THEN one decision
   runs. And when the decision agent needs more, it MUST ask everything it still
   needs as ONE batch of appended follow-ups, never a drip — one round of answers
   yields one decision (act, or one batch of follow-ups), minimising back-and-
   forth. This mirrors the batch-don't-dribble discipline of
   `surface-questions`/`answer-questions`.
5. **`ask-follow-up` reuses the EXISTING append/re-pause loop.** The
   "agent has more questions" flow is already built: `applyAnsweredQuestions`
   branch 1 + `appendQuestions` (monotonic `qN+1`, never mutating answered
   entries, keep `needsAnswers:true`, re-pause in one commit). The verdict just
   routes into it — no new conversational machinery.
6. **`delete-source` is a DIRECT agent verdict, uniform across source types.** No
   per-type "ask before deleting a task" gate. The agent deletes when the answer
   makes deletion the sensible outcome — common for observations, rare for tasks
   (a task is realistically only deleted when the human's own answer to a "should
   we delete this?" question says so). Same mechanism either way.
7. **Cheap delete is also a DIRECT human/skill/CLI action** (does not require the
   agent): the human, the `answer-questions` skill, or a new `dorfl` helper (e.g.
   `dorfl drop <slug>` / a question-rm verb) `git rm`s the source + its sidecar
   straight, reason in the commit message.
8. **Orphan-sidecar GC.** A sweep reaps a `work/questions/<type>-<slug>.md` whose
   source item no longer exists (deleted out-of-band). Whether this rides `dorfl
   gc` (today only reaps job worktrees) or a dedicated sweep is a tasking detail;
   the behaviour is required either way.
9. **`needs-attention/` lifecycle state is UNTOUCHED.** Only the triage-ANSWER
   `needs-attention` disposition is removed. The bounced-build / stuck-lock
   routing, `requeue` recovery, and `run`/status surfacing keep working.
10. **Self-containment on promote is preserved.** The mint-task / mint-prd verdicts
   carry the answer(s) + remaining open-question scoping into the spawned artifact
   (the discharge PRD already established self-containment; the agentic path must
   not regress it). The source is deleted in the same atomic commit as the create
   (delete-on-promote), exactly as today.
11. **No coordination blocker.** The discharge PRD
    (`observation-discharge-by-deletion-self-contained-promotion-and-prd-route`)
    is FULLY LANDED (all 5 tasks in `tasks/done/`), so this PRD `taskedAfter`
    nothing; it SIMPLIFIES on top — removing the `keep` token, the `disposition=`
    field, and the deterministic routing that discharge built upon, while keeping
    discharge's deletion-on-apply + self-containment semantics.
12. **Destructive `delete-source` fires DIRECT, no confirmation (fork 1 resolved).**
    The agent's `delete-source` verdict executes immediately when the answer makes
    deletion sensible — no preview/confirm step. The safety net is that the delete
    is a single revertible commit with the reason in the commit message (git
    history is the archive; US #11), and the human's answer is the source of truth
    the agent must not invent against. No special guard beyond that.
13. **Extract intake's core ONLY where it makes sense (fork 2 resolved).** Do NOT
    force a full intake refactor. Extract the shared `decide(input,
    allowedOutcomes) → verdict` machinery where it is a NATURAL shared seam;
    where intake's flow is genuinely different (its issue-thread I/O, its bounce
    semantics), leave it intake's own. The input adapters are per-front-door and
    NOT shared. Two decision call sites that share the verdict CONTRACT but not
    necessarily one monolithic implementation is an acceptable outcome.
14. **Intake does NOT gain `adr`; the engine stays outcome-AGNOSTIC (fork 3
    resolved).** `mint-adr` is an available outcome the engine supports and
    advance-apply allows; intake keeps `{task | prd | ask | bounce}` unchanged.
    The engine being agnostic to the allowed-outcome set means `adr` (or any
    future outcome) CAN be added to intake later by a separate decision, without
    re-architecting — but this PRD makes no behaviour change to intake's outcomes.

## Implementation Decisions

- **Sidecar model.** Drop `SidecarDisposition`, the `disposition=` parse/serialise,
  the `DISPOSITIONS` set, the most-decisive picker, and the `keep`/`triaged:keep`
  stamp. `allAnswered`/`pendingEntries` stay (binary answered-ness); the apply
  decision no longer reads a field.
- **Decision engine.** Define `decide(input, allowedOutcomes) → verdict` (the
  shared seam, stubbable for tests like intake's). Verdict union is the SUPERSET
  `{task | prd | adr | delete | ask}`; each caller passes its allowed subset.
- **advance-apply wiring.** `applyAnsweredQuestions` calls the decision engine
  with the answered-sidecar + source-item input-adapter and the advance
  allowed-outcome set; routes `ask` into the existing append/re-pause branch,
  `task`/`prd`/`adr` into the mint-and-delete-source path (reuse
  `promoteObservation`/`createItemThroughCas`), `delete` into the discharge
  deletion path.
- **intake.** Either refactor onto the shared engine (extract) or leave as-is with
  a sibling (fork) — see open question 2. If extracted, intake's verdict set is
  unchanged unless open question 3 enables `adr`.
- **CLI helper.** A small explicit verb to delete a source + its sidecar in one
  revertible commit (for the human/skill direct-delete path).
- **Orphan GC.** A sweep over `work/questions/` that removes a sidecar whose
  `(type, slug)` source is absent on the arbiter.

## Testing Decisions

- A decision-engine test with a STUBBED verdict (no model) per outcome:
  ask→append+re-pause; task/prd/adr→mint self-contained + source deleted in the
  same commit; delete→source+sidecar removed, reason in commit message.
- An allowed-outcome test: a caller that does NOT allow `adr` never receives it;
  intake's set is unchanged.
- An append-loop test (already-covered shape): answered q1/q2 + an agent
  follow-up appends q3, preserves q1/q2, keeps `needsAnswers:true`.
- An orphan-GC test: a sidecar whose source is gone is reaped; one whose source
  exists is left.
- A direct-delete CLI test over a throwaway repo: source + sidecar removed in one
  revertible commit.
- Prior art: intake's stubbed-verdict dispatcher tests; the existing
  apply-persist / sidecar / surface-persist tests.

## Out of Scope

- The `needs-attention/` LIFECYCLE state and its recovery (`requeue`, status
  surfacing) — untouched; only the triage-answer disposition is removed.
- Work-item (task/prd) terminal-folder routing (`tasks/cancelled`,
  `prds/dropped`) as a LIFECYCLE concern — this PRD is about question-resolution,
  not item-lifecycle terminals. (A task/prd is "dropped" by its own lifecycle, not
  by a question disposition.)
- Changing intake's existing verdict behaviour (task/prd/ask/bounce) — the engine
  is generalised, but intake's adoption of new outcomes (`adr`) is gated on open
  question 3.
- A natural-language classifier as a STANDALONE always-on layer — the decision is
  the agent's verdict over the answer + source, not a separate NLU pass.

## Further Notes

- Lineage: this PRD is the SIMPLIFICATION that the discharge PRD's work made
  visible. Discharge fixed "notes don't leave cleanly"; draining the resulting
  question backlog exposed that the disposition VOCABULARY itself is the wrong
  abstraction — the engine should read the human's answer, not a token. Same
  `prompt→verdict→dispatch` shape as intake, unified.
- Key evidence: `sidecar.ts` (the `disposition=` field + `DISPOSITIONS` set +
  `SidecarDisposition`); `apply-persist.ts` (the deterministic disposition picker
  `:318/:331`, the `keep`/`triaged:keep` machinery `:152/:638`, the append/re-pause
  branch `:433`, the observation-delete discharge `:548`); `intake.ts` (the
  `prompt→verdict→dispatch` seam + stubbable dispatcher, `buildIntakeDecisionPrd`);
  `advance.ts:717` (`appendQuestions: context.applyFollowups`, the follow-up wiring
  already present); SURFACE-PROTOCOL.md (the disposition list the surface emits).
