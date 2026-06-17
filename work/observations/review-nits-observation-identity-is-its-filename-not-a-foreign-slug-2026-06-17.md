---
title: review-gate non-blocking nits for 'observation-identity-is-its-filename-not-a-foreign-slug' (Gate 2 approve)
date: 2026-06-17
status: open
slug: observation-identity-is-its-filename-not-a-foreign-slug
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'observation-identity-is-its-filename-not-a-foreign-slug' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the slice's `## Decisions (to record while building)` template was not filled in — the actual decisions live only in code comments and the commit title. Should the slice file carry an explicit `## Decisions` block summarising (a) `reviewOf` + no `slug:`, (b) new `vanished` outcome shape, (c) filename-only `findItemPath` kept (no `findObservationFileBySlug`), (d) human-typo case intentionally NOT distinguished from auto-enumerated vanished?
  (work/done/observation-identity-is-its-filename-not-a-foreign-slug.md still contains the placeholder bullets; the agent did not append the resolved choices.)
- Ratify: `vanished` is a NEW `AdvanceOutcome` variant alongside `advanced` / `no-op` / `usage-error` / `lost` / `contended`. Is this the right shape vs. folding it into `no-op` (with a distinguishing message) or `advanced`? In `advanceBatchSummary` (advance-loop-driver.ts ~L488) only `'no-op'` counts as `idle`; `vanished` with exit 0 falls into the `advanced` bucket, so a batch full of vanished legs reads as 'progressed' in the calm-at-rest signal. Under normal conditions the vanished item disappears from the next enumeration so convergence is fine, but the categorisation feels off — should `vanished` count as `idle` for batch summary purposes?
  (packages/agent-runner/src/advance-loop-driver.ts L488 `if (r.outcome === 'no-op') idle++; else if (r.exitCode === 0) advanced++;` — `vanished` (exit 0) is bucketed as advanced. The slice asked for 'a clean no-op outcome, exit 0 or a distinct non-error "skipped/vanished" outcome'; both shapes were permitted.)
- Ratify: a human-typed bare typo'd `obs:<slug>` is now also a silent benign skip (was exit-1 with reconcile message). The slice said 'Keep a genuinely-malformed invocation … loud IF it is distinguishable; an auto-enumerated leg that lost its file is a skip.' The agent took the un-distinguished path explicitly and documented it in the `AdvanceOutcome` doc comment. Acceptable trade-off, or should the human-typed CLI path tag its calls so a typo stays loud?
  (packages/agent-runner/src/advance.ts L97-L107 (the doc-comment on `vanished`) acknowledges this explicitly. The auto-enumerated vs human-typed paths both flow through the same `findItemPath` guard.)
- Ratify: enumerate-side change applies to ALL observations, not just review-nits. `readLocalObservations` and `readObservationsFromTree` now ignore `fm.slug` entirely (was `fm.slug ?? basename(file)`). Any future observation whose author wrote a frontmatter `slug:` differing from filename will be silently keyed by filename. The slice steered this direction; this finding is to confirm the global scope (not just review-nits) is intended.
  (packages/agent-runner/src/ledger-read.ts L389, L666 — both readers changed to `basename(file, '.md')` unconditionally.)
