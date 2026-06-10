---
title: An eval harness for the setup (onboarding/migration) skill — repeatable, interactive-answer, invariant-graded
slug: setup-skill-eval-harness
needsAnswers: true
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/backlog/` slices. (Technical-detail sections below are trimmed by `to-slices` once sliced — they move into slices/ADRs and this PRD settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

The `setup` skill (the single onboarding/migration skill) is **interactive and judgement-heavy**: it inventories a repo, proposes a plan, asks the user questions (description, `verify` gate, the inventory→bucket mapping, the ADR _whys_, source-file deletion), and produces fuzzy artifacts (PRDs, slices, ideas, observations, ADRs, a `CONTEXT.md`, an `.agent-runner.json`).

Today the ONLY way we know whether a change to the skill made it better or worse is **a human eyeballing a single hand-driven run**. That is a weak, expensive signal:

- One run cannot separate a real regression from LLM run-variance (a recent run found 3 ADRs where another found 2; a run silently skipped a dotfolder source; a run forgot to propose deleting converted sources — each spotted only by chance, by a human staring at the output).
- Re-running by hand is slow and the human has to re-answer the same questions every time.
- There is no objective record of "did invariant X hold across N runs", so skill edits are tuned on anecdotes (and risk **teaching-to-the-test** if we bake the expected answers into the skill).

We need a **repeatable eval** that exercises the _real interactive skill_ against a _known input_, supplies the answers automatically, and grades **structural invariants** (not exact wording) across multiple runs — so "is the skill doing a good job?" becomes a measurable pass-rate, and a skill edit can be checked for regression before it ships.

## Solution

An **eval harness** that, per run:

1. **Provisions a fresh, known input repo** — clone the real `rocketh` repo (a rich, real-world populated repo: a `TODO.md`, a design doc in a dotfolder, a code-review report, substantial source embodying deliberate decisions) into a scratch worktree, at a pinned ref, in a clean state.
2. **Runs the actual `setup` skill** against that clone (the real skill, real model, real interactivity — NOT a reimplementation).
3. **Answers the skill's questions automatically via an "answerer" agent** backed by a fixed **answer-bank** of what we already know about the input repo (its description, its real `verify` gate, the right bucket routing, the _whys_ behind its known decisions, "yes delete the converted sources"). The answerer maps each surfaced question to a known answer.
4. **HARD-ERRORS on any unanswerable question.** If the skill asks something the answer-bank cannot satisfy, the eval **FAILS for that run and surfaces the exact unanswered question(s)** — it NEVER guesses, fabricates an answer, or proceeds. An unanswerable question is a first-class eval failure whose remedy is: a human inspects it and either (a) adds the answer to the bank (if it is a legitimate new question) or (b) treats it as a skill defect (the skill asked something it shouldn't have). This is the "get notified" mechanism: the eval stops and tells you precisely what it could not answer.
5. **Grades structural invariants** on the resulting artifacts — properties that hold regardless of LLM word-choice (see the invariant list below) — and records pass/fail per invariant.
6. **Repeats N times** and reports the **per-invariant pass-rate across runs**, so variance is visible and a regression shows up as a dropped rate rather than a single anecdote.

Lives under `tests/`. It is an **eval** (a graded, somewhat-non-deterministic quality measure), distinct from the deterministic unit/integration tests — so it is runnable on demand (and in CI as a non-blocking signal), not part of the per-change `verify` gate that must be green every commit.

## User Stories

1. As a skill author, I want to run the eval and get a per-invariant pass-rate across N runs, so that I can tell whether a skill edit improved or regressed onboarding quality — not guess from one run.
2. As a skill author, I want the input to be a fresh clone of a real, rich repo at a pinned ref, so that every run starts from the identical known "before" state and results are comparable.
3. As a skill author, I want an answerer agent to supply the skill's answers from a fixed answer-bank, so that I do not have to hand-answer the same questions every run.
4. As a skill author, when the skill asks a question the answer-bank cannot satisfy, I want the eval to FAIL that run and surface the exact unanswered question(s) — never guess — so that I am notified to either add the answer or recognise a skill defect.
5. As a skill author, I want the eval to grade STRUCTURAL invariants (not exact text), so that legitimate LLM wording variance does not cause spurious failures while real regressions still surface.
6. As a skill author, I want the invariants to include the specific failure modes we have already hit (a dotfolder source missed; a fully-converted source not proposed for deletion; the gate baking in install or ordering expensive-first; an enumerated ADR index written into `CONTEXT.md`; the decision-hunt skipped), so that known regressions are caught automatically.
7. As a skill author, I want the eval NOT to leak the expected answers/shapes INTO the skill (no teaching-to-the-test), so that a passing eval reflects the skill genuinely working, not the skill being told the answers — the answer-bank lives in the harness, never in the skill.
8. As a skill author, I want each run isolated (its own scratch clone, no writes to my real repos, the input clone discarded after), so that runs do not pollute each other or the host.
9. As a skill author, I want a concise diff-able report (per-invariant pass-rate + the list of any unanswered-question failures), so that a CI run or a local run gives me an at-a-glance verdict.
10. As a skill author, I want to add a new invariant or a new answer to the bank without rewriting the harness, so that the eval grows as we learn new failure modes.

### Autonomy notes (the two gate axes)

- `needsAnswers: true` is set on this PRD — there are real open questions below (how the skill is invoked programmatically, how the answerer intercepts questions, how invariants are extracted from fuzzy output). They MUST be resolved before slicing, because the harness's feasibility hinges on them. Do not auto-slice until they are answered and the flag cleared.
- `humanOnly` omitted — once the questions are answered, the slices are ordinary build work.

## Implementation Decisions

> Trimmed at slice-time. Launch intent to seed slicing; verify against reality before building.

- **Input = a fresh `rocketh` clone at a PINNED ref.** Not a synthetic fixture: rocketh is a real, rich repo we understand well, and using it keeps the eval honest (it is the repo we have been hand-testing on). Pin a specific commit so the "before" state — and therefore the expected invariants — is stable. Clone into a scratch dir per run; never operate on a working copy of rocketh the human is using.
- **The answerer agent + answer-bank.** A small agent whose job is ONLY to answer the skill's questions from a declarative answer-bank (a data file mapping question-intent → answer): the repo description, the real verify gate, the bucket routing for each known source, the _why_ for each known ADR-worthy decision, and the delete-the-converted-sources confirmations. Matching is by intent, not exact string (the skill phrases questions differently across runs). On no match → raise the hard-error (story 4).
- **Invariant extraction operates on ARTIFACTS, not transcript wording.** After a run, grade the produced files: existence/shape of `work/` items, `docs/adr/NNNN-*.md`, `.agent-runner.json` contents, `CONTEXT.md` content — checkable structurally. Some invariants may also inspect the transcript for a behaviour (e.g. "a delete was proposed"), but prefer artifact checks where possible.
- **Candidate structural invariants (the grading checklist — extend over time):**
  - the dotfolder design doc is discovered and routed to a **PRD** (≥1 file in `work/prd/`), not under-routed to an `idea` (the dotfolder-miss regression).
  - every fully-converted source (e.g. the `TODO.md`) has a **delete proposed** for it (the source-cleanup-checkpoint regression).
  - `.agent-runner.json` `verify` is **cheap-first** (lint/format before build before test) and contains **no install/bootstrap** prefix.
  - `CONTEXT.md` does **not enumerate** items (no `0001 … 0002 …` ADR index); the folder is the index.
  - the **decision hunt ran**: ≥1 ADR-worthy decision was asked about (given an input repo known to contain such decisions), OR the run explicitly accounts for scanning and finding none.
  - `docs/adr/*` written are in the standard format and were authored only after a human (answerer) supplied the _why_.
  - the protocol docs were copied into `work/protocol/` (+ VERSION), and the deterministic skeleton exists.
  - nothing was auto-committed; nothing outside the scratch clone was touched.
- **It is an EVAL, not a `verify`-gate test.** Non-deterministic and model-dependent; runnable on demand and as a non-blocking CI signal. Report per-invariant pass-rate across N runs (N configurable).
- **No teaching-to-the-test.** The answer-bank and invariants live ENTIRELY in `tests/`; nothing about the expected answers or shapes leaks into `skills/setup/`. (This PRD's existence is itself a guard: if a future skill edit "passes" only because the skill now names the expected output, that is a regression of the eval's validity, not a win.)

## Testing Decisions

> Also trimmed at slice-time.

- The harness's OWN logic (clone provisioning, answerer matching, invariant extraction, the hard-error-on-unanswered path, the report) is deterministic and gets ordinary unit/integration tests under `tests/` — distinct from the eval it runs.
- Test the hard-error path explicitly: feed a question with no bank entry → assert the run fails and names the question.
- Test invariant extractors against fixed sample artifacts (a known-good `work/` tree → all green; a known-bad one with an enumerated CONTEXT index / a missed PRD → the right invariants go red).

## Out of Scope

- A fully unattended "self-improving" loop that edits the skill based on eval results (this harness MEASURES; a human decides skill changes).
- Generalising the eval to arbitrary repos in this pass (start with the pinned rocketh clone; multi-repo input is a later extension).
- Making the eval part of the blocking `verify` gate (it is a non-blocking quality signal; it is non-deterministic by nature).

## Further Notes / Open Questions (resolve before slicing — `needsAnswers`)

1. **How is the `setup` skill invoked programmatically for a run?** The skill is normally injected into an interactive agent session. The harness needs to launch the real skill against the clone and capture its question-turns and file-writes. Is this via the subagent mechanism (`pi-subagents` / the agent-runner harness seam), a scripted `pi` session, or another driver? This is the load-bearing feasibility question.
2. **How does the answerer intercept the skill's questions and inject answers?** Does the harness run two agents (the skill-runner and the answerer) wired so the skill's questions are routed to the answerer and its replies fed back as the user turn? What is the transport (the intercom/coordination seam, a turn-by-turn loop)?
3. **How is "the skill asked a question" detected vs. the skill just narrating/proceeding?** The harness must recognise an actual question-awaiting-answer (a turn that blocks) so it can route it to the answerer — distinct from the skill's narration.
4. **Answer-bank matching:** by what mechanism is a surfaced question matched to a bank entry (intent classification by the answerer agent itself, given the bank as context)? The answerer is itself an agent, so it can judge intent — but we need it to be honest about "no match" (story 4) rather than fabricating.
5. **Run cost / N:** running the full interactive skill N times (each a multi-turn agent session against a real repo, including a real gate run) is expensive. What is a practical N for a signal, and is the gate-run step (which needs deps installed in the clone) in or out of the eval (it intersects the prepare-vs-verify gap observation)?

## Provenance

Written 2026-06-09 from a maintainer discussion after several hand-driven `setup`/migrate runs on rocketh surfaced regressions only by chance (a dotfolder source missed → a PRD under-routed to an idea; converted sources not proposed for deletion; ADR-count variance run-to-run). The maintainer's design: clone rocketh as input, an answerer agent supplies answers from known repo knowledge, the eval HARD-ERRORS (with the exact question) on anything the answerer cannot fulfil, and it grades structural invariants across runs — an eval that still allows interactive answers. Dogfoods the `work/` contract this very session hardened.
