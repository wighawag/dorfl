2026-06-23 (noticed during rename-src-comment-prose-slicing-to-tasking).

`close-job.ts` still uses a LIVE local discriminator `via: 'issue' | 'prd'` (and
`via: 'prd'` object literals + the `cand.via === 'prd'` branch). The concept it
discriminates is now a BRIEF (its query reads the `brief:` frontmatter field via
`resolveClosingIssue`, which itself returns `via: 'brief' | 'issue'`). So the
close-job `'prd'` literal is conceptually stale vs the renamed `brief:` field.
Left untouched here because it is a CODE identifier/literal (renaming it is out of
scope for the prose-only sweep) — flagging for the code-identifier rename lineage
(brief `code-identifier-slice-prd-to-task-brief-rename`).
