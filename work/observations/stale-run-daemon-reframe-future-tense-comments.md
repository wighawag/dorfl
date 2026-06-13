# Stale "run-daemon-reframe is a future slice" comments

2026-06-13: `run-daemon-reframe` is in `work/done/`, but three code comments still
describe it in the future tense as the slice that "switches"/"wires" `run` to the
mirror set: `run.ts:202`, `run.ts:279` ("...until the `run-daemon-reframe` slice
switches it to the registry's mirror set"), and `cli.ts:219`
("...the separate `run-daemon-reframe` work this does NOT duplicate"). The work
landed; the comments read as if it has not. Worth a docs-only refresh so the
in-code provenance matches reality (not fixed here — outside this slice's scope).
