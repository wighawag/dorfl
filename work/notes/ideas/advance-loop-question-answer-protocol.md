---
title: advance-loop — a question/answer protocol + a generalized "advance any work/ item one lifecycle rung" capability (advance verb), driven one-shot (do/CI) AND looped (run), human-or-agent per repo-config
slug: advance-loop-question-answer-protocol
type: idea
status: incubating
---

# advance-loop: turn a set of PRDs into shipped product, with the only human work being to answer questions

> Captured 2026-06-07 from a design conversation; hardened the same day by a full grilling pass (every major seam RESOLVED; one PRD-time byte-detail remains). The unification of three things that already exist separately: the `batch-qa` step-function (the lifecycle rungs), the `run`/`do` execution machinery (one-shot tick + loop + isolation + CAS), and the `auto-slice` family (`do prd:<slug>` already generalized `do` beyond building). NOT built; PRD-ready. Names (`advance`, `obs:`, the repo-config key) are placeholders.
>
> Reading order: vision → core idea → command surface → execution (the tick) → the two artifacts the rest depends on (the question SIDECAR, then the tick STATE MACHINE) → the rungs/mechanics that use them (triage, lock model, classify→lock→ execute, per-type transitions) → the contract+repo-config → batch-qa refactor → CI shape → termination → remaining detail → sequencing.

> RELATED FRONTEND (2026-06-07): `work/ideas/chat-driven-idea-to-product.md` is a chat-based web app that RENDERS this engine's question/answer sidecar + `needs-attention` as a conversation (idea → product, the human only answers questions). It is a face on this engine, not a second question mechanism — it reuses this sidecar contract. It also records the one engine change it implies: structured/JSON lifecycle event output.

## The product vision (the north star)

> **advance is the ultimate mechanism to transform a set of PRDs into a final product without any human work except answering questions.**

For a human it is a way to make steady progress; in CI it lets one invocation constrain exactly what gets done. Everything below (the verb, the tick, the question protocol, the locks) serves this one goal.

## The core idea

A capability that ADVANCES `work/` items toward "ready" — doing every autonomous rung it can, **emitting question files** when it hits judgement it cannot resolve, and **consuming a human's answers** from those files on later passes — so a human answers on their own time and the pool drains toward "all slices built."

It is **`batch-qa`'s one-step invariant, made autonomous and file-mediated** (the same lifecycle rungs the `batch-qa` skill already defines):

- observation (untriaged) → triage → promoted stub / keep / delete (auto-disposition ONLY when there is genuinely no question; otherwise surface the triage question — see the observation-triage rung below)
- slice (`needsAnswers: true`) → answers applied → `needsAnswers: false`
- PRD (`needsAnswers: true`) → answers applied → `needsAnswers: false`
- PRD (`needsAnswers: false`) → sliced (the `do prd:` rung) → new slices
- slice (`needsAnswers: false`, ready) → built (the `do <slug>` rung) → done

The agent does the AUTONOMOUS part of each rung (run `review`, run `to-slices`, run the build) and emits questions ONLY for the residue it genuinely cannot resolve. It **NEVER invents an answer** (the `batch-qa`/`review`/`to-slices` humility rule): answers are always AUTHORED BY A HUMAN — the agent surfaces questions and APPLIES the human's answers, nothing more. We are not automating answer creation.

## Command surface (RESOLVED 2026-06-07)

`auto-slice` already reshaped `do` beyond building: `do <slug>` builds a slice, `do prd:<slug>` slices a PRD. `advance` adds a third lifecycle verb. The surface keeps the existing `prefix:arg` slug-namespaces (ADR §3a `slug-namespace-resolution`) and adds **`advance` as a SIBLING top-level verb** (NOT a `do` subcommand) reusing the SAME shared resolver:

```
do <slug>          # build a ready slice          (bare slug = slice)
do prd:<slug>      # slice a PRD                   (UNCHANGED, existing path)
advance <slug>         # advance a slice one rung
advance prd:<slug>     # advance a PRD (apply answers, then the slice rung)
advance obs:<slug>     # triage an observation     (maybe a new `obs:` namespace)
advance                # advance the eligible set  (like bare `do` autopicks)
```

Decisions baked in (do not relitigate without cause):

- **No `do` subcommands.** `do slice <slug>` / `do prd <slug>` were REJECTED: they break the "bare slug = slice" ergonomics (the 90% case `do my-slice`), fork the shared slug-resolver, and reopen sliced/partially-built work. Keep `prefix:arg`.
- **No standalone `slice` command.** Since `do prd:<slug>` already slices and `advance prd:<slug>` drives the PRD slice rung, a separate `slice <prd>` verb is redundant — do NOT add it. (`do prd:` stays as the leaf; `advance` orchestrates.)
- `advance` ORCHESTRATES `do`-class rungs — for a "build this slice" or "slice this PRD" rung it invokes the existing `do`/`do prd:` machinery; it does the non-agent rungs (triage, answer-apply) itself. It is a driver layered ON TOP, not a peer that duplicates build/slice.

## Execution: one substrate-agnostic TICK, two drivers

Define `advance` as a PURE one-item TICK; both drivers wrap the SAME tick (the same "extract the shared thing, two callers" move the run/do convergence used for `integration-core` — one level up). The tick's internals (the deterministic trigger, the classify→lock→execute flow) are defined in the sections below; here is the shape:

**The advance TICK (one item, substrate-agnostic):** classify the item's next rung (cheap, read-only) → take the rung's CAS lock → execute the rung (apply answers / surface questions / build / slice / triage), winner-only → release. NEVER invents an answer.

**Two drivers wrap the identical tick:**

- **One-shot (`do`-style / CI invocation).** Run the tick over the named item(s), **SEQUENTIALLY**. This is the human one-shot AND the CI invocation (cron, or on-answer-committed: a human commits answers → CI runs an advance pass to consume them + surface the next questions). The caller picks WHICH items (and thus scope); the command itself does no parallelism and embeds no ordering.
- **Loop (`run` daemon).** Loop the tick over the eligible set; this is where genuine PARALLELISM lives (post `run-daemon-reframe`), each item lock-guarded so concurrent ticks never collide.

**`-n x` is ALWAYS SEQUENTIAL (RESOLVED 2026-06-07).** A multi-item invocation (`do -n x`, `advance -n x`) processes its items one after another. Parallelism is NOT a property of `-n` — it is provided by `run` (the concurrent loop) or by the way CI is set up (e.g. a GitHub Actions matrix of independent jobs). Keeping `-n` sequential removes in-process concurrency from the one-shot path entirely and simplifies it.

**`run` ≡ CI, differing only in substrate** (a single local process launching agents on worktrees, vs CI jobs). The tick is the contract; `run` and CI are just loops/invocations over it. No new execution model.

**Ordering is NOT a command property.** Locks make concurrent advancing safe, so there is no intrinsic need to (e.g.) exhaust buildable slices before slicing a PRD — slicing a PRD WHILE slices build is fine. If a caller WANTS an order, that is its concern: `scan` (already exists) reports what is eligible/present, and the caller sequences its own invocations. The verbs stay order-free; `scan` is the ordering oracle.

## The question/answer artifact — a per-item SIDECAR (RESOLVED 2026-06-07 — the keystone)

**Option B: a per-item SIDECAR file, flat, in its own tree** — `work/questions/<type>-<slug>.md` (e.g. `work/questions/prd-autoslice.md`, `work/questions/slice-foo.md`, `work/questions/obs-bar.md`). Chosen over an in-item structured block (Option A) for these reasons + four properties:

WHY B over A (in-body block):

- **A would require a round-trip parser over human-authored prose** — nothing today reads open-questions from item bodies (only the `needsAnswers` FLAG is read, by `categorise.ts`); the `## Open questions` block is pure prose. Editing a structured Q&A block inside a human-authored file without corrupting it, on every apply, is exactly the fragility the idea set out to avoid (`> ANSWER:` lines). The sidecar is a file the tooling FULLY OWNS in a strict, testable format.
- **B decouples the contention surface** — surfacing a question / reading an answer touches only the sidecar; the item body is mutated only on the apply rung. (A would make every answer-apply lock the whole item AND invite human-prose-edit vs agent-block-edit merge conflicts in the SAME file.)
- **Human + machine visibility** — `ls work/questions/` is the live, always-current "what needs me?" dashboard (the durable form of what `batch-qa` produces ephemerally); `scan`/`status` already group by `needsAnswers` and gain the actual questions for free.
- **Strict machine-readable answered-vs-open** — the sidecar format carries, per entry, an explicit answered-state (`id`, `question`, `context`, `answered: bool`, `answer:`), so the agent NEVER re-asks a resolved question. No prose round-trip.

FOUR PROPERTIES (these defuse B's weaknesses):

1. **Type-encoded flat name `<type>-<slug>`** — slugs collide across namespaces (a slice and a PRD can share a slug — that is why `slug-namespace-resolution` exists), so the sidecar name must encode the item TYPE (mirroring the `slice:`/`prd:`/`obs:` namespace prefixes, `:`→`-` for filenames). Derived deterministically from the item's NAMESPACED identity (the resolver stays the single source of truth).
2. **Identity-keyed, NOT folder-keyed** — items `git mv` between folders on every lifecycle step (claim/complete/bounce/requeue); the sidecar is keyed to item IDENTITY (`<type>-<slug>`), so it SURVIVES folder moves WITHOUT a lock-step `git mv` of the sidecar. (A feature: questions persist across the item's moves.)
3. **Terminal cleanup** — on the item reaching a TERMINAL state (`done/` or deleted), the advance tick DELETES the sidecar as part of that rung (a done item has no open questions). One owner, one deletion point — avoids orphans (the same lifecycle-hygiene concern `review-nits-observation` handled).
4. **Atomic apply** — applying an answer mutates the item body AND updates/removes the sidecar entry in ONE commit (the atomic-commit discipline `complete` / `review-nits-observation` already use), so you never get "answer applied but sidecar still says open" (re-ask) or the reverse.

(The exact sidecar FORMAT bytes are the one remaining PRD-time detail — see "Remaining open detail" below.)

## The tick's per-item state machine (RESOLVED 2026-06-07 — deterministic trigger)

What a tick acts on is decided by TWO signals only — the `needsAnswers` flag (which already gates autonomous work, `categorise.ts`) + the sidecar's answered-state. No third state store:

```
needsAnswers: true?
├─ NO  → ANALYSE (run the state-appropriate rung: build a ready slice / slice a
│        ready PRD / triage an untriaged observation). Analysis MAY advance the
│        item, OR SURFACE questions (atomically set needsAnswers:true + write the
│        sidecar) if it hits judgement it cannot resolve.
└─ YES → sidecar exists?
         ├─ NO  → ANALYSE (first pass: generate questions → write the sidecar).
         │        [transitional — normally the surfacing that set needsAnswers:true
         │         ALSO wrote the sidecar atomically, so this branch is rare]
         └─ YES → all entries answered?
                  ├─ YES → ANALYSE: apply the answers + advance. May APPEND new
                  │        questions (→ stays needsAnswers:true, re-pauses for the
                  │        human), OR resolve fully (→ clear needsAnswers + delete the
                  │        sidecar, ATOMICALLY, in one commit).
                  └─ NO  → NO-OP (awaiting human; a `run` daemon tick is cheap).
```

Key points (RESOLVED):

- **"ANALYSE" ≠ "always advance."** It runs the state-appropriate analysis, which may instead SURFACE-AND-PAUSE (set `needsAnswers:true` + write the sidecar). So "surface questions" is itself one of the rungs — used by triage and by any rung that hits judgement. An untriaged observation (likely has NO `needsAnswers` yet) hits the top branch; triage may then surface a question, flipping it to `needsAnswers:true` + a sidecar.
- **Subset of answers → SKIP** (the human answers all before the item is re-analysed) — deterministic, no thrash.
- **Append, never overwrite.** When a triggered analysis reveals NEW questions, APPEND them to the sidecar (keep the answered entries). The sidecar becomes the item's full Q&A HISTORY — good for the human (sees the thread) AND the machine (remembers each decision + why, so it never re-asks and can reason from prior answers). "All answered?" naturally flips back to false when new entries appear, re-pausing the loop. (The applied answers are ALSO integrated into the item body; the sidecar keeps the record of WHAT was asked/answered.)
- **Two invariants:**
  1. `needsAnswers:false` ⟺ NO active sidecar — clearing the flag and deleting the sidecar are the SAME atomic step, so the predicate never sees a `false`+sidecar contradiction.
  2. A pending (not-all-answered) sidecar makes the tick a clean NO-OP — so a `run` daemon never spins hot re-surfacing the same question.
- **Declined/keep is an answer** — "keep-watching" / "don't promote" is an answered entry + a recorded marker on the item, so a settled observation drops out of the candidate pool and is never re-asked.
- **Churn is visible, not auto-managed** — an item that keeps generating new questions across rungs is doing real discovery; the appended sidecar thread makes the round-trips visible so a human can take it to a `grill-me`/design pass. A round-counter that flips it to needs-design after N round-trips (mirroring `reviewMaxRounds` exhaustion) is a DEFERRED optional refinement, not built first.

## The observation-triage rung (RESOLVED 2026-06-07 — option c, high bar)

Observation disposition (promote-to-slice / promote-to-ADR / keep / delete) is product judgement, so the rung is **question-gated BY DEFAULT** — the agent surfaces a triage question into the sidecar and waits for a human answer; it never decides "is this worth building?" autonomously.

BUT (option c): **if there is genuinely NO question, the agent may auto-disposition without asking.** "No question" must be set CONSERVATIVELY — the test is "a human would not plausibly disagree," e.g. the observation is an exact duplicate of an existing finding/slice (→ suggest delete/merge), or it maps unambiguously onto an existing PRD/slice with no judgement about whether to build it. When in ANY doubt, SURFACE — the asymmetry is the usual one: a needless question costs one human glance; an auto-disposition of a real signal (auto-deleting a genuine observation, or drafting a slice for something not worth building) is expensive. The agent NEVER auto-DELETES a non-duplicate signal and NEVER auto-promotes a judgement call.

Consequence (state honestly): item-classes do NOT advance equally autonomously. Slices/PRDs advance a lot (build/slice autonomously when ready); observations advance mostly via a human triage answer, with auto-disposition reserved for the no-question cases. That is correct, not a gap.

## The lock model (RESOLVED 2026-06-07)

There is ONE lock PRIMITIVE — the **CAS ledger-write seam** (a transition published by moving the item into a lock-FOLDER via a force-with-lease micro-commit on a distinct branch ref). It already has shapes; `advance` reuses them and adds ONE new lock-folder for the answer/analyse action. No new lock SEMANTICS.

**The lock-folder encodes the ACTION; the entry name encodes the item IDENTITY.** Today `work/in-progress/` = "being built" and `work/slicing/` = "being sliced" — the FOLDER already encodes the action, and item-TYPE is separated by which flow's folders an item lives in. Advance adds a third action-folder:

- **`claim` → `work/in-progress/`** — a slice's BUILD transition (`backlog → in-progress`), ONE-WAY, LONG-HELD (the whole build). A slice's claim IS its build lock. Unchanged.
- **`slicing` → `work/slicing/`** — a PRD's SLICE transition (`prd → slicing → prd`), a non-terminal BORROW. Unchanged.
- **`advancing` → `work/advancing/` (NEW)** — the SURFACE-question / APPLY-answer / TRIAGE action, a SHORT BORROW (take → mutate item + sidecar → release back to the source folder), shaped like `slicing`, NOT `claim`. Same borrow MECHANISM as slicing; a distinct branch ref + folder only for namespace hygiene (so an advancing-borrow and a slicing-borrow / build-claim on the same slug never collide on the CAS ref — the same "distinct branch name" discipline `autoslice-lock` uses).

**Entries are TYPE-encoded** (`work/advancing/<type>-<slug>.md`, or a typed subfolder) — because a slice, a PRD, and an observation can share a slug AND share the advancing action, the lock entry must carry the TYPE, exactly like the sidecar name (`<type>-<slug>`). The sidecar name and the advancing-lock entry use the SAME `<type>-<slug>` identity — one identity scheme across both.

**A PRD can hold TWO different borrows over its life** — `advancing` (being answered/ edited) and later `slicing` (being sliced). Different actions, different folders/refs, never co-held. Fine — just more states.

`needsAnswers` is therefore the PURE answer-required axis — NOT a lock. Earlier framing let `needsAnswers: true` double as the human edit-lock (agents stay away ⇒ a human can safely edit). `advance` BREAKS that (it ACTS ON `needsAnswers: true` items). So the human edit-handshake moves from "flip `needsAnswers` via CAS" to "**take the `advancing` lock via CAS**" — human and the autonomous driver contend honestly on the SAME lock. (Supersedes `work/ideas/folder-taxonomy-and-prd-edit-handshake.md`, updated to point here.)

Lock discipline: MANDATORY for the autonomous driver; a no-op formality for a SOLO human (no contender); the per-repo "agents may advance here" policy is the human's signal that a contender may be active and the lock actually matters.

## Classify → lock → execute (RESOLVED 2026-06-07 — the cost-safe flow)

The tick is the PROVEN claim→work flow (the one `do`/`run` already use): the EXPENSIVE work is always POST-lock, winner-only.

1. **CLASSIFY (cheap, read-only, NO model, no lock).** Inspect the item + `needsAnswers` + sidecar-state + type → decide the RUNG (build / slice / surface-question / apply-answer / triage). This IS the state machine above — pure file inspection, no agent.
2. **TAKE THE CAS LOCK for the classified rung** (the rung's folder/ref: build → `claim`/in-progress; slice → `slicing`; surface/apply/triage → `advancing`). Loser of the CAS gets exit-2 and backs off HAVING SPENT ~NOTHING.
3. **EXECUTE the rung (may be expensive: agent/model) — WINNER ONLY.**

**Why this matters:** a pure "analyse-expensively then lock" optimism would let two GitHub Actions runners each burn model tokens + CI minutes on the same item, with one thrown away. Locking BEFORE the expensive phase (classify is the cheap part that decides the action) means a CAS loser never starts the model work. TOCTOU between classify and CAS is harmless — only the FREE classification is wasted on a stale decision; the CAS catches it and the tick retries.

**New-item creation goes THROUGH the CAS too** (e.g. observation→promote drafts a new `work/backlog/<new-slug>.md`). The create-rung locks on the NEW item's identity and publishes via the CAS like any transition. So the same-slug new-item race (two ticks promoting two observations that resolve to the same content-derived slug — unlikely: slugs are content-derived, promotion is human-gated) is handled with NO special case: the loser fails the CAS and backs off, same as every other contended transition. (If creation ever bypassed the CAS, two branches both adding the file would collide at integration → needs-attention, never auto-resolved — so route it through the CAS.)

## Per-item-type state transitions (RESOLVED 2026-06-07 — worked through)

Lock-folders: `backlog`/`in-progress`/`done`/`needs-attention` (slice flow), `prd`/`slicing` (PRD flow), `advancing` (NEW, the answer/triage borrow); sidecar = `work/questions/<type>-<slug>.md`.

**SLICE:**

```
backlog (needsAnswers:true, no sidecar)
  → classify=surface → advancing lock → write sidecar, stays backlog → release
backlog (needsAnswers:true, sidecar, PENDING)        → NO-OP
backlog (needsAnswers:true, sidecar, ALL answered)
  → advancing lock → apply answers to body; either append new Qs (re-pause) OR
     clear needsAnswers + delete sidecar (atomic) → release
backlog (needsAnswers:false, ready)
  → claim → in-progress → BUILD → done   (the existing `do` build, long-held lock)
```

**PRD:**

```
prd (needsAnswers:true, no sidecar)   → advancing lock → sidecar → release
prd (needsAnswers:true, sidecar, PENDING)            → NO-OP
prd (needsAnswers:true, sidecar, ALL answered)
  → advancing lock → apply → append-or-(clear+delete sidecar) → release
prd (needsAnswers:false, sliceable)
  → slicing lock → prd→slicing → SLICE → back to prd/ + `sliced:` marker;
     emits NEW backlog slices (each usually needsAnswers:true → re-enter slice flow)
```

**OBSERVATION** (starts untriaged, usually NO `needsAnswers` flag):

```
observations/ (untriaged)
  → classify=triage → advancing lock → EITHER auto-disposition (no question, high
     bar: exact-dup → suggest delete; unambiguous map → draft stub) OR set
     needsAnswers:true + sidecar (a real disposition question) → release
observations/ (needsAnswers:true, sidecar, PENDING)  → NO-OP
observations/ (answered "promote")
  → advancing lock → draft NEW backlog/ slice stub (CAS-created, keyed to new slug;
     needsAnswers per how fully the answer specified it) → record triage → delete sidecar
observations/ (answered "keep")
  → apply → record `triaged:keep` marker → drops out of the pool, never re-asked
observations/ (answered "delete")
  → apply → recommend deletion (human deletes per contract; agent only if policy allows)
```

**Issues surfaced by working these through:**

1. A slice can hold a sidecar + an `advancing` borrow WHILE in `backlog/`, and later take a `claim` for build — two DIFFERENT actions on the same slug → distinct CAS refs (handled by the type+action-encoded lock refs). ✓
2. An untriaged observation (no `needsAnswers`) hits the same "classify" entry as a ready slice → classification dispatches on item TYPE, not the flag alone. ✓
3. A PRD has TWO borrow-locks across its life (`advancing` then `slicing`) — consistent, just more states. ✓
4. Same-slug new-item creation race → routed through the CAS, loser backs off (see above). ✓ (minor; unlikely)

## One question/answer CONTRACT, two drivers, repo-config gated

Do NOT build a parallel question mechanism for the autonomous flow. Design ONE question/answer protocol (the sidecar contract above) and have BOTH drivers use it:

- **human-interactive driver** — `surface-questions` (the refocused `batch-qa`, see below), human-invoked.
- **autonomous driver** — the advance tick (one-shot or looped).

### Repo-config: a FLAT per-action gate family (RESOLVED 2026-06-07)

Advance does NOT get a single master "allowAdvance" knob. It COMPOSES the existing per-action gates and adds one new gate — because "advance" spans actions of very different blast radius. Verified: today `allowAgents` is NOT a master — it gates ONLY slice-BUILD (`resolveGate()` in `eligibility.ts`: agent-claimable iff `needsAnswers!==true && humanOnly!==true && allowAgents`); `autoSlice` is ALREADY a separate flag. So the system is already flat per-action; advance continues that:

| action | gate | default | notes |
| --- | --- | --- | --- |
| build a ready slice | `allowAgents` (→ rename `autoBuild`, see below) | off | exists |
| slice a ready PRD | `autoSlice` | off | exists |
| auto-disposition an observation (the no-question triage path) | **`autoTriage` (NEW)** | off | the only genuinely new autonomous decision |
| SURFACE a question (write sidecar) | none — ALWAYS allowed | — | additive/harmless; it IS the loop's core convenience |
| APPLY a human's answer (mutate item) | none — ALWAYS allowed | — | just executes a decision the human already made |

So a repo with every flag OFF still gets the QUESTION LOOP (agents surface questions + apply the human's answers — the core convenience) but never autonomously builds/slices/triages. Turning on `allowAgents`/`autoSlice`/`autoTriage` progressively hands over more autonomy. Advance, as an orchestrator, must RESPECT these (a build rung obeys `allowAgents`, a slice rung obeys `autoSlice`) — it never bypasses them.

### Rename `allowAgents` → `autoBuild` (SEQUENCED LAST — after the rest)

`allowAgents` reads like a master ("may agents act at all") but only gates BUILD — a naming trap once `autoSlice`/`autoTriage` siblings exist (a reader sets `allowAgents:false` expecting "no agent autonomy" but slice/triage have their own flags). Rename it to `autoBuild` so the family is symmetric (`autoBuild`/`autoSlice`/`autoTriage`). This is a BREAKING config rename (touches `.dorfl.json`, `config.ts`/`env-config.ts`/`repo-config.ts`, docs, WORK-CONTRACT; precedent: `rename-reviewpr-to-review`). DO IT LAST — build the advance family with `allowAgents` named as-is, then rename as one clean isolated migration (with an alias/deprecation window) AFTER the advance work lands. Easier to sequence the rename alone than to entangle it with the feature.

## batch-qa → `surface-questions` (RESOLVED 2026-06-07)

batch-qa is the MANUAL, prose precursor of this whole loop — it already does "formulate questions → batch for the human → apply one step → iterate," composing `review`/`to-slices`. It is a SKILL only (no runner code) because in 2026-06-06 there was no engine to run the loop. **advance IS that engine** — so advance is to batch-qa what the `do`/`run` commands were to `ar-run.sh`: the productized version that ABSORBS the manual orchestration. The mapping is 1:1 (BOUND→classify; GATHER→the surface rung; one-file→per-item sidecars; APPLY→the apply rung+CAS; iterate→the tick loop; one-step invariant→one rung per tick).

So batch-qa's ORCHESTRATION (BOUND / APPLY / ITERATE / one batch file / never-commit) is absorbed by the advance engine. What SURVIVES is its JUDGEMENT — _how to formulate good questions from an item_ — refocused + renamed:

**`surface-questions` (renamed from batch-qa; GATHER-only; PERSIST-NEVER).**

- **GATHER-only:** the discipline for formulating questions from an item — compose `review` (slice/PRD/code), the native promote/keep/delete TRIAGE question (observations), collect pre-existing `needsAnswers`/`## Open questions`; inline context + suggested defaults; the humility rule (surface the residue, NEVER invent an answer). Drops BOUND/APPLY/ITERATE/one-file (now the engine's). The name is changed because "batch" (one-sitting, many items) is exactly the orchestration the engine absorbed — the survivor is the per-item GATHER judgement.
- **PERSIST-NEVER (the key fine-tune):** the skill EMITS questions, it WRITES NOTHING — EXACTLY mirroring how the `review` skill emits a verdict and writes nothing. This STRUCTURALLY eliminates the double-write hazard: an engine-loaded agent and a human-invoked agent behave IDENTICALLY (both only produce questions), so there is no risky "detect my caller and conditionally write" prose. The CALLER persists.
- **Loaded by the advance engine's surface-question rung** — the engine spawns a fresh-context agent with `surface-questions` loaded, gets the questions, and itself writes them to the sidecar (CAS-atomic). The SAME pattern the review gate uses with `review` (engine spawns + loads skill + persists/routes; skill judges).
- **Human-invokable** for the no-runner / by-hand path. Persistence on the human path is: `do advance` (runner-human; the command persists), or hand-writing the documented sidecar format (no-runner human — editing a `work/` file by hand IS what no-runner means). **No separate write-skill is added** — deferred unless hand-writing proves annoying (same logic as the optional setup convenience command); a dedicated `record-questions` skill is the fallback only if needed.

`to-slices`/`review` remain composed BY the rungs (surface/slice), unchanged — only batch-qa's orchestration is absorbed.

## `-n` isolation + chaining + the GitHub-Actions shape (RESOLVED 2026-06-07)

No new isolation or chaining machinery — it all falls out of what exists:

- **Isolation** = the existing `isolation-strategy-seam` (ADR §3): worktree (local `run`) or fresh-checkout (a CI job checks out clean for free). CI's per-job checkout IS the isolation.
- **NO new "chaining" concept** — the existing **rebase-before-integrate (ADR §10)** ALREADY chains merge-mode items: each item's branch is cut from main-at-onboard and rebased onto the latest `<arbiter>/main` right before integrate, so if item N merged while N+1 was worked, N+1's rebase incorporates N's work automatically. A chain CONFLICT is handled as today (abort + route to needs-attention, never auto-resolved). The rebase IS the chaining.
- **`-n` stays a DUMB SEQUENTIAL loop** — "run the tick N times." Parallelism and chaining are emergent (the substrate's matrix; the mode's rebase), NOT features of `-n`.
- **GitHub-Actions-first shape:**
  - `propose` (default, human-in-merge-loop) → a CI **matrix** of independent jobs, one per item (true parallelism, each opens a PR, no chaining). `-n` isn't even needed in CI here — the matrix is the parallelism.
  - `merge` (autonomous landing) → a **single SEQUENTIAL job** (`do -n` / a loop), because merge-mode items chain via rebase and parallel merge jobs would thrash the main-CAS (one wins each merge, the rest rebase-retry). Sequential avoids it.
- Separate CI-integration deliverable (NOT `-n`): a GitHub Actions workflow template (the `install-ci` notion from auto-slice) wiring "on cron / on-answer-committed → run the right shape (matrix for propose, sequential for merge)."

## Termination / convergence (RESOLVED 2026-06-07 — no new mechanism)

Convergence is NOT a special mechanism — it is the existing terminal dispositions, reachable via ANSWERS, plus the no-op-when-pending invariant:

- **An answer can disposition an item to ANY terminal state, not just "toward done."** The apply rung routes per the answer: advance-toward-build (normal); **out-of-scope** (answer = abandon → `git mv → out-of-scope/`, the existing terminal folder); **needs-attention** (answer = "this needs a human DESIGN pass, not more Q&A" → the existing bounce); keep/delete (observations). So no item loops forever — it is always either progressing, terminal (done / out-of-scope / deleted), or idle-pending (a surfaced question awaiting a human).
- **The loop provably drains:** every tick either (a) advances an item toward a terminal, (b) surfaces a question + idles it, or (c) is a no-op (pending). The no-op-when-pending invariant guarantees no tick both does nothing AND leaves the item re-triggerable — so the candidate pool shrinks monotonically as answers arrive, and is STABLE (idle, not thrashing) when there are none.
- **The human is the clock (state honestly).** The system autonomously does ALL the non-judgement work and idles on judgement; throughput = the human's answer rate. "Transforms PRDs into product without human work except answering" is literally true, with "answering" as the gating resource — that is the DESIGN GOAL (keep the human only in the judgement loop), not a flaw.
- **Gate fences hold:** under-specified promotions emit honest stubs (`needsAnswers: true`); PRD `humanOnly` still blocks auto-slicing; the system never produces falsely-ready items.
- **Auto-detecting a non-converging item** (Q&A ping-pong that should become a human redesign) — a round-counter that flips it to needs-attention after N round-trips (mirroring `reviewMaxRounds`) is DEFERRED; the MANUAL escape exists today (a human answers "take this to needs-attention" or hand-bounces it).

## Remaining open detail (PRD-time, not a design fork)

- **Sidecar FORMAT bytes** — the exact frontmatter + per-entry fields (`id`, `question`, `context`, `answered`, `answer`, `disposition?`) and the item→sidecar pointer convention. The SHAPE is resolved (per-item, type-named, identity-keyed, strict answered-state); only the concrete bytes are deferred to the PRD.

## Sequencing

A NEXT-HORIZON PRD, not a now-slice. It builds on:

- **auto-slice** (the `do prd:` autonomous slicing rung + the slicing lock + the two-axis gate) — land FIRST; `advance` reuses all of it.
- ideally **`run-daemon-reframe`** (the real concurrent loop) for the looped driver.
- the **ledger CAS seam** (the transition-lock primitive) — already exists.

## Disposition

PRD-READY (grilled 2026-06-07 — every major seam resolved; only the sidecar FORMAT bytes remain, a PRD-time detail). Promote to its own PRD via `to-prd` (best run in a FRESH context reading THIS file as the sole input — it is self-contained). Sequence the PRD after auto-slice. Intended to be dogfooded by auto-slice itself once that lands — so the `to-prd` pass should resolve any residual `needsAnswers` and weigh whether the PRD truly warrants `humanOnly` (a `humanOnly` PRD cannot be auto-sliced; if dogfooding is wanted, it must be non-`humanOnly`). Almost everything here is reuse of existing machinery (the tick/loop split, the CAS lock kinds + the new `advancing` borrow, the slug-namespace resolver, the isolation-strategy seam, the `batch-qa` rungs); the one genuinely-new piece is the question/answer sidecar contract.
