# AGENT CONDUCT (not a domain bug): repeated stray sibling key in edit-tool calls

2026-06-06 (noticed while iterating on `work/prd/batch-qa.md`)

> **This is an agent/harness CONDUCT signal, not a repo-domain signal.** Do not hunt for a code bug \u2014 it is about how the assistant used the `edit` tool.

## What was seen

In a single session, the assistant emitted `edit` calls where an `edits[]` item contained an EXTRA sibling key alongside `oldText`/`newText` \u2014 the exact anti-pattern `~/.pi/agent/AGENTS.md` ("# Edit tool") warns against ("must not have additional properties"). It happened **three times**, with three different stray key names:

- `newText_DUMMY` (editing `work/backlog/autoslice-lock.md`)
- `newText_x` (editing `work/prd/batch-qa.md`)
- `newText_keep` (editing `work/prd/batch-qa.md`, on TWO items of the same call)

Each failed validation (`edits.N: must not have additional properties`), forcing a resend. The resend (only `oldText`/`newText`) succeeded every time \u2014 so the CONTENT was fine; the defect is purely a spurious extra JSON key on the edit item.

## Why it matters

- Wasted round-trips (one failed call + one resend, each occurrence).
- It is a KNOWN, documented foot-gun (AGENTS.md calls it out explicitly), yet was hit repeatedly \u2014 i.e. knowing the rule did not prevent the reflex (the same "glossary entry \u2260 reflex" gap the capture-signal skill names).
- The stray key appears to be the assistant trying to "annotate"/stage an edit item (a placeholder for a value it then didn't use), which the schema forbids.

## Suggested correction (for the assistant)

- Treat each `edits[]` item as STRICTLY `{oldText, newText}` \u2014 never add a third key, even transiently as a scratch/placeholder. If tempted to stage extra text, put it in `newText` itself or omit it.
- After composing an `edit` call, scan each item for any key that is not exactly `oldText`/`newText` before sending.

## Disposition

A conduct/process note, not domain work. No code change. If it recurs across sessions it may warrant a harness-level guard (strip unknown keys on edit items before validation) \u2014 but that is the harness's call, not this repo's. Delete once it stops being a useful reminder.
