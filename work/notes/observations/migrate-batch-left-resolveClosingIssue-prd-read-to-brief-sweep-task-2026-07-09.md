# MIGRATE batch left `frontmatter.ts:resolveClosingIssue`'s `.spec` read to the brief-sweep/contract task (2026-07-09)

While doing the `spec→spec` MIGRATE batch (`rename-spec-frontmatter-field-and-slug-namespace`), the ONLY functional `.spec` read left in a `frontmatter.ts` own-helper is `resolveClosingIssue` (`frontmatter.ts:~476`), which reads `frontmatter.spec` and returns the `{via: 'brief', spec}` discriminated-union tag. I deliberately did NOT migrate this read here.

Why: (1) it is a NOT-YET-WIRED future close-job helper (its own JSDoc: "NOT wired into intake or any reader today"), so no reader breaks either way; (2) its whole shape (the `Pick<Frontmatter, 'spec' | 'issue'>` param, the `via: 'brief'` tag, the `spec` return field) is the `via: 'brief'` union the parent spec (`prd-to-spec-vocabulary-cutover-and-migration-command`, US #8/#11) explicitly assigns to the `{spec, brief} → spec` CONTRACT/brief-sweep task, not this migrate batch. Touching it here would fork that concept across two tasks.

Alternative considered: swap just the read to `frontmatter.spec` and add `'spec'` to the `Pick`, leaving the `via: 'brief'` tag. Rejected because it half-migrates a `brief`-tagged symbol the contract task owns end-to-end, and buys nothing (the helper is unwired). `parseFrontmatter` already populates `fm.spec` from either key, so the "frontmatter.ts helpers read fm.spec" acceptance intent is met by the wired reads; the unwired `via: 'brief'` helper is left whole for the contract task.

Touches: the contract/brief-sweep task in the same chain (it owns `via: 'brief' → 'spec'`). No behaviour change here.
