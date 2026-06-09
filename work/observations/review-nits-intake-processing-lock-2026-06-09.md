---
title: review-gate non-blocking nits for 'intake-processing-lock' (Gate 2 approve)
date: 2026-06-09
status: open
slug: intake-processing-lock
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'intake-processing-lock' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- Ratify: the lock is acquired by a non-atomic READ-then-ADD (`getLabels` then `gh issue edit --add-label`), so two genuinely-simultaneous runs can both read 'no lock' and both proceed — there is no provider-side compare-and-set. Is this intentional best-effort serialisation?
  (intake.ts ~L377-401: `getLabels` then conditional `addLabel`. This is a deliberate, PRD-sanctioned choice — the PRD frames the label as a TRANSIENT best-effort mutex and names CI's per-issue concurrency group as the real serialiser (out of scope here). So the TOCTOU window is by-design, not a defect. Flagging only because the agent recorded no `## Decisions` block; this is the kind of cross-cutting semantics a human should knowingly ratify (the lock narrows the race; it does not close it).)
- Ratify: on a REAL GitHub provider, a labels-JSON parse failure (`gh` returned 0 but unexpected payload) returns `supported: false`, i.e. it silently degrades to 'no lock / best-effort' rather than surfacing as a supported-provider error. Is degrade-on-parse-failure the desired behaviour?
  (issue-provider.ts `getLabels`: the `catch` around `JSON.parse(...normaliseLabels)` returns `{supported:false, labels:[], instruction:'could not parse...'}`. Consistent with the never-throw best-effort discipline and surfaced via the instruction string, so it is honest and safe (worst case: no lock, CI concurrency group serialises). Recording it as a ratification point because a malformed read masquerading as 'provider has no labels' is a non-obvious user-visible default the agent chose on its own.)
