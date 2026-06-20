---
name: setup
description: "The ONE skill to onboard ANY repo onto the file-based work/ contract (the protocol agent-runner consumes); it auto-detects repo state and does the right DEPTH. Empty/near-empty repo: just scaffolds (work/ skeleton — notes/tasks/briefs/questions/protocol — work/protocol/ docs verbatim, CONTEXT.md, stack-appropriate .agent-runner.json verify gate + a detected/asked prepare env-prep step) after a short adoption chat. Populated/legacy repo: ALSO converts existing material — task tracker/TODOs/design docs into briefs, tasks, or ideas (a vague wish is an idea, NOT a needsAnswers task); codebase split by polarity (EXTERNAL behaviour it integrates with into work/notes/findings/ with provenance, our own code's shape into CONTEXT.md/docs — NOT findings); decisions into ADRs by ELICITING the why from the human (asked live, NEVER inferred; no why, no ADR). Always presents an inventory + plan and STOPS for confirmation before judgement-heavy writes. Never clobbers or auto-commits. Use to set up / adopt / onboard / migrate a repo to the work/ contract or agent-runner — empty or full, the single entry point."
---

# setup

The **single skill to onboard a repo** onto the **`work/` contract** — the runner-agnostic, file-based protocol (defined in `protocol/WORK-CONTRACT.md`, which setup OWNS and copies into each target repo's `work/protocol/`) that `agent-runner` consumes. This is the **adopt-the-contract** step (a SKILL, not a command, per `docs/adr/command-surface-and-journeys.md` §8 — adoption must NOT require installing `agent-runner`; the contract is the protocol, the runner is one consumer).

**One skill, two phases, auto-detected depth.** setup always does **Phase A — Scaffold** (deterministic; the `work/` skeleton, the protocol docs, `CONTEXT.md`, the `.agent-runner.json` gate). If it then detects **existing material to convert** (a task tracker, design docs, substantial source), it ALSO does **Phase B — Convert** (judgement-heavy; map that material onto the contract's buckets, hunt decisions, elicit ADRs). On an empty/near-empty repo, Phase B is simply empty and setup finishes after Phase A. The user never has to choose "scaffold vs migrate" — setup figures out the depth.

> **Where the contract docs live:** setup copies the protocol reference docs into the target repo's **`work/protocol/`** (`WORK-CONTRACT.md`, `ADR-FORMAT.md`, `task-template.md`, `brief-template.md`, `CLAIM-PROTOCOL.md`). Every bare "WORK-CONTRACT" / "ADR-FORMAT" mention below refers to `work/protocol/<doc>` in the repo you are setting up — read them there, not from a sibling skill folder.

## The unified shape: detect → PLAN → **STOP for confirmation** → write

Whatever the depth, setup follows the same arc, and the **plan-then-confirm step is a HARD STOP, not a narrated aside**:

1. **Inventory** the repo (read-only).
2. **Present a plan** — the proposed description + detected `verify` gate, AND (if material exists) the inventory→bucket mapping table.
3. **STOP and wait for the user to confirm/correct.** Do NOT proceed to write the judgement-heavy parts in the same turn you present the plan. Showing the plan and continuing is the single most common failure — the user must get a turn to ratify the mapping and the gate before anything is converted. (Phase-A scaffolding of the deterministic skeleton may proceed once the description+gate are confirmed; Phase-B conversion waits for the mapping to be confirmed.)
4. **Write** (create-only, never clobber), run the gate once, report, hand off.

## The one discipline that matters most (Phase B): an ADR is written IFF we have the WHY — else write nothing; the code is the pre-ADR

An **ADR** (`docs/adr/`) records a **DECISION + its why** — the rejected options, the constraints, the reasoning. The _why_ is **usually NOT recoverable from code or docs**; the _what_ (the decision the code embodies) often IS. Reverse-engineering a codebase yields **description / ground-truth**, not a rationale. So the rule is simple and absolute:

- **Write an ADR if and ONLY if you have a complete, clear decision — the _what_ AND a real _why_.** The only legitimate source of the why is the **human**.
- When you spot something that LOOKS like a decision (a design doc or the code reveals "we chose X over Y") AND it is **ADR-worthy** — all three of _hard to reverse_ AND _surprising without context_ (a future reader would wonder "why on earth this way?") AND _the result of a real trade-off_ (there were genuine alternatives) — **ASK the user, during the run: "Why was this done? What were the alternatives and constraints?"** If they answer, write a **complete ADR in `docs/adr/`** from THAT answer (`work/protocol/ADR-FORMAT.md` shape: `NNNN-slug.md`, one decision per file, 1–3 sentences of context/decision/why). The why came from the human, so the record is honest.
- **If the user is absent, declines, or does not know the why — write NOTHING.** No `proposed`/pre-ADR, no `docs/adr/candidates/` folder, no holding doc, no candidate-flag, no question-list file. The **code itself remains the pre-ADR**: it already embodies the decision, is always current, and re-surfaces the same "why is this so?" question to the next reader who cares — who can then ask a human and record the answer as an ADR. A stored "open question" artifact nobody maintains would just rot; the absence of one is the feature.
- **Non-negotiable.** NEVER write an ADR whose _why_ you inferred from code — a fabricated rationale corrupts the decision record silently. No why from a human → no ADR.

## Phase A — Scaffold (always)

### A1. Detect the repo state (works empty OR populated — NEVER clobber)

`ls`/glob the repo first. For EACH artifact setup would write, if it ALREADY exists, do NOT overwrite — report it and leave it (or, for `.agent-runner.json` / `CONTEXT.md`, offer to MERGE-in only the missing keys/sections). Only CREATE what is missing. This is what makes setup safe to run on a populated repo and idempotent to re-run.

- If `work/` already has the folders → skip them. **If `work/` is on the LEGACY FLAT layout** (top-level `backlog/` / `prd/` / `observations/` / … instead of the `notes/` / `tasks/` / `briefs/` umbrellas) → do NOT silently scaffold a second, parallel tree beside it; surface it and offer the documented migration mapping (see A5b).
- **`work/protocol/` is the ONE exception to never-clobber — it is protocol-owned, not repo-owned.** The repo's `work/` _items_ (tasks/briefs/notes) are sacred and never touched; but the `work/protocol/` reference docs are verbatim copies setup owns, so re-running setup **re-syncs** them (overwrite with the current canonical copies + bump `work/protocol/VERSION`). This is how a repo picks up protocol updates. Never hand-edit `work/protocol/<doc>` in a target repo — edits belong in setup's canonical `protocol/` source and propagate via re-sync.
- If `CONTEXT.md` exists → do not overwrite; offer to APPEND a "domain terms" section if absent, else leave it.
- If `.agent-runner.json` exists → do not overwrite; report its `verify`/`harness` and offer to fill only ABSENT keys.
- **Detect Phase B material — do NOT skip dotfolders that might hold meaningful content.** While inventorying, note any **convertible material**: a `tasks/` folder, a `TODO.md`, an issue-tracker export, `docs/` design notes / RFCs, plan files, and **substantial source code** (code that embodies decisions). A plain `ls` of the visible top level is NOT enough: a hidden (dot-prefixed) folder can hold real sources (design docs, plans, tasks, notes), and a missed source is silently under-routed (a rich design doc that should be a brief never gets seen). So look inside dotfolders too, and judge each by whether it _could plausibly contain documents/plans/notes_ worth converting. **Skip only the noise** — `.git/`, `node_modules/` and other dependency dirs, build output, and anything `.gitignore`d are never sources. This detection decides whether Phase B runs (see A4 / Phase B). A repo with only a README that says "clean slate" (or nothing) → Phase B is empty; finish after Phase A.

### A2. The adoption conversation (seed CONTEXT.md — keep it short)

Derive the **project name** from the repo (folder/remote name) for the CONTEXT title.

- **Empty/near-empty repo (no material to read):** you have nothing to propose, so ASK: **"What is this repo about? (one or two sentences — or skip and I'll scaffold a stub you fill in later.)"** If they describe it, put it in `CONTEXT.md`'s "What <repo> is" and ask 1–3 **refining** questions to seed the glossary (core domain nouns, actors, what it integrates with). If they say nothing/"skip", scaffold `CONTEXT.md` with a `<!-- TODO: describe the project -->` stub + placeholder glossary entries — don't block; the repo is still fully set up.
- **Populated repo (you read it in A1):** do NOT cold-open. Form a **proposed one-to-two-sentence description** (+ core domain nouns) from the README/docs/code, and CONFIRM it: **"Here is what I think this repo is: <proposed description>. Correct/refine, or accept?"** The human still ratifies; you just spare them a blank prompt. (This confirmation is part of the PLAN you present at A4.)

**Nudge for a per-change convention (language-agnostic — never tool-specific).** Many repos require something extra on every change: a changeset, a `CHANGELOG` entry, a news fragment, etc. setup does NOT detect or assume any of these — there is no generic signal and guessing one (e.g. keying off `.changeset/`) would smuggle ecosystem favouritism into a deliberately language-agnostic skill (the A3 rule). Instead, ASK once, generically: **"Any standing per-change rule agents must follow in this repo — e.g. a changeset, a CHANGELOG entry, a news fragment? I'll note it under `## Conventions` in CONTEXT.md."** If they give one, record it in the CONTEXT.md `## Conventions` section (fold this into the A4 plan, do NOT make it a separate question round); if they skip, leave the commented stub. Mention the homes a convention can live in: **CONTEXT.md** (the in-band slot agents read), **their own agent config** (e.g. an `AGENTS.md` their harness reads), and — if they want it _enforced_ rather than merely stated — **their own check wired into the `verify` gate** (their command, e.g. `changeset status --since=main`; setup never injects one, per A3 — it only points out that `verify` is where enforcement would go).

### A3. Discover the real `verify` gate FROM THE REPO (detect, never assume)

The `.agent-runner.json` `verify` gate is the protocol's per-project, **language-agnostic** acceptance gate (build + test + format/lint, all green). The single rule: **discover the gate from THIS repo; never write a canned, stack-shaped guess.**

**Two shape rules for the gate you write (independent of which stack):**

- **Cheapest checks FIRST, for fail-fast.** Order the gate so the quick, deterministic checks run before the expensive ones: **format/lint → typecheck/build → test**. A formatting nit should fail in seconds, not after a full build+test. So prefer `pnpm format:check && pnpm build && pnpm test` over `… && pnpm test && pnpm format:check`.
- **The gate is ACCEPTANCE, not environment-prep.** Do NOT bake dependency install / submodule fetch / codegen into `verify` (e.g. do not write `pnpm install --ignore-scripts && …` even if CI does it as a separate step). `verify` answers "is the working tree green?", assuming deps are already present. **Install now has a sanctioned home: the sibling `prepare` field** (see A3b) — the runner runs `prepare` ONCE before the first `verify` on a fresh worktree. So **MOVE any install/bootstrap prefix CI wraps around its build/test steps into `prepare`, do not delete it**: keep `verify` to the build/test/lint commands themselves, and put the install/submodule/codegen step in `prepare`. The clean split is **`prepare` = env-ready, `verify` = tree-green.**

The built-in fallback happens to be Node-shaped, which is SILENTLY WRONG for any other stack — so do not rely on it, and do not swing the other way and template a language's "usual" command blind. The protocol names no toolchain; neither should the gate you write. Find what THIS repo actually uses, in this order of reliability:

1. **CI is the most reliable source — read it first.** `.github/workflows/*.yml` (or other CI config): the build/test/lint/fmt steps it runs ARE the project's real acceptance commands. (A workflow running `cargo build` then `cargo test` tells you the gate directly — even if the repo also has a `package.json`.)
2. **Then the project's own task runner / declared scripts.** Read the actual commands, do not assume their shape: a `package.json` `scripts` block (use the REAL `build`/`test`/`format:check` scripts as written — they may wrap a monorepo tool or an env loader, so a blind per-package flag would BYPASS them), a `Makefile`/`justfile`/`Taskfile`, `pyproject.toml` `[tool.*]` / tox, a `composer.json`, etc.
3. **Only then infer from the manifest — as a HINT to confirm, not an answer to write.** A manifest tells you the ecosystem, not the gate. `Cargo.toml` ⇒ likely `cargo build && cargo test && cargo fmt --check`; `go.mod` ⇒ `go build ./... && go test ./... && gofmt -l .`; a Node manifest ⇒ read its scripts (do NOT assume a workspace/recursive flag). Treat these as starting guesses to verify against (1)/(2), never as the final command.

**Multiple manifests is normal — pick the gate, not the first file that matched.** Many repos carry several (e.g. a Rust crate that also ships an npm install-wrapper `package.json` with no build/test scripts; a Solidity repo with `foundry.toml` + a Node manifest + nested crates). Do NOT key off "a manifest exists"; identify the PRIMARY build/test toolchain (CI usually settles it) and, for a genuinely mixed repo, compose the gate (e.g. `forge build && forge test && cargo test && …`). A wrapper manifest with no real scripts is a decoy — ignore it.

If you cannot determine it, **leave `verify` with a `TODO` comment and ASK the user** for the exact build/test/lint command — never invent one. The final gate is part of the PLAN you present at A4 and must be CONFIRMED (one line) before you write it: a wrong `verify` gate is the one scaffolding mistake that bites later.

### A3b. Detect (or ASK for) the `prepare` env-prep step — the sibling of `verify`

`prepare` is the protocol's per-repo **env-prep / install** step: the runner runs it ONCE before the FIRST `verify` on a freshly-materialised worktree (a fresh clone/worktree off the hub mirror has no `node_modules` / submodules / generated code, so `verify` would fail for lack of deps). It is **deliberately distinct from — and NOT baked into — `verify`** (`prepare` = env-ready; `verify` = tree-green), so the gate stays a pure, cheaply-re-runnable acceptance check. It is the home the "strip install from `verify`" rule (A3) points install AT.

**DETECT a likely `prepare` from THIS repo (same detect-never-assume discipline as A3), then SET it or ASK to confirm:**

- **A lockfile ⇒ the matching install.** `pnpm-lock.yaml` ⇒ `pnpm install`; `package-lock.json` ⇒ `npm ci`; `yarn.lock` ⇒ `yarn install --frozen-lockfile`; `Cargo.lock` is fetched by the build (often no separate step); `go.sum` ⇒ usually none (the build fetches). Read the REAL install CI uses (the install prefix you stripped from `verify` in A3 is exactly what belongs here).
- **Submodules ⇒ `git submodule update --init --recursive`** (if `.gitmodules` exists).
- **A codegen step ⇒ include it** (e.g. a `prebuild`/`codegen` script CI runs before build).
- **Compose** when more than one applies (e.g. `git submodule update --init && pnpm install`), as an ordered list or a `&&` chain (all must pass), exactly like `verify`.

**Unset is a valid answer — do NOT invent a default.** A repo with no deps to install needs NO `prepare`: leave the field absent (unset ⇒ a no-op; the runner installs nothing). Never write a default `pnpm install` into a repo that has no lockfile. If you detect a likely command, propose it in the A4 plan for one-line confirmation; if you are unsure whether the repo needs env-prep at all, ASK rather than guess. `prepare` is part of the PLAN you present at A4 alongside `verify`.

### A4. Present the PLAN and STOP for confirmation (the hard checkpoint)

Present, in one message:

- the **proposed description** (A2) — "correct/refine or accept?";
- the **detected `verify` gate** (A3) — "confirm?";
- the **detected `prepare` env-prep step** (A3b), if any — "confirm?" (or "none needed?" when the repo has no deps to install);
- **IF Phase-B material was detected (A1): the inventory → bucket mapping table** (see B1) — "is this routing right?".

Then **STOP and WAIT for the user's reply.** Do not write `CONTEXT.md`/`.agent-runner.json` with an unconfirmed description/gate, and do not start Phase-B conversion, until they answer. (You MAY create the deterministic skeleton — empty `work/` folders + `work/protocol/` copies — without waiting, since those are content-free; but anything carrying judgement waits.) Narrating "I'll show the plan first" and then barrelling ahead in the same turn defeats the checkpoint — the STOP is real.

### A5. Write the scaffold (create-only) + run the gate once

Once description + gate are confirmed: create the missing `work/` folders in the **regime-umbrella layout** — NOT a legacy flat tree. Create the folders setup actually populates (the capture buckets it writes notes into, the staging/pool folders, `questions/`, `protocol/`); the empty TERMINAL/status sub-folders (`tasks/done`, `tasks/cancelled`, `briefs/tasked`, `briefs/dropped`) do NOT need eager creation with a `.gitkeep` — they are created LAZILY on first use (whoever first `git mv`s an item into them makes the dir; `git mv` auto-creates the destination, and the runner `mkdir`s on demand where it writes). An absent empty status folder is NOT a broken contract. The full intended tree, for reference:

```
work/
  notes/{observations,ideas,findings}/   # capture buckets (do not flow; leave by deletion)
  tasks/{backlog,todo,done,cancelled}/    # the build board: backlog=staging, todo=pool, done, cancelled=terminal
  briefs/{proposed,ready,tasked,dropped}/ # brief lifecycle: proposed=staging, ready=pool, tasked, dropped=terminal
  questions/                              # the "what needs me?" queue (TOP-LEVEL, not under notes/)
  protocol/                               # the propagated protocol docs (copied below)
```

The two won't-proceed terminals are deliberately named DIFFERENTLY per regime (`tasks/cancelled/` vs `briefs/dropped/`) — a slug-collision correctness fix (a dropped task and a dropped brief sharing a slug must not collide on one bare-slug path); see `work/protocol/WORK-CONTRACT.md`. Then **copy the protocol docs verbatim into `work/protocol/`** from this skill's `protocol/` directory (`WORK-CONTRACT.md`, `CLAIM-PROTOCOL.md`, `task-template.md`, `brief-template.md`, `ADR-FORMAT.md`) and write `work/protocol/VERSION` — creating them if absent, RE-SYNCING (overwriting) them if present (protocol-owned, per A1); write `CONTEXT.md` and `.agent-runner.json` if absent (or merge-in missing keys per A1).

**Run the gate ONCE and report (catch a wrong `verify` immediately).** After writing `.agent-runner.json`, actually EXECUTE the `verify` command once and report green/red — the cheapest moment to discover the gate is wrong (a typo, a missing script, deps not installed), instead of at first build. If red, say WHY (e.g. "`format:check` failed — run `format` first" / "`build` needs deps installed") and offer to adjust the gate or note the prep step; do NOT silently leave a red gate. (Deps clearly not installed = the env-prep gap — that is what the `prepare` field is FOR: put the install in `prepare` (A3b), do NOT contort `verify` to hide it.)

If **no Phase-B material** was detected, skip to **Report + hand off**. Otherwise continue to Phase B.

### A5b. Migrating a repo already on the LEGACY FLAT layout (old → new `git mv` mapping)

A repo set up under an earlier protocol version has a FLAT `work/` (top-level `backlog/`, `prd/`, `observations/`, …). Do NOT scaffold a second tree beside it — MIGRATE it with `git mv` (renames preserve history). The mapping is documented and mechanical:

```
work/observations/   -> work/notes/observations/
work/ideas/          -> work/notes/ideas/
work/findings/       -> work/notes/findings/
work/pre-backlog/    -> work/tasks/backlog/        # staging takes the freed name
work/backlog/        -> work/tasks/todo/           # the pool keeps being the pool, new name
work/in-progress/    -> (GONE: transient status is now a per-item lock ref, not a folder)
work/done/           -> work/tasks/done/
work/pre-prd/        -> work/briefs/proposed/
work/prd/            -> work/briefs/ready/
work/prd-sliced/     -> work/briefs/tasked/
work/questions/      -> work/questions/            # unchanged (stays top-level)
work/protocol/       -> work/protocol/             # re-synced (overwritten), not moved
# The old SHARED terminal work/dropped/ is SPLIT per regime (the slug-collision fix):
#   a dropped TASK   -> work/tasks/cancelled/<slug>.md
#   a dropped BRIEF  -> work/briefs/dropped/<slug>.md
#   a dropped OBSERVATION needs no terminal (notes leave by deletion) -> git rm
```

Do the moves with `git mv` so each rename is staged as a rename; sort the old `work/dropped/` contents by what each item IS (task vs brief vs observation) into the right destination. Present this mapping and STOP for confirmation (it touches the repo's live ledger); never auto-run it. The vocabulary cutover (`prd:`→`brief:`, `sliceAfter:`→`briefAfter:` frontmatter; `do prd:`/`do slice:`→`do brief:`/`do task:`) is a SEPARATE in-code concern owned by the runner, not setup's scaffold.

## Phase B — Convert existing material (only when material was detected)

Phase B fills the scaffolded buckets from what already exists. COMPOSE the producer skills — do NOT reimplement slicing/brief-writing (`to-brief`/`to-task` own those shapes). The mapping table was already presented and CONFIRMED at A4; now execute it.

### B1. Inventory → mapping (the table presented at A4)

Classify each source by what it should BECOME (this is the table you showed at A4):

- **A task/issue system** — `tasks/`, `TODO.md`, an issue export, GitHub issues. Route each by _how buildable it actually is_, NOT by default to a task (the common mistake — see the buildability gate in B2):
  - a **scoped, buildable** ask → a **task** (one ask, one task);
  - a **coherent ask needing >1 task** (a shared vision) → a **brief**;
  - a **wish / "maybe" / blocked-on-external / one-line sketch** → an **idea**, NOT a task. A vague TODO line is an `idea`, not a `needsAnswers` task.
- **Design docs / RFCs / architecture notes** — is it a north-star plan (→ **brief** or **idea**), a decision-with-rationale (→ if it carries a real _why_, it may seed an **ADR**; if the _why_ is absent, ASK the user — answered → ADR, else write nothing), or a description of how something works (→ split by polarity: _external_ behaviour → **finding** with a `source:`; _our own_ code's shape → **`CONTEXT.md` / `docs/`**, never `findings/`)?
- **READMEs / wikis / inline docs** — domain vocabulary → seed/extend `CONTEXT.md`'s glossary; how-our-code-works → **`CONTEXT.md` / `docs/`**; how-an-external-thing-works → **finding** (with `source:`).
- **The source code itself** — B3 (generate understanding **and hunt decisions**): description of OUR code → **`CONTEXT.md` / `docs/`**; _external behaviour our code integrates with_ → a **finding** (with `source:`); AND — separately and always — the **deliberate decisions** the code embodies → B3b actively hunts these and asks the user (→ ADRs). Do not forget the decision hunt; it is the highest-value output and the easiest to skip.
- **Loose "we should…" / "known issue" notes** → **ideas** (proposed) or **observations** (spotted, unverified).

**CONVERGE sources that describe the SAME thing into ONE item — do not create one item per source.** Two different sources often point at the same feature (e.g. a one-line entry in a task list AND a detailed design doc elsewhere are the same ask at two fidelities). When that happens, produce a **single** item at the richest appropriate fidelity (here, the design doc → a brief) and route the thinner source INTO it — do NOT also emit a separate idea/task for the thin source that merely re-describes the same feature. One feature → one item. (A cross-reference stub that says "see the brief" is still a redundant second item — fold the thin source's content into the one item instead.) The same applies across buckets: do not let one decision become both an ADR and an observation, or one ask become both a brief and an idea.

### B2. Convert the task/work system → briefs + tasks + ideas

- A single, clear, buildable ask → a **`work/tasks/backlog/<slug>.md`** task (`to-task`' task shape; `covers: []`, no `brief:` — its own source of truth).
- A coherent ask needing >1 task → a **`work/briefs/ready/<slug>.md`** brief (`to-brief`'s framing). Slice it only if asked; usually leave the brief for the human to slice.
- **Buildability gate — decide task-vs-idea BEFORE writing anything to the task board.** A `tasks/backlog/` task is for a **scoped, buildable** ask. `needsAnswers: true` is for a **near-complete spec with a few SPECIFIC open questions listed in the body** — _almost a task_, not a wish. A vague one-liner is NEITHER a task nor a `needsAnswers` task — it is an **`idea`**. The contract is explicit: _under-specified items should not be written into the task board until they are ready_. **When in doubt → `notes/ideas/`, not `tasks/backlog/`.** Do NOT manufacture a `needsAnswers` task to "capture" a wish.
- **Set the two gate axes honestly** (WORK-CONTRACT §3b), once the item really is a task: `humanOnly: true` where building needs human judgement/security; `needsAnswers: true` where the spec is _near-complete but has specific listed open questions_ (NOT merely vague — that is an `idea`).
- **Task ↔ brief link:** a self-contained task (chore/refactor/build-fix, no brief stories) carries `covers: []` and **omits `brief:`**. A task pointing into a brief's stories MUST set `covers: [...]` AND name that brief in `brief:` (`brief` required iff `covers` non-empty). Do not invent a `brief:` for a task deriving from no brief.
- Content-derived slugs, never counters. Preserve any traceability (e.g. an `issue: N` link on a brief).

### B3. Understand the code — split by POLARITY, AND actively hunt decisions

TWO obligations, easy to conflate. Do NOT collapse this into "process the how-it-works material I happen to have" (e.g. turning a review doc into observations and stopping) — that silently skips the decision hunt, the single highest-value output. Do BOTH:

**(B3a) Route understanding by POLARITY** — because describing our OWN code in `findings/` corrupts the bucket (findings = _external_ ground-truth, and our code changes so it would rot with no status-flow to retire it):

- **Our own code's shape** (package layout, module seams, internal conventions, dependency flow) → **`CONTEXT.md`** (vocabulary) and/or a **`docs/architecture.md`** overview. NOT a finding. The code is its own current-truth source.
- **External/domain ground-truth our code integrates with** (a third-party API's real behaviour, a wire/artifact format, an EIP/spec, an external tool's contract) → a **`work/notes/findings/<slug>.md`**, which **MUST carry a `source:` (provenance)** (WORK-CONTRACT findings box + frontmatter): how, and how _currently_, you came to believe it. A finding _derived from reading our own code_ records `source:` = that file (+ commit) and is the **weakest** provenance — SAY so ("derived from <file> @ <commit>") so a later "our code was buggy" can revise it. Prefer upgrading to a dated external authority or a captured trace. (No separate `confidence:` field — a rich, dated `source:` carries the weight.)
- Keep verified ground-truth in `findings/` (with `source:`); keep speculation / spotted-but-unverified concerns in `observations/`.

**(B3b) HUNT for ADR-worthy decisions — a REQUIRED, distinct sub-pass, not a side effect of B3a.** Deliberately READ the primary source (and design docs / comments) _looking for choices_, not just structure. The fact that a piece of code IS a deliberate choice almost never announces itself; ask of the code, repeatedly: **"is this the way it is because someone DECIDED it, against a real alternative, for a reason a future reader couldn't reconstruct?"** Apply the bar (hard to reverse + surprising without context + a real trade-off). Candidates are wherever the code does something a competent reader would NOT assume by default and would later wonder "why this way?" — anything intentional-but-unexplained is a candidate; do not pre-filter to a known shape.

- For each candidate clearing the bar: **ASK the user the _why_**. If they answer → write a complete ADR in `docs/adr/`. If absent/unsure/decline → **write NOTHING** (the discipline above). Never author an ADR whose why you inferred.
- This sub-pass MUST run whenever Phase B touches source code. If you scanned and genuinely found no ADR-worthy decision, that is a fine outcome — but you must have _actively looked_ and be able to say what you scanned (B-report checkpoint). "I produced no ADRs" is only acceptable after a real hunt, never as a side effect of skipping it.

## Report + hand off (no auto-commit)

Phase B finishes with TWO mandatory checkpoints (a flat report bullet is too easy to skip — these are the two steps runs most often forget, so treat each as a gate you must consciously clear):

- **CHECKPOINT 1 — Decision-hunt (if Phase B ran on code): you cannot finish without accounting for B3b.** State explicitly: either (a) the ADR-worthy decisions you found and the _why_ you asked about (→ the ADRs written), or (b) that you ACTIVELY scanned and found none worth an ADR — and **name what you scanned** (which packages/files/areas) so "no ADRs" is visibly a real hunt's result. Reaching here having never asked the user a single _why_ about a code decision is a RED FLAG you skipped B3b — go do the hunt before reporting.
- **CHECKPOINT 2 — Source-cleanup: for EVERY source you fully converted, you MUST explicitly propose deleting it (with confirmation) before finishing.** Once a source (`TODO.md`, a tracker folder, a plan doc — including ones in dotfolders — a design note) is _fully_ captured into `work/` items, leaving the original creates **two sources of truth that drift**. So enumerate each fully-converted source and ASK to delete it ("<source> is now captured in <where> — delete it?"). This is not optional and not a side note: a run that converts sources but never proposes their cleanup has left the repo with dual truth. Only delete on explicit user confirmation; never `rm` on your own initiative; never propose deleting a source you only _partially_ converted (say what's left); if the user declines, leave them and note they are superseded. Reaching the end having converted ≥1 source but proposed deleting NONE is a RED FLAG you skipped this checkpoint.
  - **Make the cleanup confirmation UNAMBIGUOUS — because deletion is destructive.** Present the cleanup prompt as its OWN clearly-labelled, explicitly-numbered list (e.g. "Delete? **1.** `<source-a>` **2.** `<source-b>`…"), and do NOT put any OTHER numbered list (e.g. a "Next steps 1/2/3") in the same message — a bare `1. yes / 2. no` reply must map to exactly ONE thing. If the user's reply is at all ambiguous about WHICH sources to delete (or you co-mingled it with another numbered list), do NOT guess and `rm` — re-state "to confirm: delete A, keep B?" and wait. A wrong guess here irreversibly deletes a file the user wanted kept. Prefer making cleanup the LAST interaction, after the final report, so nothing competes with it.
- **Resolve the ADR asks before finishing.** Batch any still-unasked _why_ questions into a single round rather than interrupting repeatedly. Write a complete ADR per _why_ the user supplies; for each they cannot/will not answer, write **NOTHING**. (Mention the un-answered ones in the report; persist no file for them.)
- **REPORT** every path written/created, re-synced, and every repo-owned file left untouched — grouped by bucket — plus anything left as `needsAnswers`/`observations`/`ideas`, and (ephemerally, report-only) any ADR-worthy decisions whose _why_ went un-answered. Note any `findings/` whose `source:` is code-derived (weakest provenance) so the human knows to verify them. Report the gate-run result (green/red).
- **Update `CONTEXT.md` to reflect what was populated:** fold domain vocabulary into the glossary; note which buckets this repo now uses, precise about polarity (`notes/findings/` = **external** ground-truth with sources; our own architecture in `CONTEXT.md`/`docs/`; open questions in `notes/ideas/` (vague) or `needsAnswers` tasks (near-spec)). Do NOT write "this repo carries reverse-engineered `findings/` about our code" — the polarity mistake B3 exists to prevent. Append/merge only; never clobber.
- **NEVER enumerate individual items in `CONTEXT.md` (no index files — the FOLDER is the index).** Describe _that_ the repo has ADRs / briefs / observations and what they are FOR; do NOT list them one by one (e.g. not "`0001` (…), `0002` (…)"). A hand-maintained list goes stale the moment one is added/removed/superseded — and `docs/adr/` (the folder) already IS the canonical, always-current index (WORK-CONTRACT rule 2: no shared index/manifest; derive lists with `ls`). Applies to every bucket. (FINE and distinct: cross-referencing ONE specific ADR as a glossary term's authority — "the X seam (`docs/adr/x.md`)" — that points a term at its source of truth; the ban is on the _list_, not a pointed cross-reference.)
- **Hand off:** tell the user the repo is contract-ready and what's next — write a brief (`to-brief`), slice it into tasks (`to-task`), or build with `agent-runner do` (if the runner is installed — note the `harness`/`verify` configured).
- **Git etiquette:** do NOT stage/commit/push — leave everything in the working tree for the user to inspect and commit (the `to-brief`/`to-task` producer convention). For a big repo, Phase B is iterative: bound each run to a subset (one source area at a time), report, let the human review, run again.

## Boundary (what setup does NOT do)

- It does NOT install or require `agent-runner` (the contract is runner-agnostic).
- It does NOT register an arbiter / configure CI (those are runner/CI concerns).
- It does NOT BUILD or claim work (that is the runner). A converted task is just another `tasks/todo/` (or staged `tasks/backlog/`) item the engine then advances.
- It NEVER writes an ADR whose _why_ it inferred from code (the discipline above); NEVER puts a description of our own code in `findings/` (that is `CONTEXT.md`/`docs/`); NEVER writes a vague wish into the task board `tasks/backlog/` (that is an `idea`); NEVER enumerates items into `CONTEXT.md` (the folder is the index); NEVER auto-commits or silently deletes.

## Templates

### `CONTEXT.md`

```md
# CONTEXT — <project> domain language

The domain glossary for `<project>`. Agents and skills use THIS vocabulary when naming modules, tests, and discussing the system. Architectural rationale lives in `docs/adr/` (decisions); product framing lives in `work/briefs/`.

## What <project> is

<the user's one-to-two-sentence description, or: <!-- TODO: describe the project --> >

## Core domain terms

- **<term>** — <meaning> (seeded from the adoption conversation; refine as you go).
- **work/ contract** — the on-disk system this repo uses, defined by the reference docs in **`work/protocol/`** (copied here by `setup`): `WORK-CONTRACT.md` (the contract), `CLAIM-PROTOCOL.md`, `task-template.md`, `brief-template.md`, `ADR-FORMAT.md`. Three REGIME umbrellas — `notes/` (capture buckets), `tasks/` (the build board), `briefs/` (the brief lifecycle) — plus top-level `questions/` and `protocol/`. One markdown file per item, status = the folder it lives in (never a field). Capture buckets: `notes/ideas/` (proposed), `notes/observations/` (spotted, unverified, append-only), `notes/findings/` (verified external/domain ground truth, each with a `source:`). ADRs (`docs/adr/`, format in `work/protocol/ADR-FORMAT.md`) record what WE decided and why.

## Conventions

Standing per-change rules agents must follow in this repo.

<!-- e.g. "Every change requires a changeset (`pnpm changeset`)" / a CHANGELOG fragment / a news entry. Add yours here, or delete this section. For enforcement, wire your own check into the `.agent-runner.json` `verify` gate. -->

## Skills this repo uses

- Required: `setup` (onboarding/migration), `to-brief`, `to-task`.
- Recommended: `review`, `grill-me`.
```

### `.agent-runner.json`

```json
{
	"prepare": "<install/env-prep from A3b, or OMIT if the repo has no deps>",
	"verify": "<stack-appropriate command from A3>",
	"harness": "pi",
	"autoBuild": false,
	"autoSlice": false
}
```

> `prepare` — the env-prep / install step the runner runs ONCE before the first `verify` on a fresh worktree (install deps / submodules / codegen, from A3b). The sibling of `verify`, NOT baked into it (`prepare` = env-ready, `verify` = tree-green). **OMIT it entirely if the repo has no deps to install** (unset ⇒ a no-op; never write a default `pnpm install` into a repo with no lockfile). `verify` — the acceptance gate (set it correctly for the stack; cheap-first; no install/env-prep — that lives in `prepare`). `harness` — the agent adapter (`pi`, or `null` + `agentCmd` for a shell agent). `autoBuild` / `autoSlice` — strict-by-default (off; `autoBuild` is the build-gate, renamed from the now-removed `allowAgents`, which has no alias). `noPR` — the PR-INTENT axis (default off = "open a PR"): set `true` (or pass `--no-pr`) to push the branch but deliberately SKIP the review request even on an authed GitHub arbiter (the explicit suppress-PR intent). The review-request PROVIDER itself is NOT a config key — it is purely arbiter-derived (a GitHub remote ⇒ the GitHub provider, else push-only), with the identity's `providers.github` / ambient `gh` auth deciding whether `gh` can open the PR; there is no `provider`/`--provider` override. Add `defaultArbiter`, `integration`, `noPR`, `model` only as the repo needs them.

```

```
