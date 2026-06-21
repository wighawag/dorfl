---
title: Optional voice/persona for human-facing output (the golem voice), prose-only, never in code
slug: voice-persona-for-human-facing-output
type: idea
status: incubating
---

# Voice / persona for human-facing output (pre-PRD / incubating idea)

> A **pre-PRD idea**: give the CLI an OPTIONAL personality (a "voice"), captured here so it is not lost. The maintainer wants the tool to be able to speak in character (the working name is the golem **Dorfl** from Discworld: terse, literal, a little formal). It is NOT ready to slice; it has open questions and is cosmetic-adjacent, so it must be carefully seamed to never touch the protocol surface or produced code.
>
> Lifecycle tier: **`work/notes/ideas/` (incubating) -> `work/briefs/` (committed north-star) -> `work/tasks/todo/` (tasks) -> `work/tasks/done/`.**

## The rough thought

Let the human-facing PROSE of the tool optionally take on a persona, while every load-bearing surface stays plain and precise. Personality is a thin coat over the facts: it WRAPS messages, it never REPLACES the information in them, and it is keyed off the same TTY/`NO_COLOR` rail as color (see `output.ts`).

## The `voice` config (three levels)

TWO orthogonal config fields, each resolved the same way as the other config axes (flag > env, derived via `brand.envPrefix` > per-repo > global > default): `voice` (WHERE the persona reaches) and `voiceCasing` (HOW it is cased — see below).

`voice` (resolved via `AGENT_RUNNER_VOICE`):

- **`plain` (DEFAULT)** — no persona anywhere. The tool speaks like a tool. Zero behaviour change; this is what every existing user gets.
- **`cli`** — the persona bleeds into the CLI's OWN human-facing messages only (greetings, help banner, success/failure lines, the propose "next step" block, spinners, `status` narration). It must NOT bleed into the `work/` artifacts the agent writes (commits, slice/brief files, PR bodies) and NOT into produced code.
- **`all`** — the persona is everywhere a HUMAN reads: the CLI messages PLUS the `work/` artifacts and the agent prompt (so the voice lands in commit messages, slice/brief bodies, PR text). STILL never in produced code.

## Casing register (`voiceCasing`) — faithful to the books

Golem speech in Pratchett's books has TWO authentic registers, and we offer both as a second, orthogonal knob `voiceCasing` (only meaningful when `voice` is not `plain`; resolved like the other axes):

- **`title` (DEFAULT)** — the Robocop/Watchman register Pratchett renders in Title Case, e.g. Dorfl's `'To Serve The Public Trust, Protect The Innocent, And Seriously Prod Buttock.'` and `'Somewhere, A Crime Is Happening.'` Readable in a terminal, still unmistakably Dorfl. Chosen as the default because full caps reads as shouting on a screen.
- **`caps`** — the FAITHFUL golem-speech register: full small-caps, no quotation marks, e.g. the book's `"WE HEAR YOU WANT A GOLEM."` and the signature `WORDS IN THE HEART CAN NOT BE TAKEN.` The carved-in-clay voice; best reserved for a load-bearing line.
- **`plain`** — the persona WORDING in ordinary sentence case (golem phrasing, no visual styling), for anyone who wants the character without the casing.

(Important distinction the books make, recorded so it is not re-litigated: GOLEM SPEECH = full caps; Dorfl's ROBOCOP one-liners = Title Case. Sources: The Annotated Pratchett File for *Feet of Clay* and the lspace Golems wiki. The casing is a pure text transform over the SAME curated canonical lines, applied at emit time — the lines are authored once, in one place.)

## Emphasis (`voiceEmphasis`) — the load-bearing word (to explore later)

Distinct from `voiceCasing` (the BASELINE register of the whole line), EMPHASIS lifts a specific WORD or PHRASE above the baseline for weight — the thing that makes Dorfl sound like Dorfl (a single carved word amid calm prose). It is a SECOND, orthogonal concept; do NOT fold it into `voiceCasing` (coherence: two concepts, two names).

Proposed model (NOT yet built — the spike has casing only):

- **Canonical lines carry emphasis markup.** Author each line once, in sentence case, marking the load-bearing span, e.g. `A job done badly is a job done {{twice}}.` The `{{...}}` means "this span is emphasised"; the renderer decides how it appears. Authored in ONE place; the channel is a render-time decision.
- **A knob chooses the emphasis CHANNEL** (`voiceEmphasis`):
  - `off` — ignore the markup; the span renders like the rest.
  - `caps` — the span is ALWAYS lifted to caps regardless of baseline (gives the mixed-case effect with `plain`/`title` baselines; a visual no-op when baseline is already `caps`).
  - `bold` — the span is ANSI-bold (only when `shouldUseColor`), the ONLY channel that still shows when baseline is `caps`.
  - `auto` (DEFAULT, lean) — pick the channel that reads best FOR THE BASELINE: caps-lift when baseline is `plain`/`title`, bold when baseline is `caps`. This is the "based on another knob" behaviour.
- **How channels compose with the baseline** (the matrix to validate):
  - baseline `plain` + emphasis ⇒ `A job done badly is a job done TWICE.` (calm voice, one word carved)
  - baseline `title` + emphasis ⇒ `A Job Done Badly Is A Job Done TWICE.` (emphasis rises ABOVE title case to read as emphasis)
  - baseline `caps` + emphasis ⇒ whole line already caps, so casing-emphasis has nowhere to rise; emphasis must use BOLD (gated by `shouldUseColor`) or be invisible.

Open sub-questions for the explore-later pass:

- **"Regardless of option" / HARD emphasis.** Should a few spans always be emphasised even under `voiceEmphasis: off` (e.g. the signature `WORDS IN THE HEART CAN NOT BE TAKEN`, or a fatal-error keyword)? Proposal: allow marking a span as HARD emphasis that ignores `off` but STILL respects the machine-read / non-TTY gate (nothing persona escapes to a pipe). Confirm this is the intended meaning of "regardless".
- **`auto` default confirmation.** Is caps-lift-on-plain/title + bold-on-caps the right default, or a fixed channel?
- **Markup safety.** The `{{...}}` markers must be stripped on EVERY path (including when emphasis is `off` and on the plain/non-TTY fallback) so a marker never leaks into output.

This makes the persona surface THREE orthogonal knobs: `voice` (WHERE) × `voiceCasing` (BASELINE register) × `voiceEmphasis` (the load-bearing span). To be designed and spiked in a later pass; recorded here so the observation is not lost.

## Hard invariants (the persona is prose-only)

At EVERY level, including `all`, the voice MUST NOT touch:

- **The protocol surface** — env-var names, JSON config keys, folder names, exit codes, `--print-dir` output (a shell wrapper parses it), `--json` output, and ANY piped / non-TTY / `NO_COLOR` output. These are a contract with the filesystem, CI, and other programs; a persona here breaks things silently. (Same boundary `brand.ts` already guards for the brand strings.)
- **Produced code** — source, comments, identifiers, test names. Even at `all`, the agent's HANDS stay neutral; only the prose a human reads gets the voice. Golem-speak in committed source would be noise that every later reader inherits.

So the split is: the persona rides the prose layer (CLI messages, and at `all` also the `work/` artifacts + prompt); it is gated off whenever output is machine-read (pipe, `--json`, `--print-dir`, non-TTY, `NO_COLOR`).

## Sketched design (a small seam, like `output.ts`)

- A tiny `voice.ts` beside `output.ts`: a `flavour(plainText, personaText, opts)` (or similar) that returns `plainText` unless voice is enabled AND output is interactive prose. It WRAPS; the facts (branch ref, slug, reason, exit code) always survive.
- A curated set of persona lines for the few moments a human actually reads: claim won / claim lost, gate green / gate red, work pushed (the propose block), needs-attention routed, `gc` reaped a worktree. Curated strings, not generated, so they stay terse and correct.
- For `all`: the agent prompt and the `work/`-artifact templates gain a persona variant, selected by the resolved `voice` level, with an explicit instruction that the voice is for prose ONLY and must never enter produced code.

## Open questions to resolve before it becomes a PRD/brief

- **Naming.** Is the field `voice` with levels `plain | cli | all`? Or `persona`? Pick one term and check it against `CONTEXT.md` so it does not re-mean an existing concept (coherence is a first-class quality here).
- **One persona or many?** Hardcode Dorfl, or make the persona itself pluggable (a named persona registry) with Dorfl as the first? Lean: hardcode one first; generalise only if a second is wanted.
- **`all` and machine-readability of `work/` artifacts.** Commit messages and PR bodies are read by humans but also sometimes parsed by tooling/CI. Confirm the voice in `work/` artifacts at `all` cannot break any downstream parse (e.g. changeset files, conventional-commit hooks). If any are parsed, exclude them from the voice even at `all`.
- **Does it interact with `--json` / quiet modes?** Confirm voice is forced off for every non-prose output path, not just color.
- **Where exactly is the prompt persona injected?** Identify the prompt-render site (`prompt.ts`) and the `work/`-artifact templates so the `all` level has a precise, small set of injection points.

## Why not now

It is cosmetic-adjacent and the default is `plain` (no change), so it is low-risk but also not on the critical path: the autonomous loop, gates, and integration come first. Captured now because the maintainer wants it; ripen it into a brief once the prose/protocol seam is comfortable and the `all`-level `work/`-artifact parse-safety question is answered.

## Spike status

A quick spike was requested to see and feel the voice (a small `voice.ts` seam + the `voice` field + a couple of wired call sites). The spike is exploratory; this idea file is the durable capture. The spike must not be committed without the maintainer's word, and must keep the invariants above (prose-only; protocol + produced code untouched).
