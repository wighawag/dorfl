---
title: 'the prompt-mandated `## Decisions` block is repeatedly skipped (decisions land in JSDoc / the observation instead) — decide whether to ENFORCE the convention or RELAX it to "a durable record anywhere"'
date: 2026-06-22
status: open
needsAnswers: true
---

## The signal

Across a run of `answer-questions` triage on 2026-06-22, the SAME shape recurred in five separate review-nit sidecars: a slice/prompt asked the builder to record an in-scope, non-obvious decision in a `## Decisions` block (in the done record / PR body), and in every case the decision WAS made and IS durably recorded somewhere checkable (a module JSDoc next to the code it governs, or the observation note itself) but NOT in a literal `## Decisions` block; the commit/PR body was empty of it.

The five instances (all ratified `keep`/`dropped` = "the existing record is the durable home", during this triage):

- `review-nits-question-sidecar-human-readable-format-2026-06-20` (q1): the emit-only-on-disagreement `answered=` rule is in the `sidecar.ts` module JSDoc, no Decisions block.
- `review-nits-reaper-no-lock-outcome-benign-not-lost-2026-06-20` (q1): the reaper exit-code contract is JSDoc on `reapReportNeedsAttention`; acceptance criterion #4 literally asked for a `## Decisions` block.
- `review-nits-remove-dead-needs-attention-folder-readers-after-lock-cutover-2026-06-22` (q1): the keep-or-cut judgement call was never recorded as a Decisions line.
- `review-nits-review-protocol-doc-and-shared-machinery-2026-06-22` (q4): three in-scope decisions (alias-instead-of-removal, `resolveReviewProtocolPath`, shared `verdictContractPrompt`) recorded only in the observation; `git log` shows slug/title only.
- `review-nits-work-layout-guard-catch-absolute-prefix-path-literals-2026-06-20` (q1): the `refPrefix`/`pathPrefix` alternation rationale lives in an in-source test comment, no Decisions block.

So this is not a one-off lapse; it is a standing gap between what the prompt/templates MANDATE and what builders actually do, and the human is repeatedly ratifying "the JSDoc/observation is fine" rather than reopening slices.

## Why it matters

- **It is a process-truth drift, not a code defect.** Each individual case is harmless (the decision IS recorded, just not where the convention says). But a convention that is mandated, routinely skipped, and then routinely waived is a convention that no longer means anything: a future reader cannot rely on `## Decisions` blocks existing, and a reviewer cannot cite "the prompt requires it" with a straight face. The rule is either load-bearing (and should be ENFORCED) or it is not (and should be RELAXED to match reality), but the current "mandated-then-waived" middle is the worst of both.
- **It recurs precisely where it is most wanted** — on non-obvious, judgement-call decisions that a Gate-2 reviewer flags. Those are exactly the decisions a durable, discoverable record is FOR. Letting them scatter into JSDoc and observation notes means there is no single place to look for "what non-obvious calls did this slice make?".
- **The fix is cheap either way** and unblocks a class of future nits: pick a rule once, and the recurring "ratify-the-JSDoc vs require-a-Decisions-block" sidecar question stops needing per-instance adjudication.

## The two honest directions (the open decision)

- (ENFORCE) **Make `## Decisions` a checked gate.** The acceptance gate (or a lint/CI check) verifies that a slice which made a flagged in-scope decision carries a `## Decisions` block in its done record / PR body, and fails the gate otherwise. Pro: the convention becomes real and reliable. Con: more gate machinery; risk of false positives (how does the gate know a decision was "non-obvious"?); may push builders to write hollow Decisions blocks to satisfy the check.
- (RELAX) **Redefine the convention as "a durable record ANYWHERE checkable."** Accept that a module JSDoc next to the code, or an observation note, satisfies the requirement, and rewrite the prompt/template language from "add a `## Decisions` block" to "record the decision durably (JSDoc at the choice site, a Decisions block, or an observation), and link it". Pro: matches what builders actually do and what the human keeps ratifying; zero new machinery. Con: loses the single-place-to-look property; "anywhere" can mean "hard to find".
- (HYBRID) Possibly: keep `## Decisions` as the REQUIRED home for slice-level judgement calls flagged by the gate, but explicitly bless JSDoc-at-the-choice-site for narrow parser/predicate invariants (which is where most of the five instances actually landed). This needs the line between "slice-level decision" and "local code invariant" drawn crisply.

## Scope / provenance

- Captured 2026-06-22 from the pattern across five review-nit sidecars during an `answer-questions` triage (the maintainer ratified all five as keep/dropped in that session, which is itself the evidence the convention is being waived in practice).
- The convention currently lives in `work/protocol/CLAIM-PROTOCOL.md` ("end your report with a `## Decisions` block, one entry per decision") and `work/protocol/task-template.md` ("RECORD non-obvious in-scope decisions"); WORK-CONTRACT.md does NOT mention it. Any change to the rule is a protocol-doc edit and must be mirrored `skills/setup/protocol/` <-> `work/protocol/` byte-identically per AGENTS.md.
- This note does NOT pick a direction; that is a JUDGEMENT call for the maintainer.

## Open question to NOT guess

Is the `## Decisions` block convention load-bearing enough to ENFORCE (a checked gate), or should it be RELAXED to "a durable record anywhere checkable" (or the HYBRID) to match what builders actually do and what is repeatedly being ratified? Whichever is chosen, update CLAIM-PROTOCOL.md / task-template.md accordingly (mirrored). Surfaced, never auto-decided.
