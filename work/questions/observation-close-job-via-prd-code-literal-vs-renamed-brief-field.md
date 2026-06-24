<!-- dorfl-sidecar: item=observation:close-job-via-prd-code-literal-vs-renamed-brief-field type=observation slug=close-job-via-prd-code-literal-vs-renamed-brief-field allAnswered=false -->

## Q1

**What becomes of this observation — the stale `via: 'prd'` code literal/branch in `packages/dorfl/src/close-job.ts` discriminating what is now conceptually a `brief:` field?**

> Observation (`work/notes/observations/close-job-via-prd-code-literal-vs-renamed-brief-field.md`, 2026-06-23) flags that `close-job.ts` still uses a LIVE local discriminator `via: 'issue' | 'prd'` (with `via: 'prd'` object literals and the `cand.via === 'prd'` branch — confirmed live at `packages/dorfl/src/close-job.ts:74,152,156,173`), while the concept it discriminates is now a BRIEF: its query reads the `brief:` frontmatter via `resolveClosingIssue`, which itself returns `via: 'brief' | 'issue'`. So the close-job `'prd'` literal is conceptually stale vs the renamed `brief:` field.
>
> It was flagged for the code-identifier rename lineage (brief `code-identifier-slice-prd-to-task-brief-rename`, in `work/briefs/tasked/`). However, that brief's broad symbol-rename task `rename-slicing-modules-and-symbols-to-tasking` is already in `work/tasks/done/`, and no remaining todo task (grep over `work/tasks/todo/`) mentions `close-job` or this `via` discriminator. The prose-only sweep `rename-src-comment-prose-slicing-to-tasking` explicitly excluded code identifiers/literals. So this residual escape currently has no owning task.
>
> Disposition choices: `promote-task` = cut a small follow-up rename task (flip `via: 'prd'` → `via: 'brief'` and the `cand.via === 'prd'` branch in `close-job.ts`, plus any local types) — clean-break matches Decisions 1–6 of the parent brief; `keep` = leave the observation if a broader residual-identifier sweep is expected; `dropped` (`reason: superseded by code-identifier-slice-prd-to-task-brief-rename`) only if you assert the parent brief's existing done/todo tasks are believed to cover this site (does not appear to be the case from the grep).

_Suggested default: promote-task — emit a tiny follow-up task under the parent brief lineage to rename the `via: 'prd'` literal/type/branch in `close-job.ts` to `'brief'` (clean break, matches the parent brief's CLEAN-BREAK posture, keeps acceptance gate green)._

<!-- q1 fields: id=q1 disposition=promote-task -->

**Your answer** (write below this line):
