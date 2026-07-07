## Context

A question/answer sidecar (`work/questions/<type>-<slug>.md`, produced by `src/sidecar.ts`) currently identifies the item it asks about ONLY through machine state inside an HTML comment, e.g.:

```
<!-- dorfl-sidecar: item=task:foo type=task slug=foo allAnswered=false -->
```

GitHub and VSCode render HTML comments as nothing (deliberately — ADR `question-sidecar-human-readable-format` made the machine state invisible so a human edit can't corrupt it). So a human reading a sidecar on GitHub/VSCode sees the questions but has NO clickable way to jump to the task/brief/observation it concerns; they must manually reconstruct the path. Since the human-readable-format task landed, the sidecar body is real Markdown rendered on GitHub — a relative Markdown link would be clickable right there.

See the source observation `work/observations/**/question-sidecar-has-no-visible-link-to-the-item-it-asks-about-2026-06-20.md` for full provenance. Related surface observations: `question-sidecar-renders-poorly-on-github.md`, `review-nits-question-sidecar-human-readable-format-2026-06-20.md`.

## What to do

Add a human-visible Markdown link line near the top of every serialised sidecar, pointing at the item file it asks about, so a human triaging the sidecar on GitHub or in VSCode can click through to the item's body.

Place the link OUTSIDE the per-entry parse regions — alongside the identity HTML comment at the top of the file — so the parser ignores it entirely and a human editing answers cannot corrupt the model by touching it. Regenerate the line on every `serialise` from the item's CURRENT on-disk location (search the lifecycle folders for the item by `type` + `slug`); do NOT parse it back in on load.

Link target rendering:

- Render the link relative to the sidecar file (`work/questions/<type>-<slug>.md`), pointing at wherever the item currently lives (e.g. `../tasks/todo/foo.md`, `../briefs/backlog/foo.md`, `../observations/foo.md`, etc. — follow the lifecycle folders that apply to the item's type).
- If the item cannot be found on disk at serialise time, degrade to harmless plain text (e.g. the same line without a link target, or omit the line) — never emit a broken link that would confuse the reader, and never throw.

## Hard constraints (from the human's answer)

1. The line MUST degrade to harmless text and MUST NOT break the parser under any human edit — keep it OUTSIDE the per-entry parse regions, treat it as write-only cosmetic output.
2. The model-equal round-trip MUST still hold: serialise → parse → serialise produces the same model. The link line is regenerated from item location on serialise, never round-tripped through the parsed model.
3. It is ACCEPTED that the link can go stale between the item moving folders (e.g. `tasks/todo/ → tasks/done/`) and the next re-serialise of the sidecar. The sidecar is identity-keyed precisely so it survives `git mv` with no lock-step move; the link self-heals on the next append/answer that re-serialises the sidecar. Do NOT introduce any mechanism that moves the sidecar in lock-step with the item — that would defeat the identity-keying.
4. Do not add a back-pointer FIELD to the item body; the link lives only in the sidecar's serialised output.

## Acceptance

- Every newly serialised sidecar with a resolvable item includes a human-visible Markdown link to that item, rendered relative to the sidecar's path, placed near the identity HTML comment and outside any per-entry parse region.
- If the item cannot be located on disk, serialise still succeeds and emits a harmless fallback (plain text or omission), with a unit test covering that path.
- Unit tests cover: (a) link renders to the item's current lifecycle folder for at least one task and one brief (folders differ), (b) a human editing/removing the link line does not corrupt parse (round-trip of a sidecar with the link line stripped, mangled, or duplicated still yields the same model), (c) model-equal round-trip is preserved: parse(serialise(m)) equals m even though the link line was regenerated, (d) item-not-found fallback.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green.

## Out of scope / fallback

- Not solving folder-move staleness beyond "self-heals on next serialise". If, during implementation, the folder-lookup logic turns out disproportionately expensive or fragile relative to the readability win, the accepted fallback is to close this task without shipping the link and record it as a known-and-accepted limitation on the source observation — but the default is to ship the small feature.

## Prompt

> Build the task 'sidecar-visible-item-link', described above.
