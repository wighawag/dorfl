---
name: review
description: 'Thoroughly and adversarially review a work/-protocol artifact against the work/ contract, ending in a destination check against the brief/ADR goal. Use before any artifact is trusted: a task before it lands, code in a work PR against its task, a brief before slicing, or a captured note. Emits a verdict; the caller routes it.'
---

# review

**The review discipline lives in `work/protocol/REVIEW-PROTOCOL.md`** (the in-band protocol doc every set-up repo carries; the source-of-truth is `skills/setup/protocol/REVIEW-PROTOCOL.md`). This skill is the **human-facing pointer** to that standard — the operator/agent entry point a person reaches for to invoke the discipline interactively. The standard itself (the lenses, the destination check, the emitted-verdict shape) is stated ONCE in the protocol doc so the autonomous runner and the human caller cannot drift.

## How to use

1. Read `work/protocol/REVIEW-PROTOCOL.md` in the repo you are working in.
2. Apply its lenses IN ORDER to the artifact under review, ENDING in the destination check.
3. Emit the verdict it specifies (`{verdict, findings, …}`); the caller routes it (you write nothing — see "Your output" in the protocol doc).

> Why the standard lives in `work/protocol/`: a `review`-named discipline that the autonomous runner invokes BY NAME must be in-band in every set-up repo, not host-installed. Operator skills (this file) are human-facing and not copied. See ADR `methodology-and-skills.md` §6.
