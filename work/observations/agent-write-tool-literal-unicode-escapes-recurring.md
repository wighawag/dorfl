---
title: the Write/Edit tool sometimes stores literal → escape sequences instead of the actual characters — recurring this session
date: 2026-06-06
status: open
---

## The signal

When writing markdown slice/PRD files that contain non-ASCII punctuation (arrows `\u2192`, em-dashes `\u2014`, section `\u00a7`, ellipsis `\u2026`, play `\u25b6`), the Write tool has REPEATEDLY stored the **literal escape sequence text** (backslash-u-2192 as 6 characters) instead of the actual character. The file then contains garbled `\u2192` strings a reader sees verbatim, and — worse — subsequent `edit` calls that use the REAL character cannot match (the bytes differ), so edits silently fail until the escapes are `sed`-fixed.

Observed instances THIS session (2026-06-06), all in newly-written `work/` files:

- `work/backlog/review-gate-pr-comment.md` — **31** literal escapes.
- `work/backlog/rename-reviewpr-to-review.md` — 1 (in the prompt block).
- `work/backlog/watch-review-session.md` — **16**.
- (plus 2 earlier edit-match failures traced to the same cause.)

≈ 5 distinct occurrences. Per the review discipline "a SECOND instance is a signal, not noise," this is well past threshold — it is a systematic tool-interaction defect, not a one-off.

## Why it matters

1. **Garbled artifacts:** a slice/PRD shipped with `\u2192` literals reads wrong and looks unprofessional; an AFK agent reading it sees noise.
2. **Silent edit failures:** the more expensive symptom — a later `edit` keyed on the real `\u2192`/`\u2014` char fails to match the file's literal escape, so the edit no-ops; the author may not notice without re-reading the bytes. (This is the same class as the stray-`newText`-key bug, different mechanism — see `agent-edit-tool-stray-newtext-key-recurring.md`.)

## Workaround in use

After every Write of a file with non-ASCII punctuation, grep for `\\u[0-9a-f]{4}` and `sed`-replace any hits with the real characters before committing. This has been done reactively each time; it should not be necessary.

## Disposition (for the human / a tooling fix — NOT a code slice in this repo)

This is an AGENT/HARNESS tooling defect (how the Write tool serialises content), NOT an `agent-runner` product bug — so it is recorded as an observation, not sliced. Candidate actions: (a) the tool should write the literal characters the author intended (treat `\u2192` in tool input as the char, or pass content through unescaped); (b) until fixed, the author convention is "ASCII-only in tool-written markdown, or grep+sed the escapes pre-commit." Flag for whoever owns the harness's file-writing tool.

(Captured 2026-06-06 during the review-gate slicing work, after the 5th instance.)
