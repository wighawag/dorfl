# `skills/to-task/scripts/claim.sh` still implements the SUPERSEDED direct-`main` claim

Noticed 2026-06-19 while doing the protocol-docs/skills/setup vocabulary cutover
(`protocol-docs-skills-and-setup-scaffold-new-vocabulary`).

`scripts/claim.sh` (now under `skills/to-task/`, renamed from `skills/to-slices/`)
still implements the OLD claim mechanism: `git mv work/backlog/<slug>.md ->
work/in-progress/<slug>.md` with a CAS push to the arbiter `main`. The CURRENT
protocol (`CLAIM-PROTOCOL.md`, ADR `ledger-status-on-per-item-lock-refs`) SUPERSEDED
this: a claim now acquires a per-item lock ref (`refs/agent-runner/lock/<type>-<slug>`)
and the body STAYS in `work/tasks/todo/` (claim writes NOTHING to `main`; there is no
`in-progress/` folder). So the bootstrap script is doubly drifted — old folder names
(`backlog`/`in-progress`) AND the old direct-`main` mechanism. This slice deliberately
left the script's behaviour untouched ("keep the script working"); a follow-up should
either retire `claim.sh` or rewrite it to the lock-ref protocol. Path is referenced in
`docs/adr/methodology-and-skills.md` and `docs/adr/execution-substrate-decisions.md`.
