## Why

The `## Decisions` block convention (mandated in `work/protocol/CLAIM-PROTOCOL.md` and `work/protocol/task-template.md`) is repeatedly skipped by builders and repeatedly waived on triage — decisions land durably in module JSDoc next to the code they govern, or in the observation note, and the human keeps ratifying "that's fine" rather than reopening the slice. Across a single `answer-questions` session on 2026-06-22 this exact shape recurred in FIVE separate review-nit sidecars (enumerated in `work/observations/observation-decisions-block-convention-repeatedly-skipped-enforce-or-relax-2026-06-22.md`). A convention that is mandated-then-waived is the worst of both worlds: a future reader cannot rely on `## Decisions` blocks existing, and a reviewer cannot cite "the prompt requires it" with a straight face.

The maintainer picked **RELAX** (not ENFORCE, not HYBRID):
- ENFORCE (a CI/acceptance gate) would punish a convention we have been waiving, and would also have to answer "how does the gate know the decision was non-obvious?" — likely producing hollow Decisions blocks written just to satisfy the check.
- HYBRID would require drawing a crisp line between "slice-level decision" and "local code invariant", which is extra spec surface for little gain.
- RELAX matches what builders actually do and what triage keeps ratifying, and costs zero new machinery.

## What to change

Rewrite the language in BOTH protocol docs from "add a `## Decisions` block" (or equivalent) to "record the decision durably and link it — a module JSDoc at the choice site, a `## Decisions` block in the done record / PR body, or an observation note are all acceptable homes; whichever home is used, LINK it from the done record so it is discoverable."

Files to edit:

1. `work/protocol/CLAIM-PROTOCOL.md` — currently "end your report with a `## Decisions` block, one entry per decision". Rewrite to the durable-record-anywhere form, keeping `## Decisions` as ONE of the acceptable homes (and still the recommended home when there is no obvious code site to attach a JSDoc to). Preserve the "one entry per decision" granularity guidance.
2. `work/protocol/task-template.md` — currently "RECORD non-obvious in-scope decisions" (in whatever section wires this up). Rewrite to point at the same durable-record-anywhere rule; if the template has a `## Decisions` heading stub, keep it as an OPTIONAL heading, not a required one.
3. `skills/setup/protocol/CLAIM-PROTOCOL.md` and `skills/setup/protocol/task-template.md` — apply the IDENTICAL edits.

## Protocol-doc mirroring (do not skip)

Per `AGENTS.md`, `skills/setup/protocol/*` is the SOURCE OF TRUTH and `work/protocol/*` is a propagated COPY; the two MUST stay byte-identical for the files this task touches. Concretely:

- Make the same edit in both `skills/setup/protocol/CLAIM-PROTOCOL.md` and `work/protocol/CLAIM-PROTOCOL.md`.
- Make the same edit in both `skills/setup/protocol/task-template.md` and `work/protocol/task-template.md`.
- Verify with `diff -r skills/setup/protocol work/protocol` — the two trees should differ only in files that legitimately live in only one place; the two files this task edits MUST be byte-identical between them.
- Do NOT bump `VERSION` unless the maintainer asks — this is a wording clarification of an already-waived rule, not a semantic protocol change; if in doubt, leave VERSION alone and mention it in the done record for the human to decide.

## Not in scope

- No CI check, no acceptance-gate check, no lint. RELAX explicitly means "no new machinery".
- No retroactive rewrite of past done records / observations. The five instances enumerated in the source observation are already ratified as-is.
- No change to `WORK-CONTRACT.md` (it does not mention the convention today; leave it).
- Do NOT try to define "slice-level decision" vs "local code invariant" — that was the HYBRID path and was explicitly rejected.

## Acceptance

- `work/protocol/CLAIM-PROTOCOL.md` and `work/protocol/task-template.md` no longer mandate a `## Decisions` block; they mandate a durable, linked record with `## Decisions` listed as one acceptable home among {JSDoc at the choice site, `## Decisions` block, observation note}.
- `skills/setup/protocol/CLAIM-PROTOCOL.md` and `skills/setup/protocol/task-template.md` carry the identical text.
- `diff` between the two protocol trees shows no drift on the edited files.
- `pnpm -r build && pnpm -r test && pnpm format:check` is green (this is a docs edit so build/test should be untouched, but the gate still runs).
- Done record links to this task and to the source observation `observation-decisions-block-convention-repeatedly-skipped-enforce-or-relax-2026-06-22`, and durably records any non-obvious wording choices per the NEW rule (i.e., anywhere durable + linked — dogfood the relaxed convention).

## Prompt

> Build the task 'protocol-relax-decisions-block-to-durable-record-anywhere-2026-07-07', described above.
