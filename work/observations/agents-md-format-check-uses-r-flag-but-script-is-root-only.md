# `pnpm -r format:check` in AGENTS.md fails — the script is root-only

2026-06-14 — Noticed while running the acceptance gate for slice
`isolated-config-read-main-only-fetch-and-reap-on-failure`.

`AGENTS.md` (this repo's "Acceptance gate" section) states the gate as
`pnpm -r build && pnpm -r test && pnpm -r format:check`, but `format:check` is a
ROOT package.json script (`prettier --check .`), not a per-package one. So
`pnpm -r format:check` exits with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT  None of the
selected packages has a "format:check" script`. The working command is
`pnpm format:check` (no `-r`). `build`/`test` DO exist per-package so the `-r`
form works for those. Minor doc drift; the real gate passes with `pnpm format:check`.
