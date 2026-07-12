---
promotedFrom: observation:rename-spec-batch1-scope-decisions
---

## What to build

Add a one-line authoring rule to `skills/setup/protocol/TASKING-PROTOCOL.md` (the source of truth) AND mirror it into `work/protocol/TASKING-PROTOCOL.md` (the propagated copy — the two must stay byte-identical per AGENTS.md), saying: **a KEY / folder rename task MUST ground its blast-radius claim against the actual code rather than assume indirection — e.g. don't assert 'every call site references the key, never a raw string' without grepping first, because a KEY rename that is a string-literal `as const satisfies WorkFolderKey` (or similar typed-literal) IS a hard TypeScript break at every call site and must be included in the batch.**

This lifts a concrete miscue from the batch 1 prompt of `rename-spec-work-layout-and-folders`, whose domain note claimed 'every call site references keys, never raw strings, so renaming a folder should not re-touch call sites' — true for the VALUE flip, false for the KEY rename. See `work/questions/observation-rename-spec-batch1-scope-decisions.md` (the closed observation this task springs from) for the full evidence trail.

Natural home: the existing **Wide refactors** subsection in `TASKING-PROTOCOL.md` (line ~43, which already introduces "blast radius" and expand→migrate→contract). Add the rule as a short bullet or sentence adjacent to the blast-radius definition so future task authors reading that subsection encounter it.

Acceptance:
- New guidance line lands in `skills/setup/protocol/TASKING-PROTOCOL.md`.
- Same line mirrored verbatim into `work/protocol/TASKING-PROTOCOL.md` (verify with `diff -r skills/setup/protocol work/protocol` — should be clean apart from files that legitimately only live in one).
- `pnpm -r build && pnpm -r test && pnpm format:check` green (run `pnpm format` first).

## Prompt

> Add a one-line task-authoring rule to `skills/setup/protocol/TASKING-PROTOCOL.md` inside the existing **Wide refactors** subsection (near the current "blast radius" sentence around line 43) that says: a KEY / folder rename task must ground its blast-radius claim against the actual code — do NOT assert "every call site references the key, never a raw string" without grepping first, because when the key is a typed string literal (`as const satisfies WorkFolderKey` or the equivalent), renaming the key IS a hard TypeScript break at every call site and those call-site literal updates MUST be scoped into the migrate batch, not deferred.
>
> Then mirror the identical edit into `work/protocol/TASKING-PROTOCOL.md` so the source and the propagated copy stay byte-identical (see repo `AGENTS.md`: `skills/setup/protocol/*` is the source of truth, `work/protocol/*` is a generated copy; editing only the copy silently drifts). Verify with `diff -r skills/setup/protocol work/protocol`.
>
> Context / why this is being added: batch 1 of `rename-spec-work-layout-and-folders` shipped with a domain note that understated its own blast radius exactly this way; the correction is captured in the ratified observation `work/notes/observations/rename-spec-batch1-scope-decisions.md` (or its done location). This task lifts that one-shot correction into durable authoring guidance so future KEY-rename tasks don't repeat the miscue.
>
> Do not restructure the subsection or rewrite unrelated prose — this is a targeted one-line addition. Finish with `pnpm format` then confirm `pnpm -r build && pnpm -r test && pnpm format:check` is green.
