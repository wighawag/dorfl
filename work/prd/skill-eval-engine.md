---
title: A reusable skill-eval engine (pi-RPC-driven, interactive-answer, invariant-graded) — with the setup skill as its first consumer
slug: skill-eval-engine
humanOnly: true
---

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` (decisions) + the code; remaining work: `work/backlog/` slices. (Technical-detail sections below are trimmed by `to-slices` once sliced — they move into slices/ADRs and this PRD settles to its durable framing: Problem / Solution / User Stories / Out of Scope.)

## Problem Statement

**Interactive, judgement-heavy SKILLS have no objective regression signal.** The `setup` skill (the single onboarding/migration skill) inventories a repo, proposes a plan, asks the user questions (description, `verify` gate, the inventory→bucket mapping, the ADR _whys_, source-file deletion), and produces fuzzy artifacts (PRDs, slices, ideas, observations, ADRs, a `CONTEXT.md`, an `.agent-runner.json`). Today the ONLY way we know whether a change to it made things better or worse is **a human eyeballing a single hand-driven run** — a weak, expensive signal:

- One run cannot separate a real regression from LLM run-variance (a recent run found 3 ADRs where another found 2; a run silently skipped a dotfolder source; a run forgot to propose deleting converted sources; a run irreversibly deleted a file on an ambiguous reply — each spotted only by chance, by a human staring at the output).
- Re-running by hand is slow and the human re-answers the same questions every time.
- There is no objective record of "did invariant X hold across N runs", so skill edits are tuned on anecdotes (and risk **teaching-to-the-test** if the expected answers leak into the skill).

**And this problem is NOT specific to `setup`.** Other interactive skills have the same need — e.g. `hardhat-deploy-migration` (in the `hardhat-deploy` repo) migrates a project from v1 to v2 and would equally benefit from a repeatable, graded eval (with its OWN input repo, its OWN graders, and — for it — possibly NO answerer needed, since it may ask few or no questions). The right thing is therefore not a one-off harness for `setup`, but a **reusable eval ENGINE** that any skill (in any repo) can plug an eval-definition into.

## Solution

A **generic skill-eval engine** — a standalone package (`packages/skill-eval`) that knows nothing about the `work/` contract — plus **per-skill eval definitions** that plug into it. The first definition is `setup`'s (it lives in agent-runner and depends on the engine); `hardhat-deploy-migration`'s would be the second (in its own repo, later).

**The engine, per run, does the skill-agnostic part:**

1. **Provisions a fresh, known input repo** — clone the definition's specified repo at a pinned ref into a scratch dir, clean.
2. **Runs the real skill** against that clone via **pi RPC mode** (`pi --mode rpc`, then `/skill:<name>`) — real skill, real model, real interactivity, NOT a reimplementation.
3. **Drives the question loop with an OPTIONAL answerer.** If the definition supplies an answerer (answer-bank + context), the engine routes each surfaced question to it and replies. If the definition supplies NO answerer (a skill expected to need no input), a surfaced question is itself a surfaced outcome (notify/fail), not something to answer.
4. **HARD-ERRORS / SURFACES on any unanswerable question.** With an answerer: a question it cannot satisfy → the run FAILS and surfaces the exact question (never guesses/fabricates). Without an answerer: any blocking question → surfaced as "this skill asked, but this eval expected none." Either way the human is **notified with the precise question** and decides: add an answer, or recognise a skill defect.
5. **Captures the transcript + final repo state**, then runs the definition's **graders** (structural invariants) and records pass/fail per grader.
6. **Repeats N times** and reports the **per-invariant pass-rate across runs**, so variance is visible and a regression shows as a dropped rate, not a single anecdote.

**Each eval DEFINITION supplies the skill-specific part:** the input repo + ref, an optional answerer (answer-bank + context), and the graders. `setup`'s definition grades `work/`-contract structure; `hardhat-deploy-migration`'s would grade "v2 config shape + the project builds." The engine never imports any of this — it consumes a generic `EvalDefinition` interface.

It is an **eval** (a graded, somewhat-non-deterministic quality measure), distinct from deterministic unit/integration tests. It is **run manually when judging a skill change** — not on `do`, not part of the per-change `verify` gate, not a CI blocker (skills are authored/edited by interactive conversation, and this eval is the conversational author's measuring stick).

## User Stories

**The reusable ENGINE:**

1. As a skill author, I want a generic eval engine I point at ANY skill via an eval-definition, so that the run-loop/answering/grading machinery is shared, not re-built per skill.
2. As a skill author, I want the engine to live in its OWN package with NO dependency on agent-runner's internals, so that it stays genuinely standalone (can't quietly reuse a harness seam) and is trivially extractable to its own repo later.
3. As a skill author, I want the engine to run the real skill against a fresh clone (the FIRST harness being pi RPC, `/skill:<name>`), capture the transcript + final repo state, and report per-invariant pass-rate across N runs, so that I get an objective regression signal instead of eyeballing one run.
4. As a skill author, I want the harness (HOW the skill is driven) to be a pluggable SEAM with pi RPC as the first adapter — NOT hardwired — so that the engine can later run the same eval across different harnesses (to compare them, or to surface a skill that's robust on one harness but not another) and be adopted by projects on a different agent runtime.
5. As a skill author, I want the answerer to be OPTIONAL per definition — some skills need answers, some ask nothing — and a harness to DECLARE whether it can intercept/answer questions, so that the engine fits both interactive and non-interactive skills/harnesses and pairs them safely (or fails fast on a mismatch).
6. As a skill author, when a question is unanswerable (the answerer can't satisfy it, OR a no-answerer eval gets asked anything, OR a non-interactive harness gets a blocking question), I want the run to SURFACE the exact question and fail — never guess — so that I am notified to add an answer or recognise a skill defect.
7. As a skill author, I want each run isolated (its own scratch clone, no writes to my real repos, the clone discarded after), so that runs don't pollute each other or the host.
8. As a skill author, I want a concise, diff-able report (per-invariant pass-rate + the list of surfaced/unanswered questions), so that a run gives an at-a-glance verdict.

**Per-skill DEFINITIONS (the seam that proves reusability):**

9. As the `setup` skill's author, I want a `setup` eval-definition (input = pinned rocketh clone; an answerer with rocketh's description/gate/mapping/ADR-whys/delete-confirmations; graders for the `work/`-contract invariants) that DEPENDS ON the engine and lives in agent-runner, so that the engine stays generic and `setup`'s specifics stay with `setup`.
10. As a skill author of ANOTHER skill (e.g. `hardhat-deploy-migration`), I want to write my own eval-definition (my input repo, my graders, optionally no answerer) against the SAME engine, so that the engine is validated as reusable, not over-fit to `setup`. (Named second consumer; its definition is a follow-on, not built in this PRD — but the engine's API must satisfy it on paper.)
11. As a skill author, I want `setup`'s graders to include the specific failure modes we have already hit (a dotfolder source missed; a fully-converted source not proposed for deletion; a same-feature duplicate across buckets; a destructive delete on an ambiguous reply; the gate baking in install or ordered expensive-first; an enumerated ADR index in `CONTEXT.md`; the decision-hunt skipped), so that known regressions are caught automatically.
12. As a skill author, I want the answer-bank and graders to live ENTIRELY in the definition (never leaked into the skill), so that a passing eval reflects the skill genuinely working, not the skill being told the answers (no teaching-to-the-test).
13. As a skill author, I want to add a grader or an answer to a definition without touching the engine, so that an eval grows as we learn new failure modes.

### Autonomy notes (the two gate axes)

- The original feasibility questions (how to invoke the skill programmatically, how the answerer intercepts questions, how to detect a question vs. narration) are **RESOLVED** — pi's **RPC mode** (`packages/coding-agent/docs/rpc.md`) provides all the mechanics (see Implementation Decisions). `needsAnswers` is therefore cleared.
- `humanOnly` omitted — the slices are ordinary build work. The remaining open questions (cost/N, in-clone gate-run, answerer model) are tuning choices, not blockers.

## Implementation Decisions

> Trimmed at slice-time. Launch intent to seed slicing; verify against reality before building.

- **The engine is a STANDALONE package: `packages/skill-eval` (slug-name TBD), with ZERO dependency on `packages/agent-runner`.** A separate package (cheap in this monorepo) is deliberate: it makes any reuse of agent-runner's existing seam code (e.g. its `pi-harness.ts`, its work-contract parsers) an explicit, declared dependency — which the engine must NOT have. The engine talks to pi via its OWN RPC client (spawn `pi --mode rpc`, or the published `@earendil-works/pi-coding-agent` client), never through agent-runner's harness. This boundary is what makes the eventual extraction-to-its-own-repo a clean lift (move the package, flip its workspace deps), not an untangling.
- **TWO seams, kept distinct.**
  - **`EvalDefinition`** (skill-specific: what to test) — `{ inputRepo + ref, answerer? (optional), graders[] }`. The engine imports only this — never `work/`, ADRs, or anything skill-specific.
  - **`Harness`** (runtime-specific: HOW the skill is driven) — the engine programs against a harness INTERFACE, not against `pi --mode rpc` directly. **pi RPC is the FIRST adapter, not a hardwiring.** Which harness runs the skill is itself a variable worth measuring (does `setup` behave the same under pi vs. another harness? a skill robust on one but not another has a portability bug the eval should surface), and seaming it keeps the engine adoptable by a project on a different agent runtime. (This is why the engine still must NOT import agent-runner's internal `pi-harness.ts` — that is agent-runner's tangled, claim/run-coupled version; the engine defines its OWN clean harness seam with a pi-RPC adapter.)
  - **Harness capability varies, and the seam must make that explicit.** pi RPC exposes rich structured signals (`agent_end`, `extension_ui_request`, the message stream) that enable the full interactive answer-loop. A generic fire-and-forget harness (a bare `agentCmd`) may only support "run to completion, then grade artifacts" with NO question interception. So a harness DECLARES its capabilities (can it intercept/answer questions?), and the engine pairs an answerer-requiring eval only with a capable harness — or fails fast if the skill asks a question a non-interactive harness can't field. This maps cleanly onto the optional-answerer design.
  - Keep BOTH interfaces MINIMAL (only what the real consumers/adapters need); resist speculative extension points — the package boundary enforces cleanliness, the APIs stay small.
- **Definitions depend on the engine, never the reverse.** The `setup` definition lives in **agent-runner** (it tests agent-runner's own skill) and depends on `packages/skill-eval`. A future `hardhat-deploy-migration` definition lives in ITS repo and depends on the (eventually-published) engine. Dependency direction: engine ← definitions, always.
- **Input = a fresh `rocketh` clone at a PINNED ref** (the `setup` definition's input). Not a synthetic fixture: rocketh is a real, rich repo we understand well, and using it keeps the eval honest (it is the repo we have been hand-testing on). Pin a specific commit so the "before" state — and therefore the expected invariants — is stable. Clone into a scratch dir per run; never operate on a working copy of rocketh the human is using. (The fixture must include the dotfolder design doc, the `TODO.md`, the review report, and the source — i.e. a ref where all the known sources are present.)
- **First harness adapter = pi RPC mode** (`packages/coding-agent/docs/rpc.md` — the grounding for the first adapter; the engine drives it through the `Harness` seam above, not directly). The pi-RPC adapter spawns `pi --mode rpc` with `cwd` = the clone, then drives a turn loop over the JSONL stdin/stdout protocol (it declares the "can intercept/answer questions" capability):
  - **Invoke the skill:** send `{"type":"prompt","message":"/skill:setup"}`. RPC expands `/skill:name` commands before sending (documented), and skills resolve from `~/.agents/skills/` where our `setup` lives — so no special install. (Use a fixed `--model`/`--provider` for run comparability; `--session-dir` a scratch dir.)
  - **Detect a question vs. narration:** consume the event stream until **`agent_end`** (the run has stopped and is awaiting input). The skill's question to the user is the **last assistant text** at that point (fetch via the `get_last_assistant_text` command, or accumulate `message_update` text deltas). If `agent_end` fired with no question (the skill just finished), the run is complete → go to grading.
  - **Answer:** feed that assistant text to the answerer (below); reply with `{"type":"prompt","message":"<answer>"}` and loop. (NOTE: the skill's confirmations may surface as **extension UI requests** — `confirm`/`select`/`input` — if it uses them; RPC delivers these as `extension_ui_request` needing an `extension_ui_response`. The harness must handle BOTH channels: assistant-text questions AND extension-UI dialogs. In practice `setup` asks via plain assistant text today, but the harness should not assume only one channel.)
- **The answerer agent + answer-bank (a HYBRID of Q&A map + context).** A second agent whose ONLY job is to answer the skill's questions, given a per-repo **answer file** that is part bank, part context:
  - a **context section** — prose about the input repo (what rocketh is, its real gate, the rationale behind its known decisions) that lets the answerer reason about a question it has not seen verbatim; AND
  - an **expected-questions section** — a list of (question-intent → answer) for the predictable asks (description-confirm, gate-confirm, mapping-confirm, the specific ADR _whys_, the delete-sources confirmation). Intents are phrased at a middle grain — not so specific they only match one wording, not so broad they match everything.
  - The answerer matches by INTENT (it is an agent, so it judges meaning, not strings). **It must be honest about "no match":** if a question is not covered by either section, it does NOT fabricate — it returns an explicit "UNANSWERABLE: <the question>" which the engine turns into a run failure (the surface/hard-error path).
- **Invariant extraction operates on ARTIFACTS, not transcript wording.** After the run finishes, grade the produced files in the clone: existence/shape of `work/` items, `docs/adr/NNNN-*.md`, `.agent-runner.json` contents, `CONTEXT.md` content — checkable structurally. A few invariants need the TRANSCRIPT (the captured event/message stream) for a behaviour (e.g. "a delete was proposed before any `rm`", "the cleanup prompt was the only numbered list in its message", "no destructive action on an ambiguous reply") — capture the full JSONL transcript per run so these are gradable; prefer artifact checks where an artifact suffices.
- **Candidate structural invariants (the grading checklist — extend over time):**
  - the dotfolder design doc is discovered and routed to a **PRD** (≥1 file in `work/prd/`), not under-routed to an `idea` (the dotfolder-miss regression).
  - every fully-converted source (e.g. the `TODO.md`) has a **delete proposed** for it (the source-cleanup-checkpoint regression).
  - `.agent-runner.json` `verify` is **cheap-first** (lint/format before build before test) and contains **no install/bootstrap** prefix.
  - `CONTEXT.md` does **not enumerate** items (no `0001 … 0002 …` ADR index); the folder is the index.
  - the **decision hunt ran**: ≥1 ADR-worthy decision was asked about (given an input repo known to contain such decisions), OR the run explicitly accounts for scanning and finding none.
  - `docs/adr/*` written are in the standard format and were authored only after a human (answerer) supplied the _why_.
  - **one feature → one item**: a feature present in two sources (e.g. a one-line task entry + a design doc) yields a SINGLE work item, not a duplicate across buckets (the same-feature-two-sources regression).
  - **no destructive action on an ambiguous reply**: the cleanup prompt was an unambiguous, solely-numbered list, and no `rm` happened on a reply that did not clearly map to the sources (the guessed-deletion regression).
  - the protocol docs were copied into `work/protocol/` (+ VERSION), and the deterministic skeleton exists.
  - nothing was auto-committed; nothing outside the scratch clone was touched.
- **It is an EVAL, not a `verify`-gate test.** Non-deterministic and model-dependent; **run manually when judging a skill change**, never on `do`/CI-blocking. Report per-invariant pass-rate across N runs (N small, human-chosen per judging session).
- **No teaching-to-the-test.** The answer-bank and graders live ENTIRELY in the eval-definition (in `tests/` / the consumer repo); nothing about the expected answers or shapes leaks into `skills/setup/`. (This PRD's existence is itself a guard: if a future skill edit "passes" only because the skill now names the expected output, that is a regression of the eval's validity, not a win.)

## Testing Decisions

> Also trimmed at slice-time.

- The ENGINE's own logic (clone provisioning, the RPC turn-loop, answerer routing, the surface/hard-error-on-unanswered path, the report) is deterministic and gets ordinary unit/integration tests in the `packages/skill-eval` package — distinct from the (non-deterministic) eval it runs. Mock the pi RPC stream so these are deterministic (feed canned `agent_end`/assistant-text/`extension_ui_request` events).
- Test the surface/hard-error path explicitly: a question with no answerer match (and a no-answerer eval that gets asked anything) → assert the run fails and names the question.
- The `setup` DEFINITION's graders are tested against fixed sample artifacts (a known-good `work/` tree → all green; a known-bad one with an enumerated CONTEXT index / a missed PRD / a same-feature duplicate → the right graders go red).

## Out of Scope

- **Extracting the engine to its own repo NOW.** It is designed for extraction (standalone package, no agent-runner deps, generic `EvalDefinition` seam) but ships as a monorepo package first — extract only once a second real consumer (e.g. `hardhat-deploy-migration`'s definition) exercises it and the seam is proven. (Design-for-extraction now; extract on the second real use, not on speculation.)
- **Building the `hardhat-deploy-migration` definition in THIS PRD.** It is the named second consumer that keeps the engine API honest (the API must satisfy it on paper), but writing its definition is a follow-on in its own repo — here we build the engine + the `setup` definition only.
- A fully unattended "self-improving" loop that edits a skill based on eval results (the engine MEASURES; a human decides skill changes).
- Making the eval part of the blocking `verify` gate (it is a non-blocking quality signal; non-deterministic by nature; run manually).

## Resolved design questions (grounded in pi RPC mode)

The original feasibility questions are settled by `packages/coding-agent/docs/rpc.md`:

1. **Invoking the skill** — `pi --mode rpc` + `{"type":"prompt","message":"/skill:setup"}` (RPC expands `/skill:name`). RESOLVED.
2. **Intercepting questions + injecting answers** — a turn loop over RPC stdin/stdout: consume events to `agent_end`, read the last assistant text (and/or handle `extension_ui_request` dialogs), reply via `prompt`. Two agents (skill-runner = the RPC session; answerer = a second agent reading the question). RESOLVED for the pi-RPC adapter (the engine consumes this behind the `Harness` seam, so a different harness can implement intercept-and-answer its own way — or declare it can't).
3. **Question-vs-narration** — `agent_end` (run stopped, awaiting input) is the signal; if the last assistant turn is a question, answer it; if it just finished, grade. RESOLVED.
4. **Answer matching** — hybrid context + expected-questions file, matched by intent by the answerer agent, with an explicit honest "UNANSWERABLE" → run failure. RESOLVED (design above).

## Remaining open questions (tuning, NOT slicing blockers)

1. **Run cost / N.** Each run is a full multi-turn agent session (real model, real repo). This is a **manually-run, separate eval** — NOT a `verify`-gate test, never on `do`/CI-blocking (skills are edited by interactive conversation, so the eval is run by hand when judging a skill change). So N is small and human-chosen (e.g. 3–5); pick per judging session. Not a blocker.
2. **Is the in-clone gate-run inside the eval?** The skill runs `verify` once (A5), which needs deps installed in the clone (`pnpm install` for rocketh). Options: (a) pre-install deps in the clone before the run (so the skill's gate-run goes green and that invariant is exercised), or (b) skip/expect-red the gate-run and don't grade it. This intersects the prepare-vs-verify gap observation. Decide at slice time; default to (a) so the gate-run invariant is real. Not a blocker.
3. **`Harness` seam scope for THIS PRD.** Build the seam + the pi-RPC adapter only (the one we'll actually run); a second adapter / cross-harness comparison is a follow-on. The seam must just not be designed so narrowly that pi-RPC's specifics (its event names, its dialog protocol) leak into the engine — keep it at "launch skill / next question / answer / final state + transcript / capabilities". Confirm the minimal seam shape at slice time.
4. **Answerer model/agent choice.** Which agent runs the answerer (a plain pi session given the answer file as context? a subagent?), and is it the same model as the skill-runner. A quality/cost tuning choice; not a blocker.

## Provenance

Written 2026-06-09 from a maintainer discussion after several hand-driven `setup`/migrate runs on rocketh surfaced regressions only by chance (a dotfolder source missed → a PRD under-routed to an idea; converted sources not proposed for deletion; ADR-count variance run-to-run). The maintainer's design: clone rocketh as input, an answerer agent supplies answers from known repo knowledge, the eval HARD-ERRORS (with the exact question) on anything the answerer cannot fulfil, and it grades structural invariants across runs — an eval that still allows interactive answers. Dogfoods the `work/` contract this very session hardened.
