---
title: advance-loop — a question/answer protocol + a generalized "advance any work/ item one lifecycle rung" capability (advance verb), driven one-shot (do/CI) AND looped (run), human-or-agent per repo-config
slug: advance-loop-question-answer-protocol
type: idea
status: incubating
---

# advance-loop: turn a set of PRDs into shipped product, with the only human work being to answer questions

> Captured 2026-06-07 from a design conversation; refined the same day. The
> unification of three things that already exist separately: the `batch-qa`
> step-function (the lifecycle rungs), the `run`/`do` execution machinery (one-shot
> tick + loop + isolation + CAS), and the `auto-slice` family (`do prd:<slug>`
> already generalized `do` beyond building). NOT built; framed for a later PRD +
> grilling pass. Names (`advance`, `obs:`, the repo-config key) are placeholders.

## The product vision (the north star)

> **advance is the ultimate mechanism to transform a set of PRDs into a final
> product without any human work except answering questions.**

For a human it is a way to make steady progress; in CI it lets one invocation
constrain exactly what gets done. Everything below (the verb, the tick, the
question protocol, the locks) serves this one goal.

## The core idea

A capability that ADVANCES `work/` items toward "ready" — doing every autonomous
rung it can, **emitting question files** when it hits judgement it cannot resolve,
and **consuming a human's answers** from those files on later passes — so a human
answers on their own time and the pool drains toward "all slices built."

It is **`batch-qa`'s one-step invariant, made autonomous and file-mediated** (the
same lifecycle rungs the `batch-qa` skill already defines):

- observation (untriaged) → triage → promoted stub / keep / delete
- slice (`needsAnswers: true`) → answers applied → `needsAnswers: false`
- PRD (`needsAnswers: true`) → answers applied → `needsAnswers: false`
- PRD (`needsAnswers: false`) → sliced (the `do prd:` rung) → new slices
- slice (`needsAnswers: false`, ready) → built (the `do <slug>` rung) → done

The agent does the AUTONOMOUS part of each rung (run `review`, run `to-slices`, run
the build) and emits questions ONLY for the residue it genuinely cannot resolve. It
**NEVER invents an answer** (the `batch-qa`/`review`/`to-slices` humility rule):
answers are always AUTHORED BY A HUMAN — the agent surfaces questions and APPLIES
the human's answers, nothing more. We are not automating answer creation.

## Command surface (RESOLVED 2026-06-07)

`auto-slice` already reshaped `do` beyond building: `do <slug>` builds a slice,
`do prd:<slug>` slices a PRD. `advance` adds a third lifecycle verb. The surface
keeps the existing `prefix:arg` slug-namespaces (ADR §3a `slug-namespace-resolution`)
and adds **`advance` as a SIBLING top-level verb** (NOT a `do` subcommand) reusing
the SAME shared resolver:

```
do <slug>          # build a ready slice          (bare slug = slice)
do prd:<slug>      # slice a PRD                   (UNCHANGED, existing path)
advance <slug>         # advance a slice one rung
advance prd:<slug>     # advance a PRD (apply answers, then the slice rung)
advance obs:<slug>     # triage an observation     (maybe a new `obs:` namespace)
advance                # advance the eligible set  (like bare `do` autopicks)
```

Decisions baked in (do not relitigate without cause):

- **No `do` subcommands.** `do slice <slug>` / `do prd <slug>` were REJECTED: they
  break the "bare slug = slice" ergonomics (the 90% case `do my-slice`), fork the
  shared slug-resolver, and reopen sliced/partially-built work. Keep `prefix:arg`.
- **No standalone `slice` command.** Since `do prd:<slug>` already slices and
  `advance prd:<slug>` drives the PRD slice rung, a separate `slice <prd>` verb is
  redundant — do NOT add it. (`do prd:` stays as the leaf; `advance` orchestrates.)
- `advance` ORCHESTRATES `do`-class rungs — for a "build this slice" or "slice this
  PRD" rung it invokes the existing `do`/`do prd:` machinery; it does the non-agent
  rungs (triage, answer-apply) itself. It is a driver layered ON TOP, not a peer
  that duplicates build/slice.

## Execution: one substrate-agnostic TICK, two drivers

Define `advance` as a PURE one-item TICK; both drivers wrap the SAME tick (the same
"extract the shared thing, two callers" move the run/do convergence used for
`integration-core` — one level up).

**The advance TICK (one item, substrate-agnostic):**

1. **Take the transition lock** (CAS seam) on the item; lose → skip (contended).
2. **Read** the item's state + any answers present in its question artifact.
3. **Apply** answers present (merge into the item; flip `needsAnswers` where now
   fully resolved) — deterministic, no agent.
4. **Do the autonomous rung** the state calls for: observation → triage
   (review/stub); ready PRD → the `do prd:` slice rung; ready slice → the `do <slug>`
   build rung; `needsAnswers:true` item with no new answer → run review, emit/refresh
   its question.
5. **Write** any new questions (the per-item question artifact).
6. **Release the lock** (with the `autoslice-lock` release-rebase backstop).
7. **Return** what it did / what is now blocked-on-answer. NEVER invents an answer.

**Two drivers wrap the identical tick:**

- **One-shot (`do`-style / CI invocation).** Run the tick over the named item(s),
  **SEQUENTIALLY**. This is the human one-shot AND the CI invocation (cron, or
  on-answer-committed: a human commits answers → CI runs an advance pass to consume
  them + surface the next questions). The caller picks WHICH items (and thus scope);
  the command itself does no parallelism and embeds no ordering.
- **Loop (`run` daemon).** Loop the tick over the eligible set; this is where
  genuine PARALLELISM lives (post `run-daemon-reframe`), each item lock-guarded so
  concurrent ticks never collide.

**`-n x` is ALWAYS SEQUENTIAL (RESOLVED 2026-06-07).** A multi-item invocation
(`do -n x`, `advance -n x`) processes its items one after another. Parallelism is
NOT a property of `-n` — it is provided by `run` (the concurrent loop) or by the way
CI is set up (e.g. a GitHub Actions matrix of independent jobs). Keeping `-n`
sequential removes in-process concurrency from the one-shot path entirely and
simplifies it.

**`run` ≡ CI, differing only in substrate** (a single local process launching agents
on worktrees, vs CI jobs). The tick is the contract; `run` and CI are just
loops/invocations over it. No new execution model.

**Ordering is NOT a command property.** Locks make concurrent advancing safe, so
there is no intrinsic need to (e.g.) exhaust buildable slices before slicing a PRD —
slicing a PRD WHILE slices build is fine. If a caller WANTS an order, that is its
concern: `scan` (already exists) reports what is eligible/present, and the caller
sequences its own invocations. The verbs stay order-free; `scan` is the ordering
oracle.

## One question/answer CONTRACT, two drivers, repo-config gated

Do NOT build a parallel question mechanism for the autonomous flow. Design ONE
question/answer protocol (a contract-native artifact) and have BOTH drivers use it:

- **human-interactive driver** — `batch-qa`, REFACTORED ONTO this contract (it stops
  being a bespoke one-off batch file and becomes the human face of the same
  protocol).
- **autonomous driver** — the advance tick above (one-shot or looped).

WHICH driver is allowed in a repo is a **per-repo policy**, mirroring
`allowAgents`/`autoSlice` (a repo may say "agents may auto-advance here" or "human
drives advancement"). The exact key/precedence is decided in the PRD.

## The lock model (RESOLVED 2026-06-07 — recognise, don't build)

There is ONE lock primitive — the **CAS ledger-write seam** — and it already has
KINDS. `advance` reuses them; it does NOT add a new lock:

- **`claim`** — a slice's BUILD transition (`backlog → in-progress`), ONE-WAY. *A
  slice's claim IS its transition lock* (this is what "push the lock down to slices"
  means — recognition, not new code).
- **`slicing`** — a PRD's SLICE transition (`prd → slicing → prd`), a non-terminal
  BORROW.
- **`answer/edit` (at most ONE new kind)** — apply-answers / edit-an-item-body,
  shaped like `slicing` (take → edit → release back), NOT like `claim`. Open detail:
  confirm this is genuinely distinct from `slicing`, or whether `slicing` covers it.

`needsAnswers` is therefore the PURE answer-required axis again — it is NOT a lock.
Earlier framing let `needsAnswers: true` double as the human edit-lock (agents stay
away ⇒ a human can safely edit). `advance` BREAKS that: it ACTS ON `needsAnswers:
true` items (surfacing/applying answers is its whole point). So the human
edit-handshake moves from "flip `needsAnswers` via CAS" to "**take the transition
lock (answer/edit kind) via CAS**" — human and the autonomous driver now contend
honestly on the SAME lock. (This supersedes the mechanism in
`work/ideas/folder-taxonomy-and-prd-edit-handshake.md`, updated to point here.)

Lock discipline: MANDATORY for the autonomous driver; a no-op formality for a SOLO
human (no contender); the per-repo "agents may advance here" policy is the human's
signal that a contender may be active and the lock actually matters.

## Open seams to grill before a PRD

1. **The question/answer artifact shape (the keystone — the one genuinely new piece).**
   Must be: **contract-native + per-item** (NOT one shared mutable batch file — that
   violates the `work/` no-shared-index rule and races under concurrency, the same
   reasoning `review-nits-observation` used; likely a `needsAnswers` block IN the
   item, or a per-item `work/questions/<slug>.md`); and **idempotent +
   machine-readable answered-vs-open** (an agent must reliably tell a filled answer
   from an open one and NEVER re-ask a resolved question — a bare `> ANSWER:` line is
   too fragile; needs a structured, testable answered-state, mirroring how
   `needsAnswers: true/false` already flips).
2. **The `answer/edit` lock kind** — is it truly distinct from `slicing`, or does
   `slicing` already cover "borrow the PRD to mutate it"? (See the lock model above.)
3. **The repo-config axis** for human-vs-agent advancement — name + precedence
   (mirror `allowAgents`/`autoSlice`).
4. **`batch-qa` refactor** onto the shared question contract (it becomes the human
   driver) — scope of that change.
5. **`-n x` isolation per substrate + merge-mode chaining.** `-n` is sequential
   (resolved), but each item still needs isolation: local `run` uses job worktrees;
   in CI a job can simply re-checkout the repo (the `isolation-strategy-seam`,
   already built, is the abstraction). AND integration mode matters: in `merge`
   mode, item N+1 may legitimately build on item N's already-merged work (re-fetch
   main / fresh checkout between items — a chain), whereas `propose` keeps items
   independent. Provider-dependent; **first target: GitHub Actions.** Decide the
   per-substrate isolation + the merge-mode chaining semantics in the PRD.
6. **Termination/convergence + the gate fences** — the loop drains as the human
   answers; honest stubs (`needsAnswers: true`) for under-specified promotions; PRD
   `humanOnly` still blocks auto-slicing; the system never produces falsely-ready
   items.

## Sequencing

A NEXT-HORIZON PRD, not a now-slice. It builds on:

- **auto-slice** (the `do prd:` autonomous slicing rung + the slicing lock + the
  two-axis gate) — land FIRST; `advance` reuses all of it.
- ideally **`run-daemon-reframe`** (the real concurrent loop) for the looped driver.
- the **ledger CAS seam** (the transition-lock primitive) — already exists.

## Disposition

Promote to its own PRD when prioritised (after auto-slice). Grill the open seams
above first — especially seam 1 (the question/answer artifact shape), which is the
one load-bearing piece of genuinely new design; almost everything else is reuse of
machinery that already exists (the tick/loop split, the CAS lock kinds, the
slug-namespace resolver, the isolation-strategy seam, the `batch-qa` rungs).
