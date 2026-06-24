---
name: from-idea
disable-model-invocation: true
description: 'The from-scratch ON-RAMP: take a raw project idea and end with a scaffolded work/-contract repo where that idea is captured as a prd in work/prds/ready/, ready to task. The front door that owns the idea-interview and sequences setup (scaffold) then to-prd (synthesize). NOT a prd-producer itself — to-prd is the synthesis primitive it calls; NOT adversarial prd-grilling (that is the separate grilling skill).'
---

# from-idea

**The from-scratch entrance to the main flow.** You have a raw idea ("I want to build X") and want ONE move that ends with a contract-ready repo holding that idea as a prd in `work/prds/ready/`, ready to task. This is **rung A of the prd lifecycle's front door** — the on-ramp that wraps the first two steps of the main flow (`setup` then `to-prd`) and adds the one thing neither does: a thin **interview that turns a raw idea into something prd-worthy**.

It is an **on-ramp** (per `work/SKILL.md`'s taxonomy — a starting situation that generates work, then merges onto the main flow), not a survey-loop. It is a **thin orchestrator**: its entire net-new surface is the idea interview plus two skill invocations in order plus the plumbing between them. Everything else is borrowed.

## What it is NOT (the boundaries that keep it thin)

- **NOT a prd-producer of its own.** `to-prd` writes the prd (it owns the prd shape, the `work/protocol/prd-template.md`, the launch-snapshot banner, the `prds/ready/` target, the two autonomy axes). from-idea is the FRONT DOOR that calls it. Read the two names as a pair: `from-idea` owns the on-ramp (setup + the interview); `to-prd` is the synthesis primitive it hands the conversation to. Do not reimplement any of to-prd here.
- **NOT a scaffolder of its own.** `setup` owns the `work/` skeleton, the `work/protocol/` docs, `CONTEXT.md`, the `.agent-runner.json` `verify`/`prepare` gate, and the empty-vs-populated detection. from-idea CALLS setup; it never hand-rolls a "is this a contract repo?" check or writes `CONTEXT.md` itself (that forks setup's detection and drifts). The one-way direction is fixed: **from-idea calls setup; setup never calls from-idea** (setup stays a focused adoption primitive). setup's empty-repo branch MAY _mention_ from-idea as the next step — a discoverability pointer, never an invocation.
- **NOT adversarial grilling.** Stress-testing a plan/design before building is the personal `grilling` skill's job. from-idea clarifies only enough to be prd-worthy and DEFERS the rest (see the interview floor below). If the user wants the idea grilled, that is a separate move after the prd lands.

## The sequence (honor BOTH human checkpoints; never auto-commit)

```
clarify the idea  →  setup (PLAN → HARD STOP → scaffold)  →  to-prd (write prds/ready/<slug>.md, unstaged)
```

`setup` MUST run first: `to-prd` writes to `work/prds/ready/`, which requires `work/` to exist. The flow has **two natural human checkpoints**, and from-idea honors both:

1. **setup's plan-confirm HARD STOP** — setup presents the proposed description + detected `verify`/`prepare` gate (+ any Phase-B mapping) and STOPS for the user to ratify before writing the judgement-heavy parts. Do NOT bulldoze this; it is a real stop. Let setup own its arc.
2. **The prd landing unstaged in `prds/ready/`** — `to-prd` leaves the file in the working tree for the human to review; it does not stage/commit. from-idea inherits that etiquette: **never stage/commit/push** at any step.

## Step 1 — Clarify the idea (the ONE net-new piece): just enough to be prd-worthy

This is the only doing from-idea adds. Run a SHORT interview to lift the raw idea to the floor a prd needs — no further.

**The interview floor (the stop condition).** Clarify enough that `to-prd` can write a coherent launch snapshot. Borrow to-prd's own spine — a prd-worthy idea has:

- **(a) the problem / intent** — what is this for, what pain or opportunity does it address;
- **(b) the rough shape of success** — what does "it works" look like, who/what uses it, what it integrates with;
- **(c) the obvious seams / constraints** — the highest seams the feature would be tested at, and any hard constraints (stack, platform, external systems) the user already knows.

That is the FLOOR, not "everything resolved." Ask a small number of focused questions (think 2–5, batched), then stop.

**The no-grill / defer rule (do not become a second grilling skill).** Genuine design forks, unknowns, and "we'll decide later" calls are NOT interview rounds — they are recorded by `to-prd` as `needsAnswers: true` with the open questions in the prd body, and DEFERRED. The auto-tasker then refuses to task until a human resolves them. Be honest: a prd flagged `needsAnswers` is the correct output of a real but unresolved idea, far better than over-interviewing to force a false resolution. When in doubt, defer rather than grill. (If the idea is so thin it is barely a wish, say so and offer to capture it as a `notes/ideas/` note instead of pushing it through to a prd.)

**One interview, two consumers.** The answers you gather here feed BOTH downstream skills — do not let them re-ask:

- the one-to-two-sentence **project description** (problem + intent) is what setup's A2 step needs for `CONTEXT.md`;
- the fuller **problem + shape + seams + open questions** is what to-prd synthesizes into the prd.

So you interview ONCE. When setup's A2 asks "what is this repo about?", you already have the description — supply it, do not re-interview (that same-session double-ask is exactly the drift the on-ramp pattern forbids). setup (not from-idea) writes `CONTEXT.md` from that description.

## Step 2 — Run setup (always; let its idempotency decide depth)

**Always invoke `setup`** — do NOT hand-roll a `test -d work/` to decide whether to. setup's A1 already detects empty-vs-populated and does the right thing in each case, and re-running it on an existing contract repo **re-syncs the `work/protocol/` docs** (the one legitimate clobber) so the repo picks up protocol updates. Skipping setup would skip that refresh and fork its detection logic.

- **Empty / new repo (the common from-idea case):** setup does Phase A — scaffolds `work/`, copies `work/protocol/`, writes `CONTEXT.md` (from the description you gathered in step 1) and `.agent-runner.json` (the `verify`/`prepare` gate it detects, presented for confirmation at its HARD STOP). Phase B is empty.
- **Existing contract repo (adding a new idea to a repo already set up):** setup's Phase A is a near-no-op + protocol re-sync; the scaffold already exists. You then go straight to step 3. **Flag the Phase-B-hijack seam:** if the repo is populated with convertible material, be explicit that the intent is "scaffold/refresh and accept a NEW idea", not "migrate everything" — do not let setup's Phase-B conversion hijack the from-idea session. (A new idea is not migration of existing material.)

Honor setup's HARD STOP: present the plan, wait for confirmation, then it scaffolds. Feed it the description from step 1 so its A2 does not re-ask.

## Step 3 — Hand the conversation to to-prd

Once `work/` exists (setup's scaffold confirmed and written), invoke `to-prd`. It synthesizes the SAME conversation you have been having — the idea, the clarifications from step 1, the codebase understanding setup just established — into `work/prds/ready/<slug>.md`:

- to-prd targets **`prds/ready/`** (the auto-task pool) — that is its written target and the goal of this on-ramp. from-idea does NOT route the prd into `prds/proposed/` (staging): there is no grilling/promotion gate here (grilling is scoped out), so the review gate is simply the **unstaged file** a human reviews before tasking. (If a session later wants the idea grilled before it is trusted, that is a separate move — and `prds/proposed/` is where a review-first prd would live — but from-idea's deliberate target is `ready/`.)
- to-prd sets the two autonomy axes from what the interview resolved: `humanOnly` if a human must drive the tasking, and `needsAnswers: true` (with the questions in the body) for everything step 1 deliberately deferred.
- to-prd writes the file UNSTAGED and reports the path. from-idea does not commit it.

## Report + hand off

Tell the user, concisely:

- the repo is now contract-ready (what setup scaffolded / re-synced, the `verify` gate configured);
- the prd written, by path — `work/prds/ready/<slug>.md` — left UNSTAGED for review, plus any `needsAnswers` questions it carries that a human must resolve before tasking;
- **what's next on the main flow:** review the prd, then task it with `to-task` (or `agent-runner do prd:<slug>` once the runner is installed and the prd is agent-safe). If the idea has real design forks worth pressure-testing first, point at the `grilling` skill — explicitly NOT part of this on-ramp.

**Git etiquette:** never stage, commit, or push — leave both setup's scaffold and to-prd's prd in the working tree for the user to inspect and commit (the producer-skill convention setup and to-prd both follow).

## Boundary (what from-idea does NOT do)

- It does NOT reimplement detection (setup A1), the gate (setup A3/A3b), `CONTEXT.md` (setup A2), the prd shape / banner / target (to-prd + `prd-template.md`). Its only net-new surface is the idea interview + ordering the two calls + feeding the description to setup.
- It does NOT grill the idea adversarially (the `grilling` skill), force-resolve genuine unknowns (they become `needsAnswers`), or push a barely-a-wish idea onto the prd board (offer `notes/ideas/` instead).
- It is NOT called BY setup (one-way: from-idea → setup). setup may _mention_ it; it never invokes it.
- It NEVER auto-commits, and it never bulldozes setup's plan-confirm HARD STOP.
