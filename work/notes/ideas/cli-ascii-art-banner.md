---
title: CLI ASCII-art banner (figlet-style), independent of any persona work
slug: cli-ascii-art-banner
type: idea
status: incubating
---

# CLI ASCII-art banner (pre-PRD / incubating idea)

> A **pre-PRD idea**: a small ASCII-art banner for one-off CLI moments (e.g. `--version`, first run, or `remote add` of the first repo). DELIBERATELY independent of the voice/persona idea (`voice-persona-for-human-facing-output.md`): it is plain ASCII branding that is useful whether or not any personality work ever happens, so it must not be coupled to that work.
>
> Lifecycle tier: **`work/notes/ideas/` (incubating) -> `work/briefs/` (committed north-star) -> `work/tasks/todo/` (tasks) -> `work/tasks/done/`.**

## The rough thought

Render the project name (or a short mark) as ASCII-art big text for a one-off banner, the way many CLIs greet on `--version` / first run. Generated with a figlet-style font (e.g. via the `figlet` tool/library or a pre-rendered static string), so it is REAL ASCII: safe for copy-paste, grep, screen readers, and width. A blocky/carved figlet font can evoke a "carved" look without needing any actual typeface (a CLI cannot set fonts; see the font note in the voice-persona idea).

## Why it is its OWN idea, not part of the persona work

- It is plain ASCII branding, not a persona: no voice register, no casing, no emphasis. It stands alone.
- It is valuable EVEN IF the persona idea is dropped (every CLI can have a version banner).
- Coupling it to the persona would be a conceptual muddle (coherence is a first-class quality here): two unrelated concepts should not share one idea/brief/task.

## Scope / where it shows (lean: one-off only)

- **Yes:** `--version`, possibly first-run / first `remote add`. One-off, human-facing, interactive.
- **No:** NOT on every command, NOT on routine output, NOT in any machine-read path (`--json`, `--print-dir`, piped/non-TTY). Same gate as color: banner only on an interactive TTY (reuse `output.ts`'s `shouldUseColor` rule), so logs/pipes stay clean.

## Open questions before it becomes a PRD/brief

- **Static vs generated.** Pre-render the banner to a static string (zero dependency, no runtime figlet) vs. depend on a `figlet` library. Lean: static string (a CLI does not need a font-rendering dependency for one banner).
- **Which moments.** Just `--version`, or also first run? Keep it rare so it never becomes noise.
- **Width safety.** ASCII art has a fixed width; decide behaviour on narrow terminals (truncate? skip the banner under a min width?).
- **Interaction with `--quiet` / no-color.** Confirm the banner is suppressed on every non-interactive / quiet / machine-read path.

## Why not now

Pure cosmetic branding, off the critical path (autonomous loop, gates, integration come first). Captured so the figlet thought is not lost and is kept SEPARATE from the persona work, per the maintainer's call.
