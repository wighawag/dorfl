<!-- dorfl-sidecar: item=observation:review-nits-state-portability-rule-in-methodology-adr-2026-06-22 type=observation slug=review-nits-state-portability-rule-in-methodology-adr-2026-06-22 allAnswered=false -->

## Q1

**This observation is the durable home for two non-blocking review nits raised when Gate 2 APPROVED 'state-portability-rule-in-methodology-adr'. What becomes of this signal: promote one/both nits into a follow-up slice, keep it open as standing triage, or delete it as already-settled?**

> work/notes/observations/review-nits-state-portability-rule-in-methodology-adr-2026-06-22.md — status: open, needsAnswers: true, reviewOf: state-portability-rule-in-methodology-adr. The findings did NOT block integration (the gate approved); this note is their triage home (promote-to-slice / keep / delete). Both findings concern style/normativity of docs/adr/methodology-and-skills.md §6 and are verifiable against current code: the three protocol docs (REVIEW-PROTOCOL.md, SURFACE-PROTOCOL.md, SLICING-PROTOCOL.md) are referenced as inline backticks, and the asserted four-location propagation chain (skills/setup/protocol -> work/protocol -> dist/protocol -> target repos) is factually present.

_Suggested default: Keep open as standing triage — neither nit blocks anything, and both are 'worth ratifying' clarifications rather than defects; no follow-up slice unless the human wants the conventions formally pinned._

<!-- q1 fields: id=q1 -->

**Your answer** (write below this line):

Ratify both conventions (Q2, Q3) and delete the observation. Neither nit blocks anything and both are clarifications rather than defects; ratifying them in this triage record is sufficient, no follow-up slice.

## Q2

**Ratify the 'cross-link' convention the ADR now sets: should 'cross-link the discipline docs' mean an inline backtick mention (no relative-path link), matching the existing §6 style for CLAIM-PROTOCOL.md / WORK-CONTRACT.md?**

> Non-blocking nit (does not block integration). docs/adr/methodology-and-skills.md §6 refinement bullet references the docs as backticked filenames inside a sentence ('...judgement-before-landing (`REVIEW-PROTOCOL.md`), question-surfacing (`SURFACE-PROTOCOL.md`), and slicing (`SLICING-PROTOCOL.md`)') rather than as actual markdown links or discrete one-line bullets. This is consistent with the existing §6 precedent, but a reader has to know to look under work/protocol/ rather than click through. Confirming this sets the precedent for future discipline docs.

_Suggested default: Yes — ratify 'cross-link = inline backtick mention, no relative-path link', since that is the existing §6 precedent and keeps the ADR style consistent._

<!-- q2 fields: id=q2 -->

**Your answer** (write below this line):

Yes, ratify "cross-link = inline backtick mention, no relative-path link." That matches the existing §6 precedent (CLAIM-PROTOCOL.md / WORK-CONTRACT.md) and keeps the ADR style consistent.

## Q3

**Confirm intent: should the ADR elevate the full four-location propagation chain for discipline docs ('source of truth in `skills/setup/protocol/`, mirrored byte-identical into `work/protocol/`, vendored into the package's `dist/protocol/`, and copied into every target repo by `setup`') to ADR-level normativity, when the slice brief only asked to state the rule and note where the three docs live?**

> Non-blocking nit (does not block integration). docs/adr/methodology-and-skills.md refinement bullet parenthetical. The chain is factually correct (all four paths verified to exist with the three files) and consistent with AGENTS.md source-of-truth guidance, so it is a useful clarification — but it promotes a CURRENT mechanism to ADR normativity beyond what the brief required, which the human may want to confirm is the intended permanence.

_Suggested default: Yes — keep it; the chain is accurate and consistent with AGENTS.md, and pinning it at ADR level is a useful clarification rather than overreach._

<!-- q3 fields: id=q3 -->

**Your answer** (write below this line):

Yes, keep the four-location propagation chain at ADR normativity. It is factually accurate (all four paths verified) and consistent with AGENTS.md's source-of-truth guidance, so pinning it is a useful clarification rather than overreach.
