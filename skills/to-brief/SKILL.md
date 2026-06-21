---
name: to-brief
disable-model-invocation: true
description: 'Turn the current conversation into a launch brief file in work/briefs/ready/ (sliced into tasks by to-task).'
---

# to-brief

Synthesize the current conversation + codebase understanding into a **brief** (the product-requirements document for a feature) written to `work/briefs/ready/<slug>.md`. Do NOT interview the user — synthesize what you already know.

This is the wighawag, file-based variant of the tracker-oriented PRD writer. It is intentionally **close to that skill** (the structure works), with two deliberate differences: it writes a **file** (no issue tracker / no setup), and it states up-front that the brief is a **launch snapshot**, not a maintained document.

## A brief here is a LAUNCH SNAPSHOT (not maintained)

Write it once, fully, at launch. It captures intent + decisions _at creation time_. It is **not kept in sync** afterwards — current truth lives in `docs/adr/` (decisions) and the code; remaining work lives in `work/tasks/todo/` tasks. Every brief WILL be outrun by the work; that is normal and fine — do not fight it with ongoing brief maintenance. (The `to-task` skill performs a ONE-TIME trim at slice-time, moving the now-redundant technical detail into tasks/ADRs so the brief settles to its durable framing — see that skill. After that, the brief is stable _because_ the stale-prone part was relocated, not because it is maintained.)

Put a one-line banner at the top of every brief you write:

> Launch snapshot — records intent at creation, NOT maintained. Current truth: `docs/adr/` + code; remaining work: `work/tasks/todo/`.

## Process

1. **Explore** the repo to understand current state (if not already). Use the project's domain glossary (`CONTEXT.md`) throughout, and respect ADRs in `docs/adr/` for the area you're touching.

2. **Sketch the seams** at which the feature will be tested. Prefer existing seams; use the highest seam possible. Confirm the seams match the user's expectations.

3. **Set the two autonomy axes (the brief now CARRIES the gate).** Because a brief may be AUTO-sliced by an agent with no human in the loop, decide and record both:
   - **`humanOnly` (DECIDED):** set `humanOnly: true` on the brief ONLY to mean "a human must drive the SLICING of this brief" (its sole effect: an agent may not auto-slice it). This is DISJOINT from any task's `humanOnly` — it does NOT propagate to or guide the gates of the tasks it produces (a `humanOnly` brief can yield fully agent-buildable tasks). Describe judgement-heavy areas in prose as ordinary domain context, but do NOT treat the brief flag as a way to pre-set task gates (the slicer decides each task's gate from that task's own build-nature — see the `to-task` skill §3b).
   - **`needsAnswers` (DISCOVERED):** if the conversation did NOT fully resolve the spec, set `needsAnswers: true` and **list the open questions in the brief body** — the auto-slicer refuses to slice until they are answered and the flag cleared. Be honest: flag an incomplete brief rather than let it produce wrongly-cut tasks. Omit both flags when everything is resolved and agent-sliceable.
   - If this brief's tasks will depend on another brief's tasks, set `briefAfter: [other-brief]` so it is sliced in the right order. This is the checkpoint that `to-task` step 4 ("quiz the user") used to provide; with auto-slicing it must be pre-recorded here OR honestly flagged.

4. **Write** the brief to `work/briefs/ready/<slug>.md` using [brief-template.md](work/protocol/brief-template.md), content-derived slug. Create `work/briefs/ready/` lazily if absent.

**Do NOT** add an "update the brief" step anywhere — the brief is not synced (mirrors the tracker PRD writer, which also never updates a PRD after creation). **Git:** do NOT stage/commit/push — leave the file for review; report the path written. (Slicing it into `work/tasks/backlog/` is the separate `to-task` step.)
