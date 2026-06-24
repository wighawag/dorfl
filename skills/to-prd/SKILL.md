---
name: to-prd
disable-model-invocation: true
description: 'Turn the current conversation into a launch prd file in work/prds/ready/ (tasked into tasks by to-task).'
---

# to-prd

Synthesize the current conversation + codebase understanding into a **prd** (the product-requirements document for a feature) written to `work/prds/ready/<slug>.md`. Do NOT interview the user — synthesize what you already know.

It writes a **file** (no issue tracker), and the prd is a **launch snapshot**, not a maintained document.

## A prd here is a LAUNCH SNAPSHOT (not maintained)

Write it once, fully, at launch. It captures intent + decisions _at creation time_. It is **not kept in sync** afterwards — current truth lives in `docs/adr/` (decisions) and the code; remaining work lives in `work/tasks/ready/` tasks. Every prd WILL be outrun by the work; that is normal and fine — do not fight it with ongoing prd maintenance. (The `to-task` skill performs a ONE-TIME trim at tasking-time, moving the now-redundant technical detail into tasks/ADRs so the prd settles to its durable framing — see that skill. After that, the prd is stable _because_ the stale-prone part was relocated, not because it is maintained.)

Put a one-line banner at the top of every prd you write:

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` + code; remaining work: `work/tasks/ready/`.

## Process

1. **Explore** the repo to understand current state (if not already). Use the project's domain glossary (`CONTEXT.md`) throughout, and respect ADRs in `docs/adr/` for the area you're touching.

2. **Sketch the seams** at which the feature will be tested. Prefer existing seams; use the highest seam possible. Confirm the seams match the user's expectations.

3. **Set the two autonomy axes (the prd now CARRIES the gate).** Because a prd may be AUTO-tasked by an agent with no human in the loop, decide and record both:
   - **`humanOnly` (DECIDED):** set `humanOnly: true` on the prd ONLY to mean "a human must drive the TASKING of this prd" (its sole effect: an agent may not auto-task it). This is DISJOINT from any task's `humanOnly` — it does NOT propagate to or guide the gates of the tasks it produces (a `humanOnly` prd can yield fully agent-buildable tasks). Describe judgement-heavy areas in prose as ordinary domain context, but do NOT treat the prd flag as a way to pre-set task gates (the tasker decides each task's gate from that task's own build-nature — see the `to-task` skill §3b).
   - **`needsAnswers` (DISCOVERED):** if the conversation did NOT fully resolve the spec, set `needsAnswers: true` and **list the open questions in the prd body** — the auto-tasker refuses to task until they are answered and the flag cleared. Be honest: flag an incomplete prd rather than let it produce wrongly-cut tasks. Omit both flags when everything is resolved and agent-taskable.
   - If this prd's tasks will depend on another prd's tasks, set `taskedAfter: [other-prd]` so it is tasked in the right order. With auto-tasking the ordering must be pre-recorded here OR honestly flagged, since there may be no human at tasking time to supply it.

4. **Write** the prd to `work/prds/ready/<slug>.md` using [prd-template.md](work/protocol/prd-template.md), content-derived slug. Create `work/prds/ready/` lazily if absent.

**Do NOT** add an "update the prd" step anywhere — the prd is not synced after creation. **Git:** do NOT stage/commit/push — leave the file for review; report the path written. (Tasking it into `work/tasks/backlog/` is the separate `to-task` step.)
