---
title: Agentic question-resolution — retire the disposition vocabulary, generalize the decision engine
slug: agentic-question-resolution-retire-disposition-vocabulary
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: the tasks below. This prd has been TASKED: the Implementation/Testing detail moved into the task files (see the task map at the end), and it now settles to its durable framing (Problem / Solution / User Stories / Resolved decisions / Out of Scope).

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
   _(Tasking note: the `mint an ADR` clause is DEFERRED past the keystone — there
   is no ADR-mint path in the codebase today, and PRD decision 14 makes the engine
   outcome-agnostic so `adr` is added separately. The agentic apply path LAUNCHES
   with task / prd / delete / ask; `mint-adr` is the follow-on task
   `agentic-apply-mint-adr-route`. This is a flagged, named non-delivery, not a
   hole.)_
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
  `SidecarDisposition`); `apply-persist.ts` (the deterministic disposition picker,
  the `keep`/`triaged:keep` machinery, the append/re-pause branch, the
  observation-delete discharge); `intake.ts` (the `prompt→verdict→dispatch` seam +
  stubbable dispatcher, `buildIntakeDecisionPrd`); `advance.ts`
  (`appendQuestions: context.applyFollowups`, the follow-up wiring already
  present); SURFACE-PROTOCOL.md (the disposition list the surface emits).

## Task map

This prd was decomposed (2026-06-24) into seven vertical tasks (born in
`work/tasks/backlog/`). The Implementation/Testing detail above moved into them:

1. **`decision-engine-shared-decide-seam`** (US #9) — the shared
   `decide(input, allowedOutcomes) → verdict` core, stubbable, outcome-agnostic.
   Startable now.
2. **`agentic-apply-retire-disposition-vocabulary`** (US #1/#2/#3/#4/#6/#7/#8/#10;
   the KEYSTONE) — flips the apply rung to the agent-driven decision AND removes
   the disposition vocabulary + picker + `keep`/`triaged:keep`. The agentic
   decision SUBSUMES the triage rung: the triage question loses its disposition
   token, `answeredPromoteArtifact` + the surface/triage-gate disposition emit
   (`surface-gate.ts`/`triage-gate.ts`) are removed, the artifact type comes from
   the agent verdict, and the `auto`-triage `map` case discharges by deletion (no
   more `triaged:keep`). The `auto` exception otherwise survives; the
   `needs-attention/` lifecycle state and self-containment-on-promote are
   preserved. Owns the disposition removal across `sidecar.ts` / `apply-persist.ts`
   / the advance/triage/surface-gate seam (the engine + gate CODE); the
   operator-facing PROSE is task #4. EXTRACTS `resolveItemPathByIdentity` into a
   neutral re-exported module so the CLI verb (#3) and the orphan gc sweep (#6)
   reuse it without importing the hot file. Does NOT own US #10 (see #6). Blocked
   by #1.
3. **`direct-delete-question-cli-helper`** (US #5/#11) — a `dorfl` verb to delete a
   source + sidecar in one revertible commit (the direct human/skill path, no engine
   round-trip). Reuses the keystone's extracted `resolveItemPathByIdentity`, so it
   is WRITE-orthogonal (only new CLI/module files) but has a READ dependency on that
   extracted seam. Blocked by #2.
4. **`surface-skill-prose-drop-disposition-vocabulary`** (US #6) — drops the
   disposition vocabulary from the PROTOCOL prose (SURFACE-PROTOCOL.md +
   WORK-CONTRACT.md, source+copy byte-identical) and the `answer-questions` /
   `surface-questions` skills; distinguishes the retired TOKEN vocabulary from
   generic-English "disposition" (left untouched). Does NOT touch triage-observations
   (that is #7). Blocked by #2.
5. **`agentic-apply-mint-adr-route`** (US #2, the deferred ADR clause) — adds the
   `mint-adr` outcome: widens advance-apply's allowed set to permit `adr` and adds
   the ADR-mint route (`docs/adr/`, ADR-FORMAT shape, source deleted in the same
   commit). Deferred past the keystone because no ADR-mint path exists today and
   PRD decision 14 makes the engine outcome-agnostic. Blocked by #2.
6. **`orphan-sidecar-gc-sweep`** (US #10) — reaps a sidecar whose source was
   deleted out-of-band, as a SWEEP over `work/questions/` folded into `dorfl gc`
   (which runs on the scheduled CI tick). It CANNOT be an apply step: a deleted
   source is in no lifecycle pool, so the advance driver never enumerates it and no
   per-item tick (`apply`/`no-op`) ever runs on the orphan; the sidecar file is the
   orphan's only on-disk trace, so the reap must enumerate `work/questions/`
   directly. Reuses the keystone's extracted `resolveItemPathByIdentity`;
   write-orthogonal (edits `gc.ts`/CLI/CI template, which no other task touches).
   Blocked by #2.
7. **`triage-observations-skill-retire-disposition-vocabulary`** (US #6) — the
   FINAL prose sweep: brings the `triage-observations` human-drain skill (and the
   borderline `orchestrate`/`work` mentions) into the retired-vocabulary world,
   preserving its workflow. Kept separate from #4 because it is a larger
   human-workflow surface whose own recommendation taxonomy is adjacent to (not
   identical to) the engine's retired `disposition=` tokens — a deliberate scope
   call (3a). Blocked by #4 (settled protocol prose first).

The hot files (`sidecar.ts`, `apply-persist.ts`, and the advance/triage/surface-gate
seam: `advance.ts`, `advance-classify.ts`, `triage-persist.ts`, `triage-gate.ts`,
`surface-gate.ts`) are edited only by the keystone (#2) — and the apply seam again
by #5 (mint-adr), serialized after #2. #1 (decision engine) is a new module,
file-orthogonal and startable now. The rest are all blocked by #2: #3 (CLI verb)
and #6 (orphan gc sweep) have a READ dependency on the keystone's extracted
`resolveItemPathByIdentity` but are write-orthogonal (#3 new files, #6 edits
`gc.ts`/CLI/CI template — neither touched by another task); #4 (protocol prose) is
doc-only, gated so the prose matches the shipped engine; #5 extends the apply seam;
#7 (triage-observations prose) is doc-only and gated on #4. The orphan-sidecar reap
(US #10) is a SWEEP over `work/questions/` in #6, NOT an apply step — a deleted
source is never enumerated by the advance driver, so the per-item apply path can
never reach it; the sweep (folded into the scheduled CI `dorfl gc`) is the only
mechanism that fires.

US #6 (vocabulary GONE from sidecar/parser/apply-rung AND the surface/skill prose)
is delivered across THREE tasks by layer: #2 removes it from the engine + gate CODE;
#4 from the protocol docs + answer/surface-questions skills; #7 from the
triage-observations human-drain skill (a deliberately separate surface). US #2
launches via #2 with the ADR clause delivered by #5 (a flagged, named phasing — not
a hole).
