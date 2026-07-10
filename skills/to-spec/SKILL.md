---
name: to-spec
disable-model-invocation: true
description: 'Turn the current conversation into a launch spec file in work/specs/ready/ (tasked into tasks by to-task).'
---

# to-spec

Synthesize the current conversation + codebase understanding into a **spec** (the specification for a feature) written to `work/specs/ready/<slug>.md`. Do NOT interview the user — synthesize what you already know.

It writes a **file** (no issue tracker), and the spec is a **launch snapshot**, not a maintained document.

## A spec here is a LAUNCH SNAPSHOT (not maintained)

Write it once, fully, at launch. It captures intent + decisions _at creation time_. It is **not kept in sync** afterwards — current truth lives in `docs/adr/` (decisions) and the code; remaining work lives in `work/tasks/ready/` tasks. Every spec WILL be outrun by the work; that is normal and fine — do not fight it with ongoing spec maintenance. (The `to-task` skill performs a ONE-TIME trim at tasking-time, moving the now-redundant technical detail into tasks/ADRs so the spec settles to its durable framing — see that skill. After that, the spec is stable _because_ the stale-prone part was relocated, not because it is maintained.)

Put a one-line banner at the top of every spec you write:

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` + code; remaining work: `work/tasks/ready/`.

## Process

1. **Explore** the repo to understand current state (if not already). Use the project's domain glossary (`CONTEXT.md`) throughout, and respect ADRs in `docs/adr/` for the area you're touching.

2. **Sketch the seams** at which the feature will be tested. Prefer existing seams; use the highest seam possible. Confirm the seams match the user's expectations.

3. **Set the two autonomy axes (the spec now CARRIES the gate).** Because a spec may be AUTO-tasked by an agent with no human in the loop, decide and record both:
   - **`humanOnly` (DECIDED):** set `humanOnly: true` on the spec ONLY to mean "a human must drive the TASKING of this spec" (its sole effect: an agent may not auto-task it). This is DISJOINT from any task's `humanOnly` — it does NOT propagate to or guide the gates of the tasks it produces (a `humanOnly` spec can yield fully agent-buildable tasks). Describe judgement-heavy areas in prose as ordinary domain context, but do NOT treat the spec flag as a way to pre-set task gates (the tasker decides each task's gate from that task's own build-nature — see the `to-task` skill §3b).
   - **`needsAnswers` (DISCOVERED):** if the conversation did NOT fully resolve the spec, set `needsAnswers: true` and **list the open questions in the spec body** — the auto-tasker refuses to task until they are answered and the flag cleared. Be honest: flag an incomplete spec rather than let it produce wrongly-cut tasks. Omit both flags when everything is resolved and agent-taskable.
   - If this spec's tasks will depend on another spec's tasks, set `taskedAfter: [other-spec]` so it is tasked in the right order. With auto-tasking the ordering must be pre-recorded here OR honestly flagged, since there may be no human at tasking time to supply it.

4. **Write** the spec to `work/specs/ready/<slug>.md` using [spec-template.md](work/protocol/spec-template.md), content-derived slug. Create `work/specs/ready/` lazily if absent.

**Do NOT** add an "update the spec" step anywhere — the spec is not synced after creation. **Git:** do NOT stage/commit/push — leave the file for review; report the path written. (Tasking it into `work/tasks/backlog/` is the separate `to-task` step.)
