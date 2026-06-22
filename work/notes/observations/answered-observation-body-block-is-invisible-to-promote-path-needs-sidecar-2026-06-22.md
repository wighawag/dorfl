---
title: An observation answered with an in-BODY "Applied answers" block (not a question sidecar) is invisible to the triage/promote path — surface no-ops it forever, it never promotes
type: observation
status: spotted
spotted: 2026-06-22
needsAnswers: true
---

## What was seen

Running the triage leg for an observation that a human had marked `promote-slice`
in its body did NOTHING (no task minted):

```
agent-runner advance "obs:advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21" --propose --watch --arbiter origin
>> LOCKED 'observation-...' for advancing on origin (unified lock).
>> surface observation:...: no open judgement — nothing surfaced (no sidecar written).
>> RELEASED 'observation-...' advancing borrow on origin (item untouched).
```

Exit 0, outcome no-op. The observation was NOT promoted to a task and NOT settled.

## Investigation (this repo, 2026-06-22)

The observation `advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md`
(on `origin/main`) has:

- frontmatter `needsAnswers: false`, and NO `triaged:` marker;
- a BODY section "## Applied answers 2026-06-22" with `q1: ... promote-slice`
  (plus q2/q3 design decisions) — hand-written prose, NOT a question sidecar;
- NO question sidecar (`work/questions/observation-<slug>.md` is absent).

What the engine actually does (`src/advance.ts` triage/surface rungs;
`src/ledger-read.ts:473` reads `fm.triaged`; `src/lifecycle-pools.ts`
`buildLifecyclePools`):

1. The observation is UNTRIAGED to the engine: triage-vs-settled is decided ONLY by
   the `triaged:` FRONTMATTER marker (`keep`/`duplicate`); a body block is not read.
   So it stays in the triage pool and is re-enumerated every tick.
2. `observationTriage: auto` ⇒ the triage rung asks the triage GATE "is this a
   no-question case (duplicate/map)?". It is neither ⇒ the gate returns
   `auto: false` (a judgement call) ⇒ falls through to the SURFACE rung
   (`triageRung` → `surfaceRung`, `advance.ts`).
3. The surfacer (`surface-questions` skill, fresh context) is asked what to surface.
   It emits EMPTY ("no open judgement") — the body already reads as settled/answered,
   so there is nothing new to ask. `persistSurfacedQuestions` writes nothing ⇒
   exit 0, outcome `no-op`, "no open judgement — nothing surfaced".
4. The PROMOTE path (`src/triage-persist.ts:294` `promoteObservation`, and
   `:370`) explicitly REQUIRES an answered question SIDECAR ("no sidecar at ... —
   the promote path resolves an answered observation"). With no sidecar, promote
   can never fire.

Net: the observation is in a LIMBO state — untriaged (no `triaged:` marker, so
re-enumerated forever) but un-surfaceable (the surfacer finds nothing to ask) and
un-promotable (no sidecar for the apply/promote path to consume). The human's
`promote-slice` decision, written into the BODY, is in the WRONG CHANNEL: the
engine promotes ONLY from an answered `disposition: promote` SIDECAR, never from
body prose.

## Why it matters

This is the channel the whole human-is-the-clock loop runs on: the human answers a
QUESTION SIDECAR (`work/questions/**`), and `apply`/`promote` consumes it. An answer
written as free prose in the observation body looks "answered" to a human reader but
is INVISIBLE to the runner, so the approved-for-slicing work is never minted and the
observation never leaves the triage pool. It will quietly no-op on every propose
tick (exit 0, so it does NOT red CI — but it also never makes progress: a SILENT
stall, which is arguably worse than a loud failure because nothing flags it).

Note this is partly a CONDUCT/CONVENTION signal, not only a code bug: a prior agent
(or human) recorded the triage answer in the body instead of via the sidecar. But
the engine could ALSO be friendlier here (see below).

## The idea (NOT decided here)

A few non-exclusive directions:

- **Convention fix (cheapest):** to actually promote this observation, give it an
  answered sidecar. Either (a) let the runner SURFACE it first (which needs the
  surfacer to ask the promote/keep/delete question — but it currently emits "no open
  judgement" because the body looks settled), or (b) hand-author the sidecar
  `work/questions/observation-<slug>.md` with `disposition: promote` + an `answer:`,
  then run `advance obs:<slug>` so the apply/promote path consumes it. The
  body "Applied answers" block should have been a sidecar.
- **Engine robustness:** detect this limbo — an UNTRIAGED observation that the
  surfacer no-ops (nothing to ask) AND has no sidecar — and either (i) report it
  loudly as "settled in body but no actionable channel; needs a sidecar or a
  `triaged:` marker", instead of a silent exit-0 no-op, or (ii) treat a recognised
  in-body disposition as a settle. The silent no-op is the trap.
- **Surfacer input:** the surfacer should perhaps not read the body's own prior
  "Applied answers" as a reason to stay silent when there is still no SIDECAR and no
  `triaged:` marker (i.e. the item is not actually settled in the channels the
  engine reads).

To weigh: whether the right fix is purely "author the sidecar correctly" (convention)
or the engine should surface the limbo loudly; and whether an in-body disposition
should ever be honoured (probably not — one channel, the sidecar, keeps the loop
honest).

## Provenance / refs

- The run log above (`advance obs:advance-leg-on-stale-snapshot-...`).
- `src/advance.ts`: `triageRung` (auto-gate → `auto:false` → `surfaceRung`),
  `surfaceRung` ("no open judgement — nothing surfaced", exit 0 no-op, ~L535).
- `src/triage-persist.ts:294` `promoteObservation` + `:370` (promote REQUIRES an
  answered sidecar).
- `src/ledger-read.ts:473` (triage-vs-settled is the `triaged:` FRONTMATTER marker
  only); `src/lifecycle-pools.ts` `buildLifecyclePools` (untriaged ⇒ triage pool).
- The stuck observation:
  `work/notes/observations/advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md`
  (its "## Applied answers 2026-06-22" body block; no sidecar; no `triaged:`).

## Note on scope

A SILENT-STALL + convention signal: an answer in the wrong channel makes the runner
no-op forever without flagging it. Half convention (author the sidecar, not the
body), half engine-robustness (surface the limbo loudly instead of a silent
exit-0 no-op). A human decides whether to slice the engine-robustness part or just
fix the convention for this one observation.
