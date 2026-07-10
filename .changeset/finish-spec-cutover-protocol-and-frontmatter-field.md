---
'dorfl': patch
---

Finish the `prd → spec` cutover the source part deferred: the vendored work-contract (`skills/setup/protocol/*`) now describes `work/specs/` folders and teaches the `spec:` authoring field (with `do spec:` / `advance spec:` verb forms and `spec`-named lock refs), and the code parent-spec pointer is `spec`-only. `parseFrontmatter` still reads BOTH the canonical `spec:` key and the legacy `prd:` key into `fm.spec`, so un-migrated downstream repos keep resolving their parent spec; the `Frontmatter.prd` field and its readers are gone. Also fixes a latent `resyncProtocol` bug where a protocol doc whose source could not be resolved bumped `work/protocol/VERSION` without copying anything (a missing source is now reported as a skip and never bumps VERSION). Downstream repos pick up the corrected contract by re-running `dorfl prd-to-spec` (or a setup re-sync).
