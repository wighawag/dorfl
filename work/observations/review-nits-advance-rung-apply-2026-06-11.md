---
title: review-gate non-blocking nits for 'advance-rung-apply' (Gate 2 approve)
date: 2026-06-11
status: open
slug: advance-rung-apply
---

## Non-blocking review findings

The PR/code review gate (Gate 2) APPROVED 'advance-rung-apply' but raised the
following non-blocking findings (nits). They do not block integration; this
is their durable home for triage — promote-to-slice / keep / delete.

- RATIFY (in-scope decision): a needs-attention disposition is routed by a bare `git mv work/<src> work/needs-attention/<slug>.md` + `git add -A` + commit in moveResolvedItemToTerminal, rather than through the canonical routeToNeedsAttention (needs-attention.ts, ADR §12). Is reimplementing a thinner bounce here (no `## Needs attention` reason block appended, unlike every other bounce in the system) acceptable, or should the apply rung reuse/mirror routeToNeedsAttention so an apply-bounced item carries the same reason marker as a build/slice bounce?
  (needs-attention.ts:routeToNeedsAttention always writes a REASON_HEADING ('## Needs attention') block into the body on the move; the apply rung's move writes none. The human's answer is preserved in the Applied-answers block, so context is not fully lost, and status=folder is honored — hence non-blocking. Flagged as a coherence/duplication concern (the slice prompt named needs-attention.ts as 'the existing bounce').)
- RATIFY (in-scope decision): pickTerminal treats the human-authored dispositions promote-slice and promote-adr as a PLAIN RESOLVE (not a terminal) in the apply rung, deferring new-item creation to the triage rung. Confirm this division is intended — i.e. an answered 'promote' on a slice/PRD here just resolves the item's Q&A, and the actual new-item drafting only happens via advance-rung-triage.
  (Documented in pickTerminal's docstring and consistent with work/backlog/advance-rung-triage.md (§20: promote→CAS-create new backlog stub; §21/§36: keep/delete handling shared with the apply rung). So US #29's 'advance-toward-build' maps to 'plain resolve' here by design. Surfacing for explicit human ratification because the apply slice's own US list (#29) reads as if it owns all terminals.)
- RATIFY (in-scope decision): a terminal disposition (out-of-scope / needs-attention) produces TWO commits — first the resolve commit (clear needsAnswers + delete sidecar via applyAtomic), then a separate `git mv` commit moving the item to the terminal folder. The slice criterion says resolve+delete happen 'in the SAME atomic commit'; the terminal MOVE is a distinct second commit. Is the two-commit terminal route acceptable?
  (The atomicity the invariant requires (needsAnswers:false ⟺ no sidecar) IS in one commit; only the folder move is the second commit, both under the held advancing lock (winner-only), so a partial would be a loud git error caught by applyRung's try/catch (usage-error), not a silent torn state. Worth a human nod since the slice phrasing could be read as 'all in one commit'.)
- RATIFY (in-scope decision / cross-slice seam): follow-up questions are supplied to the apply rung via an injected context.applyFollowups array (NewQuestion[]); the apply rung NEVER generates them. The append-re-pause path therefore only fires when a caller/later slice feeds it formulated follow-ups. Confirm the generation path (surface skill → engine) is intended to live in a later slice and that leaving applyFollowups undefined-by-default (⇒ resolve) in the current driver wiring is the intended behaviour.
  (Documented as a deliberate 'never invent an ANSWER' boundary (apply-persist.ts and the AdvanceContext.applyFollowups docstring). The engine currently threads options.applyFollowups straight through; no production caller populates it yet, so today every all-answered apply resolves/dispositions rather than re-pauses unless a test injects follow-ups. This is a coherent seam but a cross-slice interaction a human should ratify.)
