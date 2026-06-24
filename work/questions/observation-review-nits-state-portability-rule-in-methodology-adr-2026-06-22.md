<!-- dorfl-sidecar: item=observation:review-nits-state-portability-rule-in-methodology-adr-2026-06-22 type=observation slug=review-nits-state-portability-rule-in-methodology-adr-2026-06-22 allAnswered=false -->

## Q1

**Nit 1 — ratify the cross-link style as 'inline backtick mention, no relative-path link', or follow up with a slice to convert the three protocol references in `docs/adr/methodology-and-skills.md` §6 into actual relative-path links / discrete one-line bullets?**

> Gate 2 (approve) non-blocking finding. The slice brief asked to 'cross-link' the three new discipline docs 'one-line each'. The ADR mentions them as backticked filenames inside a sentence (`REVIEW-PROTOCOL.md`, `SURFACE-PROTOCOL.md`, `SLICING-PROTOCOL.md`) rather than clickable links or bullets. This matches the precedent §6 already sets for `CLAIM-PROTOCOL.md`/`WORK-CONTRACT.md`, so it is internally consistent — but a reader has to know to look under `work/protocol/` rather than click through. Source: work/notes/observations/review-nits-state-portability-rule-in-methodology-adr-2026-06-22.md (first bullet); docs/adr/methodology-and-skills.md §6 refinement bullet.

_Suggested default: keep — the style matches existing §6 precedent and was approved at Gate 2; record the convention here and only promote a slice if a future reader actually trips on it._

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):

## Q2

**Nit 2 — is the ADR's four-location propagation chain (`skills/setup/protocol/` → `work/protocol/` → `dist/protocol/` → target repo via `setup`) intended as ADR-level normativity, or should the ADR be trimmed back to what the slice brief asked for (state the rule + note where the docs live) and the chain demoted to AGENTS.md / a process note?**

> Gate 2 (approve) non-blocking finding. The slice brief only required stating the state-portability rule and noting where the three discipline docs live; the merged ADR additionally pins down the full four-location chain. The chain is factually correct (all four paths verified to exist with the three files) and consistent with AGENTS.md's source-of-truth guidance, but it elevates a current mechanism to ADR-level normativity beyond the slice's ask. Source: work/notes/observations/review-nits-state-portability-rule-in-methodology-adr-2026-06-22.md (second bullet); docs/adr/methodology-and-skills.md §6 refinement bullet, parenthetical.

_Suggested default: keep — the chain is correct and already lands a useful clarification; ratify it as intentional rather than opening a slice to walk it back, but flag to the human in case they want it demoted._

<!-- q2 fields: id=q2 disposition=keep -->

**Your answer** (write below this line):
