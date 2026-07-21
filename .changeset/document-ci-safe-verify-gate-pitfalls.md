---
'dorfl': patch
---

Document the CI-safe `verify` gate pitfalls (the project-toolchain boundary) in `docs/ci/README.md`.

`dorfl-setup` provisions only what dorfl needs (Node + dorfl + harness), not the project's toolchain — the documented-not-detected boundary from ADR `install-ci-project-provisioning-native-passthrough`. In practice a real repo's `verify` gate hits three concrete pitfalls that fail the GitHub `verify` check (while `merge`-mode work still lands via dorfl's own fresh-worktree gate, so they are easy to miss): (1) `dorfl verify` does NOT run `prepare`, so the job must provision the package manager + install deps itself (else `pnpm: command not found` / missing deps); (2) git-history-dependent gate steps like `changeset status --since=main` fail on a detached PR checkout with no local `main` branch; (3) `changeset status --since=main` can never pass on the changesets Version PR (`changeset-release/main`), which consumes changesets by design. The new "Writing a CI-safe `verify` gate" section documents each pitfall, the project-setup-hook remedy (a copy-pasteable GitHub `pnpm` example), and why a `merge`-mode repo can hit these late.
