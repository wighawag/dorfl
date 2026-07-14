---
'dorfl': patch
---

Add `dorfl --version` (and the lower-case `-v` alias) to print the installed CLI version.

The version is read at runtime from the package's own `package.json` (the single source of truth changesets bumps on release), so it never drifts from the published version. Previously `dorfl --version` errored with "unknown option '--version'".
