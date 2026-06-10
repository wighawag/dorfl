---
title: issue-intake — one command (intake <N>) that transforms an issue into a slice OR a PRD via a question/answer loop on the issue thread (clear+small → slice, clear+big → PRD, unclear → ask, unrelated → bounce)
slug: issue-intake
humanOnly: true
sliceAfter: [auto-slice]
---

> **Launch snapshot — SLICED** (this PRD lives in `work/prd-sliced/`; the folder is its sliced-ness — there is no `sliced:` marker). The Implementation / Testing detail was relocated into the slices at slice time (2026-06-09): `intake-tracer-slice-outcome`, `intake-decision-prompt-and-four-outcome-dispatch`, `intake-per-outcome-integration-modes`, `intake-processing-lock`, `intake-event-classification`, `prd-complete-query`. What remains here is the DURABLE spec + rationale (the decision table, the scope boundary, loop closure, the stories, the autonomy axes) — the source of truth the slices reference. Provenance + history at the BOTTOM (Further Notes); the spec leads.

## Problem Statement

agent-runner has no front-of-funnel: work originates from a PRD a human writes (`to-prd`) and slices (`to-slices`). But real work often starts as a **GitHub issue** filed by anyone — sometimes a crisp small bug, sometimes a fuzzy big feature. Nothing takes an issue and turns it into the right `work/` artifact, clarifying it first when it is not clear enough to act on.

**The goal, in one line: given an issue, transform it into a slice OR a PRD, via a question/answer step.** This PRD specs exactly ONE job — that transformation ENGINE. It is the SAME command a maintainer runs locally one-shot AND that CI schedules; CI's concerns (trigger, auth, autonomy policy, issue-closing) are a SEPARATE PRD (`runner-in-ci`) — see "Scope: the engine only".

## Solution

A standalone command, **`intake <N>`**, behind an **issue seam**, that reads the issue

- its comment thread and resolves to ONE of four outcomes. The decision is **agent judgement driven by a PROMPT** (exactly like `do`'s build prompt or the review gate's prompt): the prompt produces a VERDICT, and a deterministic runner DISPATCHES on it.

### The decision (the canonical rule — everything else references THIS)

The prompt classifies the issue (given its body + full thread) into one verdict:

| Verdict | When (the criteria the prompt applies) | The runner then… |
| --- | --- | --- |
| **ASK** | The ask is **not clear enough to act on** — a material requirement, scope, or acceptance question is unanswered (the same "would I build the wrong thing if I guessed?" bar `to-slices` uses for `needsAnswers`). | `postComment` the next clarifying question; emit NOTHING; STOP. (A later run resumes from the updated thread.) |
| **SLICE** | Clear, AND the ask **fits ONE slice** — a single tracer-bullet vertical slice by `to-slices`' criterion (one buildable end-to-end path). | Emit one `work/backlog/<slug>.md` (`covers: []`, no `prd:` — its own source of truth), carrying an `issue: N` closure field (NOT `Fixes #N`). |
| **PRD** | Clear, AND the ask is **coherent but needs >1 slice** — it cannot be one slice (splits for scope/architecture). >1 slice ⟺ a shared vision worth recording ⟺ a PRD. **INCLUDES a coupled-but-SMALL pair: if two asks are genuinely related, they get a (light) PRD — they are NEVER bounced** (bounce is only for UNRELATED asks). | Emit one `work/prd/<slug>.md` with `issue: N`; STOP (slicing is the separate `do prd:` step). |
| **BOUNCE** | The ask is really **multiple UNRELATED concerns** wearing one issue — the prompt cannot articulate a single shared vision tying them together. | A bounce is **TERMINAL** (the asks are unrelated and must be re-filed), so intake **CLOSES the issue ATOMICALLY** — the "please file separate issues" text as the closing comment + `reason: not planned` in ONE `closeIssue` call — and emits NOTHING. (Reversal recorded 2026-06-10, slice `intake-closes-issue-on-bounce`: an OPEN issue after a bounce is a dishonest "still in play" signal. Intake closes on BOUNCE only; slice/prd are closed by CI's close-job via the `issue:` field; ask never closes.) |

Decision aids the prompt must encode, stated once here:

- **"clear?" bar** = the `to-slices`/`needsAnswers` bar: would acting now risk building the wrong thing? If yes → ASK. (Do NOT guess a spec from a vague issue.)
- **"one slice?" bar** = `to-slices`' tracer-bullet test: one thin end-to-end path, demoable on its own. Fits → SLICE; needs splitting → PRD.
- **PRD vs BOUNCE** turns on a **shared vision**: coupled (even if small) → PRD; unrelated → BOUNCE. The size of a coupled pair never forces a bounce — only unrelatedness does. (This guard prevents over-bouncing a small coupled pair.)

### The engine shape (the testable seam) — the durable contract

`intake` is **a prompt + a deterministic dispatcher**, mirroring the review gate (prompt → `approve|block` → dispatch): acquire the `processing` lock → read the issue + thread via the seam → prompt returns a VERDICT (`{ask,slice,prd,bounce}` + drafted content / comment text) → the runner DISPATCHES on it → release the lock. **The agent only DRAFTS / decides — NO git, no label ops, no posting; the RUNNER owns every git/seam side-effect** (the in-band boundary). The seam between verdict and dispatch is the unit-test target: a STUBBED verdict drives the dispatcher with no model/network; the prompt's JUDGEMENT is NOT unit-tested (like the review prompt's is not). A content-derived slug is proposed (never a counter). The loop re-runs on a new comment OR an issue-body edit (re-evaluate the whole thread); a buried prior-comment edit is IGNORED.

The durable seam shapes (the slices carry the mechanics):

- **issue seam** (provider-pluggable; GitHub via `gh`; core never imports `gh`): `getIssue`, `listComments`, `postIssueComment` (read + post), label ops `addLabel`/`removeLabel`/`getLabels` (the lock), and `closeIssue({issueNumber, comment?, reason?})` (an ATOMIC close — `gh issue close [--comment] [--reason]`). `closeIssue` is used by intake DIRECTLY on a BOUNCE (terminal: comment + `not planned` + close in one call, slice `intake-closes-issue-on-bounce`) AND, later, by CI's close-job for the slice/PRD path. NOTE the rename: the existing PR-review `postComment` becomes `postPRComment`; the issue seam's comment method is `postIssueComment` (GitHub shares the comment id space, other providers may not). → `intake-tracer-slice-outcome` (read + postIssueComment + rename), `intake-processing-lock` (label ops), `intake-closes-issue-on-bounce` (`closeIssue` + the bounce close).
- **`processing` LOCK** — a single provider-native LOCK label, added-on-start / removed-on-finish: a TRANSIENT concurrency mutex carrying NO `work/` state. NOT a `work/`-file CAS (the contended thing is the ISSUE; the output slug is unknown pre-run) and NOT a whitesmith-style label STATE-MACHINE (ADR §12 forbids modelling `work/` lifecycle in labels). Non-label provider → best-effort degrade. → `intake-processing-lock`.
- **per-outcome integration KNOBS** — `intake` decides the TYPE at runtime, so one `--merge`/`--propose` can't express a type-conditional policy. Granular `--merge-prd`/`--propose-prd`/`--merge-slice`/`--propose-slice` + aggregates `--merge`/`--propose`; granular-overrides-aggregate; same-type-both = usage error; unset ⇒ propose. `intake` owns the KNOBS; WHICH knobs CI sets is CI's POLICY (`runner-in-ci`). → `intake-per-outcome-integration-modes`.

## Scope: the engine ONLY (the boundary that makes this sliceable)

**THIS PRD's slices build the ENGINE** — all `sliceAfter: [auto-slice]`-eligible NOW, no `runner-in-ci` dependency:

1. the **issue seam** (read methods + `postComment` + label ops; GitHub adapter; core never imports `gh`);
2. the **`processing` lock** (acquire/release on the label) + best-effort degrade;
3. the **decision prompt** (`{ask,slice,prd,bounce}` + drafted content) — a prompt asset, like the build/slicer/review prompts;
4. the **deterministic dispatcher** (verdict → postComment / write+integrate);
5. the **`intake <N>` verb** + per-outcome mode resolution through `performIntegration`;
6. the **"is this PRD complete?" core query** (read-only: ≥1 slice with `prd:<slug>` AND all in `work/done/`) — pure `work/`-folder logic the CI close-job consumes (verified 2026-06-06 it does not exist yet; re-check `work/done/` at slice time).

**NOT built here — these are `runner-in-ci`'s slices** (the CI scheduler/policy PRD): trigger policy (`command`/`every-issue`, maintainer/anyone); the author-trust resolver; the autonomous **merge-vs-propose POLICY** (which per-outcome flags to pass, derived from gate state); `install-ci` + the label-driven schedule + per-issue concurrency group; the **merge-to-main close JOB** (calls the "PRD complete?" query + `closeIssue`). `intake` is **gate-free** — an explicit invocation is its own authorization (exactly as the `do`/explicit path is not gated by `autoSlice`/`autoBuild`; slice `explicit-do-prd-not-gated-by-autoslice`); the per-repo config gates apply only to the AUTONOMOUS/auto-pick path, which is CI.

## Loop closure (the linkage this engine emits; the JOB is CI's — except BOUNCE)

For the SLICE / PRD path the engine EMITS the linkage as a FIELD; CI ACTS on it (the issue is closed by a future CI close-job over folder + field state — `intake` never closes on the slice/PRD path). For the BOUNCE path, by contrast, intake CLOSES the issue DIRECTLY and ATOMICALLY (terminal: comment + `reason: not planned` + close in one `closeIssue` call — a reversal recorded 2026-06-10, slice `intake-closes-issue-on-bounce`). ASK never closes. Closure is provider-agnostic by construction: the slice/PRD link is a `work/`-file field, not a GitHub-native PR/commit keyword; the bounce close maps `reason` provider-neutrally (a non-GitHub adapter maps/ignores it).

- a lone **slice** (no `prd:`) carries an **`issue: N`** frontmatter field → the close-job closes the issue when that slice reaches `work/done/`. It carries NO `Fixes #N` (a deferred GitHub-only OPTIMISATION, not the mechanism: it is provider-specific AND has no slot on the `--merge` path, where the artifact lands directly on `main` with no PR body; `do` MAY later auto-inject it on the build PR — out of scope here).
- a **PRD** fans out to N slices = N PRs → those slices carry **`prd:`** ONLY (NO `Fixes #N` and NO `Refs #N` — nothing emits a `Refs #N` keyword; `renderPrd` emits only `issue: N`); the issue is closed by CI's merge-to-main close-job running the core "PRD complete?" query + `closeIssue`. Slices resolve the issue via `slice → prd: → PRD issue:` (the number lives ONLY on the PRD, never duplicated across the N fanned slices).
- **INVARIANT — one closure path per slice:** a slice uses `issue:` XOR `prd:`. A lone slice closes its own issue via `issue:`; a fanned slice contributes to a PRD that closes the issue via `prd: → PRD issue:`. This is documented on the `issue` field (no throwing validator); the precedence (`prd:` wins) is the close-job's concern.
- Degrades cleanly on a non-GitHub arbiter: the `issue:`/`prd:` field is provider-agnostic, so the close-job works uniformly; a provider with no `closeIssue` simply does not close (no breakage).

## User Stories

1. As a user, I want to file an issue (bug, small improvement, or big feature) and have `intake <N>` turn it into the right `work/` artifact, so I do not hand-write a spec.
2. As a maintainer, I want `intake` to ASK on the thread when the issue is unclear and continue until it is clear, so a fuzzy issue becomes a clean artifact via conversation, never a guess.
3. As a maintainer, I want the **decision** (ask / slice / PRD / bounce) made by a PROMPT-driven verdict the runner dispatches on (per the decision table), so the judgement is tunable like every other agent-runner prompt and the dispatch is deterministic + testable.
4. As a maintainer, I want a clear small ask → ONE slice and a clear big ask (>1 slice) → a PRD, with a coupled-but-small pair getting a light PRD (NEVER a bounce), so the artifact matches the work and small coupled work is not wrongly rejected.
5. As a maintainer, I want an issue of genuinely UNRELATED asks BOUNCED ("file separate issues") AND — because a bounce is TERMINAL — the issue CLOSED atomically as `not planned` (the bounce text as the closing comment), so unrelated work is not smuggled under one issue and an open issue is not left as a dishonest "still in play" signal.
6. As a maintainer, I want `intake` to run LOCALLY one-shot AND be the SAME command CI schedules, so the transformation is built once and I can test it with no CI.
7. As a maintainer, I want `intake` GATE-FREE (my explicit invocation authorizes it, like `do`), so per-repo `autoSlice`/`autoBuild` config never blocks an explicit run.
8. As a maintainer, I want the emitted artifact to carry its issue link as a `work/`-file FIELD (`issue: N` on a lone slice; `issue: N` on a PRD) + its own gate axes, so it hands cleanly to the slice/build engine and to CI's closure regardless of provider (no `Fixes #N` keyword dependency).
9. As a maintainer, I want PER-OUTCOME integration modes (granular + aggregates, granular-overrides-aggregate, default propose), so CI can apply a type-conditional merge-vs-propose policy over a command whose output type is decided at runtime.
10. As a maintainer, I want two concurrent runs on one issue serialised by a provider-native `processing` LOCK label (not a `work/` CAS), so concurrency is handled where the issue lives.
11. As a maintainer, I want the issue seam provider-pluggable (GitHub via `gh` first), core never importing `gh`, so other providers can follow and CI reuses the seam.

## Testing Decisions (the durable principle; per-test detail is in the slices)

The load-bearing rule: **test the DISPATCH, not the model.** A STUBBED verdict drives the dispatcher with no model/network; the prompt's JUDGEMENT is never unit-tested (like the review prompt's is not). Everything else is pure logic over stubbed inputs. STUB the seam + `gh` throughout (no network, no real GitHub). The concrete cases live in the slices' acceptance criteria — the four-outcome dispatch table (`intake-tracer-slice-outcome` + `intake-decision-prompt-and-four-outcome-dispatch`), the per-outcome mode resolution table (`intake-per-outcome-integration-modes`), the lock back-off/degrade (`intake-processing-lock`), the event-classification table (`intake-event-classification`), and the "PRD complete?" fixture-tree cases (`prd-complete-query`).

## Autonomy notes (the gate axes)

- **`humanOnly: true` (PRD-level, DECIDED):** reads (possibly untrusted) issues, posts under the project identity, can make work CLAIMABLE — a human should drive the SLICING of this PRD. Per-slice (WORK-CONTRACT §3b): the dispatcher, the mode resolution, the "PRD complete?" query, and event-classification are agent-buildable; the issue-seam ADAPTER (shells out under repo identity) leans `humanOnly`; the decision PROMPT is a prose asset a human likely tunes.
- **`needsAnswers`: NONE open.** Author-trust + the merge-vs-propose POLICY moved to `runner-in-ci` (this command is gate-free), so no open question blocks the engine slices. The decision table, the four outcomes, the lock, the per-outcome KNOBS, slug/`issue:` linkage, and the "PRD complete?" query are all decided.

## Out of Scope

- **Everything CI** — trigger policy, author-trust, the merge-vs-propose POLICY, `install-ci`/the schedule/concurrency group, the merge-to-main close JOB (the SLICE/PRD close, via the `issue:` field) — is `runner-in-ci`'s (see "Scope: the engine only"). `intake` is gate-free and exposes only the per-outcome mode KNOBS CI sets. NOTE: `closeIssue` itself is NO LONGER exclusively CI's — intake calls it DIRECTLY on a BOUNCE (the terminal close, slice `intake-closes-issue-on-bounce`); only the slice/PRD close-JOB is CI's.
- **Auto-slicing the emitted PRD / building the emitted slice** — the existing `do prd:` / `do <slice>` engine, triggered separately.
- **A throwing frontmatter VALIDATOR for the `issue:`/`prd:` invariant** — out of scope (there is no frontmatter-validation layer; intake never emits both fields, so only a human hand-edit could, and the precedence rule — `prd:` wins — degrades that to "use the PRD's number" rather than crashing). The lone-slice `issue:` field itself IS in scope (it is the provider-agnostic lone-slice closure link, mutually exclusive with `prd:`; see Loop closure).
- **Any issue-label STATE-MACHINE / issue lifecycle in core (ADR §12)** — only the single transient `processing` concurrency lock label is in scope.
- **Non-GitHub issue providers** — GitHub adapter first; the seam allows others later.

## Further Notes (provenance + reuse)

- **Absorbs the former `work/prd/issue-to-prd.md`** (deleted 2026-06-09). History: two PRDs once split this — `issue-to-prd` (every issue → a PRD) + `issue-intake` (a slices-first front-door on top). They collapsed into one once the capability became ONE command whose conversation ends in EITHER artifact: PRD and slice are two branches of one advance/ask loop sharing one seam / lock / trigger. The PRD conversation, the issue seam, slug + `issue: N` linkage, and option-(iii) loop closure came from `issue-to-prd` and live here.
- **Reuse, don't reinvent:** `to-slices`/`to-prd` for the slice/PRD shapes (and their "clear?"/"one slice?" criteria the decision prompt anchors to); `performIntegration` (`src/integration-core.ts`) for output; the review-gate's prompt→verdict→dispatch pattern for the engine shape; the slug-namespace resolver pattern for the verb. Genuinely-new: the issue SEAM (read + postComment + label ops), the decision PROMPT + dispatcher, the per-outcome mode resolution, and the "PRD complete?" query.
- **whitesmith** (`~/dev/github/wighawag/whitesmith`) is the reference for the issue provider/seam, author-association checks, the slash-command/event workflow, and the PROVEN label + per-issue-concurrency pattern. Reuse the SEAM + concurrency pattern; do NOT reuse its label STATE-MACHINE or 1-PR-per-issue model (agent-runner is 1-PR-per-slice + folder-native closure + a single transient lock label).
- **CI is just one caller:** `runner-in-ci` schedules `intake` and computes the per-outcome modes from its policy. No second transformation engine.
