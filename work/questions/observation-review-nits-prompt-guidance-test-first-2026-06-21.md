<!-- agent-runner-sidecar: item=observation:review-nits-prompt-guidance-test-first-2026-06-21 type=observation slug=review-nits-prompt-guidance-test-first-2026-06-21 allAnswered=false -->

## Q1

**Nit 1 — Keystone slice carries needsAnswers:true for both the seam mechanism (Option A conditional fragment vs B variant wrapper vs C append-line) and the replace-vs-append phrasing question. Should the slicer pre-decide one (brief leans toward 'strengthened' = replace) so the keystone is immediately pickable, or is leaving both as the picker's ADR call intended? Promote to a follow-up slice, keep as an open observation, or drop?**

> From observation file: the keystone slice 'prompt-guidance-testfirst-config-and-prompt-seam.md' has frontmatter needsAnswers:true and its 'Open question' section defers two distinct decisions (seam mechanism A/B/C, and replace-vs-append phrasing) to the implementer/reviewer. Gate 2 approved with this as a non-blocking nit.

_Suggested default: keep — leaving the picker to resolve via ADR is the documented escape hatch; promote only if the keystone becomes unpickable_

<!-- q1 fields: id=q1 disposition=keep -->

**Your answer** (write below this line):

KEEP — resolved, overtaken by events. The keystone slice is now `needsAnswers:false` and carries an "Applied answers 2026-06-22" section that resolves BOTH deferred decisions: seam = Option A (single wrapper, conditional HTML-comment-delimited fragment, declared ADR-worthy), and replace-vs-append = REPLACE. The keystone is already immediately pickable; no pre-decision is needed. Disposition: keep.

## Q2

**Nit 2 — Should the env-var name be pinned now (at slicing time) rather than left as 'AGENT_RUNNER_PROMPT_GUIDANCE_TEST_FIRST or whatever matches existing naming'? Promote to a slice/ADR that fixes the name, keep, or drop?**

> From observation file: Keystone slice §2 of 'End-to-end behaviour' hedges the env-var spelling; downstream tests will need a concrete name to assert against.

_Suggested default: promote-slice — a tiny naming-decision slice (or amendment to the keystone) so tests have a concrete symbol_

<!-- q2 fields: id=q2 disposition=promote-slice -->

**Your answer** (write below this line):

Pin it now as a one-line amendment to the keystone slice (not a separate slice/ADR): `AGENT_RUNNER_PROMPT_GUIDANCE_TEST_FIRST`. The name is mechanically determined by the existing `AGENT_RUNNER_<UPPER_SNAKE>` convention (cf. `AGENT_RUNNER_AUTO_BUILD`, `AGENT_RUNNER_AUTO_SLICE`) for config key `promptGuidance.testFirst`. Replacing the §2 hedge with the concrete symbol gives downstream tests something to assert. Disposition: promote-slice (tiny keystone amendment).

## Q3

**Nit 3 — The item-override slice asserts per-task > per-brief > repo precedence, but the brief only says 'per-item override' without ranking task vs brief. Is the ordering already implied by how humanOnly/autoBuild compose (so this is keep), or is the slicer making a fresh design call deserving an ADR (promote-adr)?**

> From observation file: 'prompt-guidance-testfirst-item-override.md' §3 introduces a three-tier precedence; brief 'Implementation Decisions' bullet 3 says 'per-item override' without explicit task-vs-brief ranking. Composition pattern of humanOnly/autoBuild may already establish the convention.

_Suggested default: promote-adr — a fresh precedence ordering across two scopes is a design call worth a short ADR even if it just ratifies the humanOnly/autoBuild convention_

<!-- q3 fields: id=q3 disposition=promote-adr -->

**Your answer** (write below this line):

promote-adr, but the ADR records INHERITANCE WITH OVERRIDE, not the bare ladder the slice asserts. Decision: a brief's `promptGuidance.testFirst` PROPAGATES to the tasks sliced from it, at slicing time, as a default the task inherits; an explicit value on the task overrides the inherited one. At build time only the task's resolved value is read. So the effective precedence (task-explicit > brief-inherited > repo-default) is realized by COPY-AT-SLICE, not a runtime brief lookup. This is deliberately UNLIKE `humanOnly` (which is phase-orthogonal with no inheritance: brief-`humanOnly` gates slicing, task-`humanOnly` gates building, they never compose). Correct the item-override slice's §3 wording accordingly. Disposition: promote-adr.
