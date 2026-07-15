# dorfl

## 0.5.0

### Minor Changes

- 429deea: Tasking is now atomic-or-split-or-explore: a spec is tasked ATOMICALLY (every user story becomes a task, or none does) — there is no "partially tasked" state. The tasker decision procedure has three exhaustive branches: (1) all stories build-taskable now → task the whole spec; (2) mixed confidence / part gated → SPLIT into a fully-taskable spec plus a separate spec for the gated remainder; (3) the whole thing too big/uncertain to build-task → REFRAME as an EXPLORATION spec whose "done" is confidence + a de-risked, sliced build plan (the capability build becomes a follow-on spec, ordered via `taskedAfter:`).

  This forbids partially-tasking a spec (the human `to-task` path is now symmetric with the auto-tasker's whole-spec gate) and introduces a first-class spec KIND distinguished by its definition of DONE (build spec vs exploration spec), without adding any new folder or state — an exploration spec is still just a spec, tasked atomically, and its spikes reuse the existing `prototype` vocabulary. The `do spec:` auto-tasker prompt now routes a mis-scoped or too-big/uncertain spec to needs-attention (to be split or reframed) instead of emitting a confident subset or fictional build tasks. Recorded in ADRs `tasking-is-atomic-or-split-no-partial-tasked-state` and `exploration-vs-build-spec-kinds`; the `TASKING-PROTOCOL.md` protocol doc (source + `work/` mirror + vendored `dist/`) and the `to-spec`/`to-task` skills carry the rule.

## 0.4.0

### Minor Changes

- 65bed98: Add `dorfl sync` to bring an already-onboarded repo up to the current protocol.

  It re-syncs `work/protocol/*` from the package's canonical contract docs and bumps `work/protocol/VERSION` (idempotent: a no-op when already current), so a repo that adopted an older protocol picks up the latest in one command rather than re-running the whole `setup` skill. `--dry-run` previews the re-sync without writing.

  It can also refresh the operator's packaged skills: pass `--add-skills` to install them non-interactively (the flag bypasses the prompt), or answer the one-time confirmation an interactive run shows (a non-TTY run skips skills so a scripted `sync` never hangs). `--local` scopes that skills install to `<cwd>/.agents/skills/`.

  The protocol re-sync engine (`resyncProtocol` / `PROTOCOL_DOCS`) is now shared between `sync` and `prd-to-spec` via a new `resync-protocol` module (behaviour unchanged for `prd-to-spec`).

## 0.3.2

### Patch Changes

- 1cffdfb: Prefer the plain `dorfl.json` per-repo config filename while still reading the legacy `.dorfl.json` dotfile on fallback. This corrects a rename sweep that had flattened every reference to the legacy dotfile down to `dorfl.json`, making the fallback docs self-contradictory and breaking the brand/repo-config/install-ci tests. The legacy `.dorfl.json` name is now consistently documented and tested as the read-only fallback, and the preferred `dorfl.json` is the name written by `setup` and reported by `install-ci`.

## 0.3.1

### Patch Changes

- 1a79008: Add `dorfl --version` (and the lower-case `-v` alias) to print the installed CLI version.

  The version is read at runtime from the package's own `package.json` (the single source of truth changesets bumps on release), so it never drifts from the published version. Previously `dorfl --version` errored with "unknown option '--version'".

## 0.3.0

### Minor Changes

- e3a2c69: Remove the default acceptance gate: an unset `verify` now FAILS LOUD, and `dorfl verify` honours the per-repo `dorfl.json`.

  Two related fixes to the acceptance gate (`verify`):
  - **No more default gate (behaviour change).** Previously an unset or all-blank `verify` silently fell back to `pnpm -r build && pnpm -r test && pnpm -r format:check`. That was unsafe: in a non-pnpm repo (e.g. a Zig or Make project) it ran the WRONG check, and in a repo pnpm knows nothing about, `pnpm -r ...` prints "No projects found" and exits 0 — a VACUOUS GREEN that let unverified work cross the trust boundary. Dorfl now has NO default gate: `resolveVerifyCommands` throws `VerifyNotConfiguredError` on an unset/all-blank gate, `runVerify` turns that into a failing `notConfigured` result (never an uncaught crash), and the pre-claim `checkGatePreconditions` guard fails fast — MODE-INDEPENDENT, since a missing gate can never pass in any mode — before a wasted claim + build. A repo MUST now declare its own `verify` in `dorfl.json`.
  - **`dorfl verify` now reads the per-repo config.** The standalone `dorfl verify` command resolved its gate from the GLOBAL config only, ignoring a repo's committed `dorfl.json` `verify` entirely and running the old built-in default. It now resolves through the same per-repo chain the runner uses (flag > env > per-repo `dorfl.json` > global), matching its own help text and the `do`/`run`/`complete` paths.

  Migration: if you relied on the implicit default, add it explicitly, e.g. `"verify": "pnpm -r build && pnpm -r test && pnpm format:check"` (a single string or an ordered list of commands) to your `dorfl.json`.

## 0.2.1

### Patch Changes

- 319e7a0: WORK-CONTRACT: reword the `release-lock --entry <literal>` note to speak in the present. Drop the historical "pre-vocabulary-cutover `slice-<slug>` / `prd-<slug>` prefix" reference and describe the case generically (e.g. a lock entry left un-derivable after a rename).

## 0.2.0

### Minor Changes

- f854b2d: Retire the `stuck` lock state in favour of surfacing bounced work as answerable questions on `main`.

  A bounced or blocked item no longer parks as a `stuck` lock. Instead it is SURFACED on `main` as a `needsAnswers: true` pool item with a `work/questions/<slug>.md` sidecar, and its lock is released — so the state is visible in `git clone`, `ls work/questions/`, and `dorfl status`, and a human resolves it by answering the sidecar rather than by inspecting a lock ref. `LockState` collapses to a single `active` value (the in-flight hold); the crash-window orphan is the only lock that can outlive a leg, and it is nameable/clearable via `release-lock` (+ an orphan-lock report in `gc --ledger`).
  - **Surface-as-questions bounce.** The bounce seams now write the sidecar + flip `needsAnswers` + release the lock atomically, replacing the retired `active -> stuck` lock amend and the `needs-attention/` folder.
  - **Answer -> apply dispatch.** Answering a `kind: 'stuck'` sidecar drives a deterministic `keep | reset | cancel` verb (a sibling of the existing `kind: 'merge'` dispatch): `keep` continues from the kept `work/<slug>` branch tip, `reset` discards that branch first (the `requeue --reset` primitive) then continues, and `cancel` disposes the item to its terminal folder.
  - **One-shot migration.** A new `dorfl migrate-stuck-locks` verb drains any pre-existing `stuck` lock refs into the new surfaced-question shape, so retiring the state strands no already-stuck item.
  - **`requeue --reconcile`.** A non-destructive middle-rung recovery verb (between the default keep+continue and the destructive `--reset`) that re-syncs the mirror and retries the rebase of the kept branch onto latest `main`, pushing the reconciled tip back on success and never deleting the remote branch.
  - Docs, ADRs, and protocol contracts (`WORK-CONTRACT.md`, `CLAIM-PROTOCOL.md`, `REVIEW-PROTOCOL.md`) are reconciled to the active-hold-only model, and the `gc --ledger` report is renamed from "stuck-lock" to "orphan-lock".

### Patch Changes

- f89c803: Cleanup residual `prd` artifact-word after the hard cutover: flip the now-dead `prd:` field / `do prd:` verb references in `CONTEXT.md` to `spec:` / `do spec:`, and sweep the stale `prd`/`PRD` comment prose in a few living docs (`skills/orchestrate`, two ADRs) + dorfl's own generated `.github/workflows/*.yml` comments (the functional YAML was already `spec`; only comment prose was stale — a `dorfl install-ci` regen produces the same). Tighten the WORD leak scan (`prd-word-cutover-leak-scan.test.ts`) so the `prd:` field / `do prd:` verb PROSE exemption applies ONLY inside TERMINAL-HISTORY trees (`work/tasks/done|cancelled`, `work/specs/tasked|dropped`, append-only notes) where rewriting would falsify the record — a `prd:` / `do prd:` in a LIVING doc (CONTEXT/README/AGENTS/skills/docs/active-work) is now flagged as a leak, since the hard cutover made those forms dead. This caught (and fixed) 3 stale references the earlier sweep missed.
- 97d0a4c: Finish the `prd` → `spec` vocabulary-cutover cleanup: a general sweep of every remaining stale artifact-word `prd`/`PRD`/`Prd` (and the doubly-retired `brief`) that was the CONCEPT, made enforced-by-construction so it cannot re-drift.
  - **`packages/dorfl/src` prose swept to `spec`.** Stale mislabels of LIVE behaviour (a comment calling the current `'spec'` type/outcome/namespace `'prd'`) are corrected in `intake.ts`, `isolation.ts`, `workspace.ts`, `scan.ts`, `triage-persist.ts`, `advance.ts`, `advance-drivers.ts`, `decision-engine.ts`, `select-priority.ts`, `config.ts`, `needs-attention.ts` (incl. the `integration.prd` → `integration.spec` symbol ref); the `prd/task`, `{task | prd | adr}`, `mint-prd`, `prd \`land-…\``prose reads`spec/task`/`{task | spec | adr}`/`mint-spec`/`spec \`land-…\``; the stale `prd/review.md`/`prd → prd-tasked`folder narration reads`spec/review.md`/`specs/ready → specs/tasked`. The `vitest.config.ts` `do prd:`/`PRD`/`task-prd`comments read`do spec:`/`spec`/`task-spec`.
  - **Narrate-the-removal comments keep the retired token as a `''prd''` PROVENANCE MARKER** (double-single-quote), a uniquely-greppable handle distinct from ordinary backticks so `grep "''prd''"` finds exactly the "named here only as the retired token" mentions. PRESERVED untouched: the `prd-to-spec` migration command / verb / module, every `prd`-containing slug identity and namespace/lock-ref form (`prd-<slug>`, `prd-complete-query`, `prd-sliced-folder-step-a`, …), historical API names (`renderPrdBody`, `prdsLandIn`, …), the legacy FLAT-layout migration map (`work/prd/` → `work/specs/ready/`), and English.
  - **Living docs swept.** The now-dead `do prd:` verb / `prd:` field references in `skills/orchestrate`, `skills/from-idea`, `skills/to-task`, `skills/setup`, `docs/ci/README.md` read `do spec:` / `spec:`; the false "the legacy `prd:` key is still READ as back-compat" claims are deleted from the protocol SOURCE (`skills/setup/protocol/{WORK-CONTRACT,TASKING-PROTOCOL,task-template}.md`) and the byte-identical `work/protocol/` mirror.
  - **Enforcement is BI-WORD + tightened.** `prd-src-prose-leak-scan.test.ts` and `prd-word-cutover-leak-scan.test.ts` now also strip the `''…''` provenance-marker span (like a backtick span) and gain a `brief`/`BRIEF`/`Brief` lens (a `spec`-only scan would have passed a stray `brief`), with a `brief`-English allow-list (`debrief`/`briefly`/"a brief note") and the namespace/slug forms. The `brief` gate is scoped to LIVING DOCS (a `brief` in a `work/**` body is dated provenance narration; `docs/adr/**` is the deferred ADR pass). Each scan keeps its non-vacuous detector self-check (a planted bare `prd`/`brief` still fails; the marker/English/slug survivors do not) and asserts a concrete allow-list.

  The `docs/adr/**` sweep is INCLUDED: live-reference / stale-guidance `prd`/`brief` in the ADRs (the command-surface namespace table, the branch/lock naming scheme, `do prd:` mechanism refs, `brief-side` → `spec-side`, the taxonomy live-vocabulary line, the `to-task` frontmatter field, a spec cross-reference) is swept to `spec`; the genuine dated DECISION-RECORD mentions that must stay (the retired name AS the thing retired, e.g. "pre-rename `prd:` prefixes are no longer accepted" / "`prd-tasked` read as awkward", and the migration's pre-cutover INPUT, e.g. a `done/` full of dangling `prd:` refs) are backticked token references or wrapped in the ''…'' provenance marker. The bi-word `brief` gate now walks `docs/adr/**` with no deferred-tree carve-out.

  Note: the compiled `.github/workflows/*.yml` are regenerated by `dorfl install-ci` (not hand-edited); the only `prd` they carry is the exempt slug `prd-complete-query`, so a regen is a no-op here.

- fc7b41f: Remove the three `prd` → `spec` cutover leak-scan test gates. The vocabulary cutover and the stuck-lock migration are complete, so these transitional gates no longer guard a live invariant: the only remaining `prd` mentions are legitimate historical/provenance references to the retired `prd-` lock/branch namespace (which the `migrate-stuck-locks` feature, its docs, and its follow-up tasks must name), not fresh regressions. The tree-wide prose scan had flipped from a useful canary into pure friction, repeatedly failing builds on un-backticked-but-legitimate historical mentions in auto-generated task bodies (bouncing tasks with an opaque "acceptance gate failed on the rebased tip").

  Deleted: `prd-word-cutover-leak-scan.test.ts` (tree-wide WORD/PROSE scan), `prd-src-prose-leak-scan.test.ts` (src-dir prose scan), and `prd-to-spec-leak-scan.test.ts` (the cutover trust-signal gate). The functional `prd → spec` conversion feature and its tests (`prd-to-spec.test.ts`, `convert-from-prd-to-spec-skill-doc.test.ts`) are UNCHANGED — only the enforcement scans are removed.

## 0.1.2

### Patch Changes

- 375982d: Erase the `prd` artifact WORD everywhere it names the concept, making `spec` the one vocabulary across every human-readable tree (`CONTEXT.md`/`README.md`/`AGENTS.md`, `skills/` non-protocol, `docs/` incl. ADRs, and all of `work/**` history): the artifact word `prd`/`PRD`/`Prd` reads `spec`/`SPEC`/`Spec` (keep-case) and every `work/prds/` / `prds/<lifecycle>` folder path reads `work/specs/`. The one residual code leak is fixed: `tasking.ts` `buildTaskingSpec` now points a fresh tasker at the EXISTING `work/specs/ready|tasked/` paths via `workFolderRel('specs-ready'/'specs-tasked')` (never a hard-coded `work/prds/*` literal). Deliberately PRESERVED: every `prd`-containing slug identity / cross-reference (file basenames + frontmatter `slug:`/`spec:`/`blockedBy:`/`covers:` values, incl. the command's own `prd-to-spec` name), the live back-compat CODE aliases (`parseFrontmatter`'s `prd:` key read + the `do prd:` / `advance prd:` verb acceptance + their inert `refs/dorfl/lock/prd-<slug>` / `work/prd-<slug>` namespace forms + the legacy-flat-layout `work/prd/` migration-map source names), the camelCase historical API names in `tasks/done/` records (`renderPrdBody`, `prdTitle`, …), and English (none — `prd` is a coined acronym). A new WORD-scoped leak scan (`prd-word-cutover-leak-scan.test.ts`) gates every swept tree against a concrete, each-class-justified PRESERVE allow-list, so the cutover can never silently re-drift.
- 29fc7c6: HARD CUTOVER: remove the LAST `prd` back-compat surfaces so `spec` is the only accepted form (maintainer decision: NO backward compatibility for `prd`). (A) `parseFrontmatter` now reads ONLY the `spec:` key — the read-only `prd:` KEY alias is GONE, so an un-migrated `prd:` frontmatter field no longer silently resolves into `fm.spec` (a repo converts its data via the TEXTUAL `dorfl prd-to-spec` rewrite, which does not go through this parser, so the migration path is unaffected). (B) the dead `do prd:` / `advance prd:` verb references across `packages/dorfl/src` (help text, prompts, JSDoc, comments) are flipped to `do spec:` / `advance spec:` (the `prd:` namespace prefix was already a dead bare-literal token after the contract cutover), and every now-false "the legacy `prd:<slug>` is still accepted / still read" claim is removed from the `do`/`advance`/`promote` help, the `resolveTaskOnlySlug` JSDoc, and the `close-job` / `prompt` / `tasking` field-read comments (the field is `spec:` only). (C) the two leak scans stop exempting the `prd:` field/verb as a "live CODE back-compat alias": the SRC-prose scan (`prd-src-prose-leak-scan.test.ts`) now FAILS on a stray live `prd:` field-key or `do prd:` verb in `packages/dorfl/src` prose (the hard-cutover gate on live code); the WORD scan (`prd-word-cutover-leak-scan.test.ts`) re-documents its `prd:` prose exemption as PROVENANCE (terminal-history bodies/titles that record the dead field/verb as-it-was are immutable and must not be falsified), not a live alias. PRESERVED: the `dorfl prd-to-spec` migration command (whole-file exempt — it must keep matching `prd:` to convert it), provenance slugs / filenames / camelCase historical API names, and English. Coupled fixtures/tests flipped: `close-job` / `prompt` / `spec-complete` (`prd:` fixture frontmatter → `spec:`, `write('prd', …)` folder args → `specs-*`) and the `frontmatter` back-compat test now asserts the HARD CUTOVER (a `prd:` key is NOT read).

  Decision (recorded): the two leak scans were split rather than treated identically — the SRC-prose scan is the authoritative hard-cutover gate (removes the `prd:` exemption, fails on live `prd:`), while the WORD scan keeps its `prd:` prose exemption re-documented as PROVENANCE so immutable terminal-history bodies/titles that record the dead field/verb are not falsified (a full `work/**` history prose sweep was outside this task's declared D surface). See `work/notes/observations/word-scan-keeps-prd-colon-as-provenance-not-live-alias-2026-07-10.md`.

- 2618c6e: Finish the `prd` → `spec` word cutover inside `packages/dorfl/src`: the last non-identifier residual the two prior scans did not gate. The artifact word `prd`/`PRD`/`Prd` now reads `spec`/`SPEC`/`Spec` (keep-case) in comment/JSDoc PROSE and in live runtime + agent-prompt STRINGS, and every `work/prds/` / `prds/<lifecycle>` folder path reads `work/specs/`. The four load-bearing runtime/prompt strings that pointed a fresh agent/user at a `work/prds/` folder that no longer exists in a migrated repo are fixed to build their paths from `workFolderRel`/`workItemRel('specs-*')` (never a hard-coded `work/prds/*` literal), exactly like `buildTaskingSpec`: the `promote` `--help` + its "nothing staged" message (`cli.ts`), the intake decision-prompt spec-file path (`intake.ts`), and the two tasker/review agent prompts that tell the reviewer which source spec to read (`review-gate.ts`, `tasker-review-loop.ts`). Deliberately PRESERVED: the published back-compat CODE aliases (`parseFrontmatter`'s `prd:` key read, the `do prd:` / `advance prd:` verb dispatch + the `prd:<slug>` grammar its `--help` advertises as the accepted legacy alias, the `'prd'` namespace/type/outcome literals, the sidecar `prd-<slug>.md` file-path fallback, `PRD_PREFIX`), every `prd`-containing slug identity in doc-comment attributions (`prd-complete-query`, `prd-sliced-folder-step-a`, …), camelCase historical API names, backticked references to the retired token, the `dorfl prd-to-spec` migration command whose `--help` legitimately names the legacy `work/prds/*` folder as its migration SOURCE, and English. A new source-scoped leak scan (`prd-src-prose-leak-scan.test.ts`) gates `packages/dorfl/src` prose + `work/prds/` runtime strings against a concrete, each-class-justified code-alias allow-list so `src` can never re-drift; the WORD scan (`prd-word-cutover-leak-scan.test.ts`) gains a small, non-vacuous provenance-file exemption for the `prd`-cutover task/observation bodies that legitimately quote the retired word.

## 0.1.1

### Patch Changes

- babb3c5: Finish the `prd → spec` cutover the source part deferred: the vendored work-contract (`skills/setup/protocol/*`) now describes `work/specs/` folders and teaches the `spec:` authoring field (with `do spec:` / `advance spec:` verb forms and `spec`-named lock refs), and the code parent-spec pointer is `spec`-only. `parseFrontmatter` still reads BOTH the canonical `spec:` key and the legacy `prd:` key into `fm.spec`, so un-migrated downstream repos keep resolving their parent spec; the `Frontmatter.prd` field and its readers are gone. Also fixes a latent `resyncProtocol` bug where a protocol doc whose source could not be resolved bumped `work/protocol/VERSION` without copying anything (a missing source is now reported as a skip and never bumps VERSION). Downstream repos pick up the corrected contract by re-running `dorfl prd-to-spec` (or a setup re-sync).

## 0.1.0

### Minor Changes

- 7ddabb6: First public release of `dorfl` — the agent-native work-execution tool (claim → build → gate → integrate), the `spec` work-contract, and the `dorfl prd-to-spec` migration command for repos on the legacy `prd` vocabulary.
