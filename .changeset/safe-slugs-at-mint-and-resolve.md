---
'dorfl': patch
---

Slugs are now restricted to a safe character set, both where dorfl mints them and where any verb resolves them. A slug becomes a file name, a git ref and a CI command-line argument, and some are drafted from content an outsider controls.

**Minting.** `intake` derived a slug from the drafted slug or title through `paramCase` alone, which kept `$(`, backticks, `"`, `;`, `|` and `/`, so an issue titled `Support $(id) in config` produced `support-$(id)-in-config`. The triage promote and ADR-mint paths only `trim()`med the agent-drafted slug, so `../x` escaped its folder. All three now go through `ensureSafeSlug` (new `slug-safety.ts`): a slug that is already safe is kept exactly as drafted, and anything else becomes ASCII letters, digits and single hyphens (accents folded, capped at 120 characters). `Support $(id) in config` now yields `support-id-in-config`. The triage promote path also stamps the safe slug over a drafted body's own frontmatter `slug:`, since the ledger reads that before the file name.

**Resolving.** `do`, `advance` and the task-only commands (`claim`, `start`, `complete`, ...) now refuse a slug outside the safe set with a usage error that says how to fix it. This covers slugs no producer here minted, such as a hand-written frontmatter `slug:`. The accepted set is 1-120 letters, digits, `.`, `_` or `-`, starting and ending with a letter or digit, with no `..` and no `.lock` suffix (git refuses it in a ref), so every mixed-case or dotted slug already in use keeps working.

One visible consequence: a legacy prefix such as `prd:foo` or `slice:foo`, which since the hard cutover fell through as a literal task slug, is now refused (a `:` is not a slug character) with a message naming the live prefixes (`task:`, `spec:`, `obs:`, `observation:`). It still never reaches the old namespace.
