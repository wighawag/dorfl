---
'dorfl': patch
---

dorfl's own release and GitHub Pages workflows no longer restore an Actions cache. Both jobs hold `id-token: write` (npm trusted publishing, Pages deploy), and the Actions cache is shared per branch: a CI agent running on `main` can reach its job's `ACTIONS_RUNTIME_TOKEN` and write a cache entry that the release job would then restore and run while able to publish to npm. `setup-node` now runs without `cache: pnpm` (and, in the release job, with `package-manager-cache: false`), and a test fails if a cache restore returns to any job of this repository that holds a write permission or `id-token: write`. The cost is one uncached `pnpm install` per release run, so the release job gets slower. `docs/ci/README.md` now states the rule for consumers: in a repository where dorfl runs agents on the default branch, a workflow job that can write or publish must not restore an Actions cache.
