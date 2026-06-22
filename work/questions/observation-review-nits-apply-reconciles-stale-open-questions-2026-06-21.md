<!-- agent-runner-sidecar: item=observation:review-nits-apply-reconciles-stale-open-questions-2026-06-21 type=observation slug=review-nits-apply-reconciles-stale-open-questions-2026-06-21 allAnswered=false -->

## Q1

**Triage the non-blocking review nit on the open-questions marker string (`<!-- open-questions -->` / `<!-- /open-questions -->`): should one of the two parallel slices (apply-reconciles-resolved-brief-body and templates-mark-transient-open-questions-block) be named the canonical source of the literal marker tag (likely slice B, which edits the templates), with the other slice referencing it — or is the current 'both cite the same example from brief D1' arrangement enough?**

> Gate 2 approved 'apply-reconciles-stale-open-questions' but flagged that the literal marker string is needed by BOTH parallel slices (both `blockedBy: []`) yet neither is authoritative. Brief D1 phrases it as an example ('e.g. an HTML comment fence ...'). Slice A says the marker convention is decided by the brief and writes tests with marker-fenced inputs it constructs itself; slice B says the exact tag, if it differs from the example, may be recorded in the done record. Mitigation: both slices cite the same example and read the brief first, so divergence is unlikely. Disposition options: promote-slice (carve a tiny slice that pins slice B as canonical and points slice A at it), keep (leave as durable nit for reviewer eyeballing at landing time), or delete (accept current mitigation is sufficient and retire the observation).

_Suggested default: keep — the mitigation (both slices cite the same example and read the brief first) plus a reviewer eyeball at landing is proportionate to the low coordination risk; revisit only if the two slices actually pick different tags._

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):

KEEP — the current "both cite the same example from brief D1" arrangement is enough. Verified: both slices are still pending and parallel; slice A is STRUCTURAL (it matches the marker PAIR and reads the brief, it does NOT hardcode the literal tag), and slice B owns the template tag. So even if B picks a different literal, A matches whatever pair B emits — the coordination risk is genuinely low and a landing-time reviewer eyeball is proportionate. Promote a canonical-source slice only if the two slices later actually pick different tags. Disposition: keep.
