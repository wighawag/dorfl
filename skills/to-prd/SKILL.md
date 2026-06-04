---
name: to-prd
description: "Turn the current conversation + codebase understanding into a PRD written as a file in a repo's work/prd/ folder, as the LAUNCH source material for the file-based work/ workflow (sliced by the to-slices skill). Use when the user wants to create a PRD from the current context. NOT for an issue-tracker handoff (this writes a file, not a tracker issue)."
---

# to-prd

Synthesize the current conversation + codebase understanding into a **PRD**
(Product Requirements Document) written to `work/prd/<slug>.md`. Do NOT interview
the user — synthesize what you already know.

This is the wighawag, file-based variant of the tracker-oriented `to-prd`. It is
intentionally **close to that skill** (the structure works), with two deliberate
differences: it writes a **file** (no issue tracker / no setup), and it states
up-front that the PRD is a **launch snapshot**, not a maintained document.

## A PRD here is a LAUNCH SNAPSHOT (not maintained)

Write it once, fully, at launch. It captures intent + decisions *at creation
time*. It is **not kept in sync** afterwards — current truth lives in `docs/adr/`
(decisions) and the code; remaining work lives in `work/backlog/` slices. Every
PRD WILL be outrun by the work; that is normal and fine — do not fight it with
ongoing PRD maintenance. (The `to-slices` skill performs a ONE-TIME trim at
slice-time, moving the now-redundant technical detail into slices/ADRs so the PRD
settles to its durable framing — see that skill. After that, the PRD is stable
*because* the stale-prone part was relocated, not because it is maintained.)

Put a one-line banner at the top of every PRD you write:

> Launch snapshot — records intent at creation, NOT maintained. Current truth:
> `docs/adr/` + code; remaining work: `work/backlog/`.

## Process

1. **Explore** the repo to understand current state (if not already). Use the
   project's domain glossary (`CONTEXT.md`) throughout, and respect ADRs in
   `docs/adr/` for the area you're touching.

2. **Sketch the seams** at which the feature will be tested. Prefer existing
   seams; use the highest seam possible. Confirm the seams match the user's
   expectations.

3. **Surface human-only considerations.** As part of the conversation, identify
   which user stories / areas will likely need a HUMAN (a product, design,
   security, or judgement call an agent should not make unattended) versus which
   are agent-buildable. Capture this **as prose** in the PRD (a short note on the
   relevant user stories, or a "Human-only considerations" subsection). It is
   GUIDANCE for the slicer, NOT a machine field: the authoritative `humanOnly`
   flag lives on the *slice* (set by `to-slices` using this guidance), never as a
   parsed field on the PRD.

4. **Write** the PRD to `work/prd/<slug>.md` using
   [prd-template.md](prd-template.md), content-derived slug. Create `work/prd/`
   lazily if absent.

**Do NOT** add an "update the PRD" step anywhere — the PRD is not synced (mirrors
the tracker `to-prd`, which also never updates a PRD after creation). **Git:** do
NOT stage/commit/push — leave the file for review; report the path written.
(Slicing it into `work/backlog/` is the separate `to-slices` step.)
