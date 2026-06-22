<!-- agent-runner-sidecar: item=observation:answered-observation-body-block-is-invisible-to-promote-path-needs-sidecar-2026-06-22 type=observation slug=answered-observation-body-block-is-invisible-to-promote-path-needs-sidecar-2026-06-22 allAnswered=false -->

## Q1

**What becomes of this observation — promote to a slice that hardens the engine against the silent-stall limbo, keep as a standing signal, or drop because the convention fix (author a sidecar) is the only acceptable answer and no engine change is wanted?**

> The observation documents a real, reproducible silent-stall: an observation whose human answered `promote-slice` in an in-body "## Applied answers" block (instead of a question sidecar at `work/questions/observation-<slug>.md`) sits in limbo — untriaged (no `triaged:` frontmatter marker, so re-enumerated forever), un-surfaceable (the surfacer reads the body as settled and emits empty), and un-promotable (`src/triage-persist.ts:294` `promoteObservation` requires an answered sidecar). Net behaviour: `advance` exits 0 with outcome `no-op` on every propose tick, never minting the slice the human approved — a silent stall, not a loud failure.
>
> The observation itself names two non-exclusive directions: (a) pure convention — "author the sidecar correctly, don't write answers in the body"; (b) engine robustness — detect the limbo (untriaged + surfacer no-op + no sidecar) and either report it loudly as `needs-attention` or treat an in-body disposition as a settle. The author also flags a tension: honouring an in-body disposition probably violates the "one channel — the sidecar — keeps the loop honest" principle, so the robustness fix is most likely "surface the limbo loudly", not "parse the body".
>
> Refs: `src/advance.ts` `triageRung`→`surfaceRung` (~L535); `src/triage-persist.ts:294`,`:370`; `src/ledger-read.ts:473`; `src/lifecycle-pools.ts buildLifecyclePools`; the stuck observation `work/notes/observations/advance-leg-on-stale-snapshot-exits-2-and-reds-ci-2026-06-21.md`.

_Suggested default: promote-slice — the silent no-op is exactly the failure-mode the human-is-the-clock loop is designed to avoid (a stall that doesn't red CI is worse than one that does); a slim slice that detects the untriaged + surfacer-empty + no-sidecar tri-state and exits non-zero with a `needs-attention` message (rather than silently parsing body prose) closes the trap without compromising the one-channel rule. The convention fix for the specific stuck observation is orthogonal and can be done by hand regardless._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):
