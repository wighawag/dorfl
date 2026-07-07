## Why

An observation whose human triage answer (e.g. `promote-slice`) is written into an in-BODY "Applied answers" block instead of an answered question SIDECAR is currently INVISIBLE to the engine:

- it stays UNTRIAGED — triage-vs-settled is decided ONLY by the `triaged:` frontmatter marker (`packages/dorfl/src/ledger-read.ts` around L473); a body block is not read, so `buildLifecyclePools` (`packages/dorfl/src/lifecycle-pools.ts`) keeps it in the triage pool and re-enumerates it every tick;
- the triage rung's auto-gate returns `auto:false` (it is not a duplicate/map no-question case) so it falls through to the surface rung (`packages/dorfl/src/advance.ts` `triageRung` → `surfaceRung`);
- the surfacer (`surface-questions` skill, fresh context) sees the body already reads as answered/settled and emits EMPTY ("no open judgement — nothing surfaced") ⇒ `persistSurfacedQuestions` writes nothing ⇒ exit 0, outcome `no-op`;
- the promote path (`packages/dorfl/src/triage-persist.ts` `promoteObservation` around L294 + L370) explicitly REQUIRES an answered `disposition: promote` SIDECAR — with no sidecar, promote can never fire.

Net: the observation sits in a LIMBO — untriaged (so re-enumerated forever), un-surfaceable (surfacer finds nothing to ask), un-promotable (no sidecar for apply/promote to consume). It no-ops on every propose tick at exit 0 forever. Exit 0 does NOT red CI, so nothing flags it — a SILENT stall, arguably worse than a loud failure. This is exactly the trust-eroding trap the source observation names.

The human's decision on the source observation:

> Do NOT honour in-body disposition prose: one channel, the sidecar, keeps the loop honest. The convention fix for the one stuck observation is handled separately. The engine-robustness part — make the engine surface the limbo LOUDLY instead of a silent exit-0 no-op on every propose tick — is what this task is for.

So: the engine must NOT start reading body prose as a settle signal. It MUST detect the limbo shape and report it loudly.

## What

When advancing an observation, after the triage rung has fallen through to the surface rung and the surfacer has emitted EMPTY ("no open judgement — nothing surfaced"), detect the LIMBO condition and fail loudly instead of silently exiting 0 with outcome `no-op`.

Limbo condition (all of):

1. the item is an observation;
2. its frontmatter has NO `triaged:` marker (neither `keep` nor `duplicate` — i.e. still untriaged per `ledger-read.ts`);
3. there is NO question sidecar at `work/questions/observation-<slug>.md` (so the apply/promote path has nothing to consume);
4. the surfacer just returned empty (nothing new to ask).

When all four hold, the runner should exit NON-ZERO with a clear diagnostic naming the trap, e.g.:

> observation `<slug>` is in a limbo: no `triaged:` frontmatter marker AND no answered question sidecar at `work/questions/observation-<slug>.md`, but the surfacer has nothing to ask. If a human triage decision (promote-slice / keep / duplicate) has been recorded in the observation BODY, that channel is INVISIBLE to the runner — author the sidecar, or set `triaged:` in frontmatter. The engine does not (and will not) honour in-body disposition prose.

Also consider (SECONDARY, only if it falls out cleanly): the surfacer should not treat a body "Applied answers" block as a reason to stay silent when the item is not actually settled in the channels the engine reads (no sidecar, no `triaged:`). If this is easy, do it; otherwise the loud-limbo exit above is sufficient — the surfacer staying silent then becomes a diagnosable condition rather than a silent trap.

EXPLICITLY OUT OF SCOPE: teaching the engine to read an in-body `promote-slice` / `keep` / `duplicate` string as a settle signal. One channel (the sidecar + `triaged:` frontmatter) keeps the loop honest.

## Acceptance

- Repro test: an observation fixture with `needsAnswers: false`, no `triaged:` marker, an in-body "## Applied answers" block containing `q1: ... promote-slice`, and NO sidecar file. `dorfl advance` on it currently exits 0 with a `no-op` outcome; after this change it exits non-zero with a diagnostic that names the sidecar path and the `triaged:` frontmatter as the two valid channels.
- Non-repro test: the same shape but WITH an answered `disposition: promote` sidecar ⇒ promote fires as today (no regression on the happy path).
- Non-repro test: the same shape but WITH `triaged: keep` (or `duplicate`) in frontmatter ⇒ treated as settled as today (no regression).
- Non-repro test: an untriaged observation where the surfacer DOES have a question to ask ⇒ sidecar is written as today; no loud-limbo exit.
- `pnpm -r build && pnpm -r test && pnpm format:check` green.

## Refs

- Source observation: `work/notes/observations/observation-body-block-is-invisible-to-promote-path-needs-sidecar-2026-06-22.md` (answered).
- The stuck observation that triggered this: `work/notes/observations/advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md` — its `## Applied answers 2026-06-22` body block, no sidecar, no `triaged:`. Fixing that one is a separate convention action (author its sidecar / triage it properly) and is NOT part of this task.
- Code (note: paths are `packages/dorfl/src/`, NOT bare `src/`, per the human's answer):
  - `packages/dorfl/src/advance.ts` — `triageRung` (auto-gate → `auto:false` → `surfaceRung`), `surfaceRung` ("no open judgement — nothing surfaced", the current silent exit-0 no-op).
  - `packages/dorfl/src/triage-persist.ts` around L294 `promoteObservation` and around L370 — promote REQUIRES an answered sidecar.
  - `packages/dorfl/src/ledger-read.ts` around L473 — triage-vs-settled is the `triaged:` frontmatter marker only.
  - `packages/dorfl/src/lifecycle-pools.ts` `buildLifecyclePools` — untriaged ⇒ triage pool, re-enumerated every tick.

## Prompt

> Build the task 'advance-surface-limbo-observation-loudly-instead-of-silent-no-op', described above.
