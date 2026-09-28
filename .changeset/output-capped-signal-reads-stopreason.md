---
'dorfl': patch
---

A review whose verdict fails to parse is no longer mis-reported as an output-cap truncation (`ReviewOutputCappedError`) on every pi run. The pi adapter's `outputCapped` signal now reads pi's own `stopReason` from the session log (the same reader as the cut-off-turn check) and fires only when the turn actually hit the output-token cap (`length`, or a raw `max_tokens`); a normally-ended turn, or one with no recorded stop reason, leaves it unset so the failure stays the plain parse error.
