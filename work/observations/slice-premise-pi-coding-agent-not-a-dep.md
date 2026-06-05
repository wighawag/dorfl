# do-watch-session-log-format slice premise inaccurate: pi-coding-agent is NOT a dep

2026-06-05 — The `do-watch-session-log-format` slice instructs to type the
session-log parser against `@earendil-works/pi-coding-agent`'s `SessionEntry` /
`SessionMessageEntry`, asserting "agent-runner already imports from this package".
It does not — `packages/agent-runner` has only `commander` as a runtime dep and
no import of that package anywhere. Adding it solely for two type imports pulls a
heavy tree (`pi-agent-core`, `pi-ai`, `zod`, `ws`), so I typed the classifier with
a faithful local structural interface mirroring the published shape instead (the
pi-remote reference parser itself casts the content blocks via `as any`). If a
runtime dep on pi-coding-agent is later wanted for shared types, that is its own
slice.
