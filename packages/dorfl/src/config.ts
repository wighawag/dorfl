import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {brand} from './brand.js';
import {type Identity, validateIdentity} from './identity.js';
import {
	DEFAULT_SELECTION_ORDER,
	type SelectionOrderConfig,
} from './select-order.js';

/**
 * How a completed item is integrated back to the arbiter's `main`. `merge` lands
 * it directly on `main` (ff/rebase + push); `propose` pushes a branch + requests
 * review. (`propose` is provider-neutral; the old `pr` name was GitHub jargon.
 * See ADR §6.)
 */
export type IntegrationMode = 'propose' | 'merge';

/**
 * **Per-repo TASK-PLACEMENT default** (spec
 * `staging-pool-position-gate-and-trust-model`, task
 * `runner-deterministic-slice-placement-policy-and-precedence`, governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`). Which
 * folder the runner lands the tasker's emitted task files in BY DEFAULT —
 * `'pre-backlog'` (staging — durable + readable but NOT in the agent-eligible
 * POOL; a runner/human promotion is needed to make an item claimable; the on-disk
 * folder for this value is `work/tasks/backlog/`) or `'ready'` (the agent-eligible
 * POOL — the trusted fast-path landing, on-disk `work/tasks/ready/`). The pool
 * value was renamed `'backlog'` → `'todo'` → `'ready'` (ADR
 * `rename-task-pool-folder-todo-to-ready`, a CLEAN BREAK matching the on-disk
 * folder `tasks/ready/` and the spec-side `'ready'` pool spelling). The runner-deterministic
 * placement RESOLVER (`src/placement.ts`) layers on top: `explicit operator flag
 * > untrusted-origin ⇒ pre-backlog > tasksLandIn default > built-in
 * (pre-backlog)`. An untrusted-origin tasker output is FORCED to staging even in
 * a `'ready'` repo (the positional analogue of the existing
 * `untrusted-origin-forces-build-propose` rule).
 */
export type TasksLandIn = 'pre-backlog' | 'ready';

/**
 * **Per-repo SPEC-PLACEMENT default** (spec
 * `staging-pool-position-gate-and-trust-model`, task
 * `pre-prd-staging-pool-split-and-untrusted-prd-placement`, governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`). Which
 * folder the runner lands `intake`-authored spec files in BY DEFAULT —
 * `'pre-proposed'` (staging — durable + readable but NOT in the auto-tasking
 * POOL; a runner/human promotion is needed to make the spec auto-taskable; the
 * on-disk folder for this value is `work/specs/proposed/`) or `'ready'` (the
 * auto-tasking POOL — the trusted fast-path landing, on-disk
 * `work/specs/ready/`). The same runner-deterministic placement RESOLVER
 * (`src/placement.ts`) layers on top:
 * `explicit operator flag > untrusted-origin ⇒ pre-proposed > specsLandIn
 * default > built-in (pre-proposed)`. An untrusted-origin intake spec is FORCED
 * to staging even in a `'ready'` repo (the positional analogue of the existing
 * `untrusted-origin-forces-build-propose` rule). The SPEC twin of
 * {@link TasksLandIn}; the SAME shape, the SAME precedence chain. The value
 * spellings mirror the live spec folders (`specs/proposed/` staging,
 * `specs/ready/` pool), exactly as {@link TasksLandIn} mirrors the task folders.
 */
export type SpecsLandIn = 'pre-proposed' | 'ready';

/**
 * The observation-triage gate (ADR `ci-config-policy-and-gate-family` §2): a
 * 3-state ENUM governing the observation INBOX (raw captured signal). It REPLACES
 * the old `autoTriage` boolean, whose name read like "is triage on?" but only
 * gated the auto-DISPOSITION exception (the resolved naming trap). The three
 * states say what they gate:
 *   - `off` (default): the triage rung is dropped from the auto-pick SELECTION —
 *     observations are left untouched (the NEW state the boolean could not
 *     express, "leave my observations alone entirely");
 *   - `ask`: the observation pool IS selected; surface a promote/keep/delete
 *     question for every untriaged observation (the old `autoTriage:false`);
 *   - `auto`: the observation pool is selected; auto-dispose ONLY the no-question
 *     cases (exact-duplicate ⇒ recommend delete; unambiguous map) and surface a
 *     question for the rest (the old `autoTriage:true`). It still NEVER
 *     auto-deletes a non-duplicate or auto-promotes a judgement call.
 */
export type ObservationTriage = 'off' | 'ask' | 'auto';

/**
 * **The `mergeQuestions` gate axis** — the 3-state member of the question-
 * surfacing gate family that governs the MERGE-QUESTION surfacer (spec
 * `land-time-reverify-and-parallel-merge-ceiling` Story 17 / task
 * `merge-questions-gate-axis`). MIRRORS `observationTriage`'s shape
 * (`off | ask | auto`) but is a SEPARATE axis — "should this built work merge?"
 * is materially more consequential than "is this observation worth promoting?",
 * so a merge-question must NEVER ride `observationTriage` and must NOT default
 * `off` (a silently-dropped merge-question means finished, pushed work never
 * lands). The states:
 *   - `off` ⇒ the merge-question surfacer is not invoked (only correct for a
 *     repo that lands by some other means);
 *   - `ask` (DEFAULT) ⇒ the surfacer enumerates unmerged `work/*` branches +
 *     emits a merge-question sidecar; a human's plain `merge | hold | drop`
 *     answer is required before the land. The conservative default that honours
 *     propose semantics and never silently drops pushed work;
 *   - `auto` ⇒ the runner self-supplies the `merge` answer without surfacing
 *     and lands through the SAME deterministic answer-driven runner-action
 *     dispatch + apply-time re-verify (the merge-mode-like fast path). Does NOT
 *     invoke the agentic decider — a merge-land is never an agent decision.
 * Resolved through the SAME precedence chain as the other gates (flag > env >
 * per-repo > global > default `ask`). The exact name + default + shape were
 * answered in this task's Applied answers 2026-06-26 (q1/q2/q3) + SPEC sidecar
 * Q3.
 */
export type MergeQuestions = 'off' | 'ask' | 'auto';

/**
 * Which harness adapter (ADR §5) launches a job's agent and reports its
 * liveness: `null` (shell out to `agentCmd`) or `pi` (the pi CLI). Selected via
 * the `harness` config field; defaults to `null`.
 */
export type HarnessAdapter = 'null' | 'pi';

/**
 * The `propose`-mode review-request provider (ADR §6): `github` (`gh pr
 * create`) or `none` (push-only). This names which provider the ARBITER URL
 * RESOLVES to (`selectProvider`) — it is NOT a config OVERRIDE axis (there is
 * none; the provider is purely arbiter-derived: a GitHub remote ⇒ `github`, else
 * `none`). Whether `gh` can actually open the PR is the identity's
 * `providers.github` / ambient `gh` auth; whether to open a PR at all is the
 * separate `noPR` intent. `merge` mode is provider-agnostic and ignores all of
 * this.
 */
export type ReviewProviderName = 'none' | 'github';

/**
 * The per-repo acceptance gate: a single shell command, or an ordered list of
 * commands run in sequence (all must pass). See `verify.ts` / ADR §8.
 */
export type VerifyConfig = string | string[];

/**
 * **The `promptGuidance` NAMESPACE** — per-repo prompt-text NUDGES the runner
 * folds into the worker's in-band prompt (`prompt.ts` + `CLAIM-PROTOCOL.md`).
 * Categorically SEPARATE from the gate family (`verify`/`autoBuild`/`humanOnly`):
 * a nudge changes the agent's DISPOSITION, never the acceptance bar (the `verify`
 * gate is still the sole pass/fail). The namespace name is deliberate — it
 * signals "guidance, not guarantee" — and is shaped to grow (`testFirst` is just
 * the first member; later siblings, e.g. `preferSmallDiffs`, land here too).
 */
export interface PromptGuidance {
	/**
	 * Strengthen the wrapper's existing soft "TDD where the task asks for it"
	 * line into an explicit TEST-FIRST nudge ("at the agreed seam, write the
	 * failing test BEFORE the production code; this is guidance, not a gate —
	 * the `verify` step still decides pass/fail"). The strengthened text lives
	 * in `CLAIM-PROTOCOL.md` (the single source of truth), gated by the
	 * `<!-- if promptGuidance.testFirst --> … <!-- else --> … <!-- /if -->`
	 * conditional-fragment convention the extractor in `prompt.ts` honours.
	 * Default `false` (omitted ⇒ false); the worker prompt is byte-identical
	 * to today when this is off. Resolved like the gate family: flag > env
	 * (`DORFL_PROMPT_GUIDANCE_TEST_FIRST`) > per-repo > global >
	 * default (`false`). NEVER an enforced acceptance criterion.
	 */
	testFirst: boolean;
}

/**
 * Resolve the `promptGuidance` namespace down to its concrete boolean fields
 * with the documented defaults applied — so callers can read
 * `resolvePromptGuidance(cfg).testFirst` without re-checking the namespace's
 * presence (a per-repo file may legitimately omit `promptGuidance` entirely,
 * or supply only a subset). Mirrors the gate family's defaults-resolved
 * convention.
 */
export function resolvePromptGuidance(cfg: Config): PromptGuidance {
	return {testFirst: cfg.promptGuidance?.testFirst === true};
}

/**
 * Resolved runner configuration. There is NO `roots`/`remotes` field: discovery
 * is the registered hub-mirror set under `<workspacesDir>/repos/` (the registry,
 * ADR `command-surface-and-journeys` §1), NOT a config roots walk. `scan` reads
 * the eligibility fields per repo; `run --once` additionally consumes the
 * execution fields (maxParallel, perRepoMax, defaultArbiter, integration,
 * agentCmd).
 */
export interface Config {
	/**
	 * Per-repo policy: may agents auto-BUILD *undeclared* (not `humanOnly`) tasks
	 * in this repo? `false` (default, strict) ⇒ agents claim nothing automatically;
	 * `true` ⇒ agents may claim any task that is not `humanOnly: true`. Resolved
	 * like `integration`: flag (`--auto-build`/`--no-auto-build`) > `DORFL_AUTO_BUILD`
	 * env > per-repo > global > default. The build member of the per-action gate family
	 * (`autoBuild`/`autoTask` + the question-surfacing gates `observationTriage`/
	 * `surfaceBlockers`).
	 */
	autoBuild: boolean;
	/**
	 * **The `promptGuidance` NUDGE namespace** (see {@link PromptGuidance}). A
	 * NUDGE modifies the worker's IN-BAND PROMPT text (`prompt.ts` + the
	 * `CLAIM-PROTOCOL.md` wrapper); it is CATEGORICALLY SEPARATE from the gate
	 * family (`verify`/`autoBuild`/`humanOnly`) — guidance, never guarantee. The
	 * `verify` gate's semantics are unaffected regardless of any value here.
	 * Resolution mirrors the gate family per-member: flag > env > per-repo >
	 * global > default. Defaults to `{testFirst: false}` (worker prompt is
	 * byte-identical to today when every member is off). Designed to grow:
	 * later sibling nudges (e.g. `preferSmallDiffs`) land as new members.
	 */
	promptGuidance: PromptGuidance;
	/**
	 * Per-repo policy: may an agent auto-task *undeclared* (not `humanOnly`,
	 * no open questions) prds in this repo? `false` (default, strict, human-first)
	 * ⇒ a human must drive every spec's tasking; `true` ⇒ an agent may auto-task
	 * any spec that is not `humanOnly: true` and has no `needsAnswers`. Resolved like
	 * `autoBuild`: flag > `DORFL_AUTO_TASK` env > per-repo > global >
	 * default. The two-axis tasking gate (`work/specs/auto-task.md`), one level up
	 * from the build gate's `autoBuild`.
	 */
	autoTask: boolean;
	/**
	 * Per-repo policy governing the OBSERVATION INBOX (raw captured signal) — the
	 * 3-state member of the question-surfacing gate family (its sibling is
	 * `surfaceBlockers`, which governs DECLARED blocked work; the two are orthogonal
	 * peers, ADR `ci-config-policy-and-gate-family` §2). It REPLACES the old
	 * `autoTriage` boolean (cleanly, no alias — this repo has no external users yet,
	 * decided 2026-06-12). `off` (default) ⇒ the triage pool is dropped from the
	 * auto-pick SELECTION (observations untouched); `ask` ⇒ surface a
	 * promote/keep/delete question for every untriaged observation; `auto` ⇒
	 * auto-dispose ONLY the no-question cases (duplicate ⇒ recommend delete /
	 * unambiguous map) and surface a question for the rest (still NEVER auto-deletes
	 * a non-duplicate or auto-promotes). Resolved like `integration`/`autoBuild`:
	 * flag (`--observation-triage`) > `DORFL_OBSERVATION_TRIAGE` env >
	 * per-repo > global > default `off`. Gates the CREATE phase only; APPLY (consume
	 * a committed answer) stays ALWAYS allowed.
	 */
	observationTriage: ObservationTriage;
	/**
	 * Per-repo policy governing the MERGE-QUESTION SURFACER — the 3-state member
	 * of the question-surfacing gate family (spec
	 * `land-time-reverify-and-parallel-merge-ceiling` Story 17 / task
	 * `merge-questions-gate-axis`). MIRRORS `observationTriage`'s SHAPE
	 * (`off | ask | auto`) but is a SEPARATE axis with a DIFFERENT default —
	 * `observationTriage` defaults `off` (a dropped observation is safely
	 * ignorable), `mergeQuestions` defaults `ask` (a dropped merge-question means
	 * pushed work never lands). `off` ⇒ the surfacer is NOT invoked (only for a
	 * repo that lands by some other means); `ask` (default) ⇒ the surfacer
	 * enumerates unmerged `work/*` branches and emits a merge-question sidecar a
	 * human answers; `auto` ⇒ the runner self-supplies the `merge` answer without
	 * surfacing and lands via the SAME deterministic answer-driven runner-action
	 * dispatch + apply-time re-verify (the merge-mode-like fast path; NOT the
	 * agentic decider). Resolved like `observationTriage`/`integration`: flag
	 * (`--merge-questions`) > `DORFL_MERGE_QUESTIONS` env > per-repo > global >
	 * default `ask`. Gates the SURFACE phase of the merge-question loop only;
	 * APPLY (consume a committed merge-answer) stays ALWAYS allowed (the
	 * create-vs-consume invariant the gate family obeys, ADR
	 * `ci-config-policy-and-gate-family` §4).
	 */
	mergeQuestions: MergeQuestions;
	/**
	 * Per-repo policy governing DECLARED blocked work — the BOOLEAN member of the
	 * question-surfacing gate family (its orthogonal PEER is `observationTriage`,
	 * which governs the raw observation INBOX; ADR `ci-config-policy-and-gate-family`
	 * §2). It gates whether a task/spec carrying `needsAnswers: true` is rendered
	 * into an answerable question sidecar (`on`) or left silently blocked in the
	 * backlog (`off`). `false` (default, calm) ⇒ the `needsAnswers`-blocked pool is
	 * dropped from the auto-pick SELECTION, so a bare `advance` does NOT proactively
	 * surface a declared blocker; `true` ⇒ the blocked pool IS enumerated and
	 * `advance`'s surface rung renders the declared blocker into a sidecar the human
	 * can answer + unblock in-repo. This is a DIFFERENT job from `observationTriage`:
	 * it is about committed work items, not the raw inbox (so
	 * `observationTriage: ask|auto` + `surfaceBlockers: off` — "groom my inbox, leave
	 * my blocked work alone" — is expressible). Resolved like `autoBuild`: flag
	 * (`--surface-blockers`/`--no-surface-blockers`) > `DORFL_SURFACE_BLOCKERS`
	 * env > per-repo > global > default `false`. Gates the CREATE (surface) phase
	 * only; APPLY (consume a committed answer) stays ALWAYS allowed, and
	 * `needs-attention` (a stuck build) is a SEPARATE always-on mechanism this gate
	 * does NOT touch.
	 */
	surfaceBlockers: boolean;
	/**
	 * Per-repo policy governing whether SURFACING (the question-minting polarity)
	 * inspects STAGING in addition to the agent pool — the BOOLEAN gate-family
	 * member added by spec `staging-surface-and-apply-promote-safety` (F2). The
	 * BUILD polarity is UNCHANGED in either mode: staging items stay non-claimable,
	 * the trust model is untouched. `true` (default) ⇒ the SURFACE candidate set
	 * draws from STAGING (`tasks/backlog/`, `specs/proposed/`) PLUS the pool, so
	 * a `needsAnswers` task/spec in staging surfaces its questions BEFORE a human
	 * promotes it (you promote an already-clarified item, not blind and then get
	 * asked after); `false` ⇒ the legacy POOL-ONLY behaviour (staging is not
	 * inspected for questions). Resolved like `surfaceBlockers`/`autoBuild`:
	 * flag > `DORFL_SURFACE_STAGING` env > per-repo > global > default
	 * `true`. Surfacing is read-only-ish (writes a question sidecar; touches only
	 * the item's per-item lock), so widening it into staging does NOT loosen the
	 * BUILD trust gate — it only stops the surface polarity from being
	 * gratuitously trust-gated identically to it.
	 */
	surfaceStaging: boolean;
	/**
	 * Per-repo SELECTION ORDER across the four ORDERABLE auto-pick pools (`build` =
	 * eligible tasks, `task` = taskable prds, `surface` = `needsAnswers`
	 * blockers, `triage` = untriaged observations). `apply` (consume a committed
	 * answer) is PINNED FIRST and is NOT orderable (consume-always-wins). The value
	 * is EITHER a PRESET keyword (`drain` (default) ⇒ `[build, task, surface,
	 * triage]`, drain ready work then create then ask; `groom` ⇒ `[surface, triage,
	 * build, task]`) OR an explicit ordered pool-name list (the env comma form
	 * `build,task,surface,triage`); the preset is sugar over the list. It only
	 * REORDERS pools; the gates decide what is PRESENT (a gated-off pool named in
	 * the order is a no-op). SUBSUMES the old `prdsFirst` boolean: `drain`
	 * reproduces its default, `[task, build, ...]` reproduces `prdsFirst: true`.
	 * Resolved per-repo like `autoBuild`/`autoTask`: flag
	 * (`--selection-order`) > `DORFL_SELECTION_ORDER` env (the `'list'`
	 * coercion) > per-repo > global > default (`drain`). An unknown name/keyword
	 * FAILS LOUDLY (`select-order.ts` `resolveSelectionOrder`).
	 */
	selectionOrder: SelectionOrderConfig;
	/** Global cap on how many items the runner claims+runs in one tick. */
	maxParallel: number;
	/** Per-repo cap on concurrent claims (≤ maxParallel in effect). */
	perRepoMax: number;
	/** Name of the git remote that serializes claims (the arbiter). */
	defaultArbiter: string;
	/**
	 * The execution working area: bare hub mirrors (`<dir>/repos/<key>.git`) and
	 * job worktrees (`<dir>/work/<work-id>/`). STATE, not cache (ADR §3) — lives
	 * under a single visible `~/.dorfl/`, NEVER `~/.cache`. Overridable so
	 * tests (and unusual setups) can relocate it.
	 */
	workspacesDir: string;
	/**
	 * Where local `--bare` arbiters (offline source of truth) are provisioned:
	 * `<dir>/<host>/<org>/<name>.git` (hierarchical, reusing the repo→key
	 * encoding). Arbiters are precious DATA, not state/cache (ADR §7): they live
	 * under a visible `~/git/` and MUST NEVER be placed under `~/.dorfl/`
	 * (a `gc`/cleanup mishap could nuke the only copy). Overridable so tests can
	 * relocate it.
	 */
	arbitersDir: string;
	/**
	 * Where the HUMAN `work-on` command checks out its parallel worktrees:
	 * `<dir>/<key>/<slug>/` on branch `work/<slug>`. This is a **human-only**,
	 * editor-facing area — deliberately NOT under `~/.dorfl/` (the agents'
	 * execution state, ADR §3), so a `work-on` worktree never carries the human's
	 * secrets into an agent context. It is intentionally OPTIONAL with **no silent
	 * default**: `work-on` prompts for it on first use and saves it here (offering a
	 * sensible suggestion that does NOT share a prefix with the user's code dirs, so
	 * shell tab-completion never collides). `undefined` ⇒ not yet configured.
	 */
	humanWorktreesDir?: string;
	/** Integration mode for completed items: `propose` (default) or `merge`. */
	integration: IntegrationMode;
	/**
	 * **Per-TRANSITION override for the spec→tasks (TASKING) transition only.** When
	 * set, the tasking transition (a `do spec:<slug>` run: emit `work/tasks/backlog/*.md` +
	 * the `work/specs/ready/ → work/specs/tasked/` lifecycle move) integrates with THIS
	 * mode instead of the flat {@link integration}; the task-BUILD transition is
	 * unaffected (it always reads {@link integration}). UNSET (the default) ⇒ tasking
	 * falls back to {@link integration} — byte-for-byte today's behaviour for any repo
	 * that does not set it. The maintainer's target is `integration: 'propose'` +
	 * `taskingIntegration: 'merge'`: task a spec straight onto `main` (the task FILES
	 * land, no PR) but build each task as a reviewable PR. Resolved per-repo like
	 * {@link integration}: flag (`--merge`/`--propose`) > env
	 * (`DORFL_TASKING_INTEGRATION`) > per-repo > global > (fall back to)
	 * `integration` > default `propose`. DISTINCT from intake's per-EMITTED-TYPE
	 * `{task, spec}` resolver (front door, author-trust-resolved): this is a
	 * per-LIFECYCLE-TRANSITION knob, inside the trust boundary, operator/config-only.
	 */
	taskingIntegration?: IntegrationMode;
	/**
	 * **Per-repo DEFAULT landing for the TASKER's emitted tasks** (spec
	 * `staging-pool-position-gate-and-trust-model` US #5, task
	 * `runner-deterministic-slice-placement-policy-and-precedence`). Resolved
	 * per-repo EXACTLY like {@link taskingIntegration} (flag `--tasks-land-in`
	 * > env `DORFL_TASKS_LAND_IN` > per-repo > global > built-in
	 * `'pre-backlog'`). The tasking path reads it and passes it as the
	 * CONFIGURED-DEFAULT rung into the shared placement resolver
	 * (`src/placement.ts`); the resolver overlays an EXPLICIT operator flag
	 * (top) and the UNTRUSTED-ORIGIN force (staging) on top, in that order. The
	 * tasker NEVER sets placement itself. Spec US #6 / the governing ADR: the
	 * runner OWNS placement from unforgeable inputs; the agent cannot
	 * influence it.
	 */
	tasksLandIn: TasksLandIn;
	/**
	 * **Per-repo DEFAULT landing for `intake`-authored spec files** (spec
	 * `staging-pool-position-gate-and-trust-model` US #2/#5/#6/#12). The SPEC twin
	 * of {@link tasksLandIn}: resolved per-repo EXACTLY like it (flag
	 * `--specs-land-in` > env `DORFL_SPECS_LAND_IN` > per-repo > global >
	 * built-in `'pre-proposed'`). `intake`'s spec dispatch reads it and passes it as
	 * the CONFIGURED-DEFAULT rung into the shared placement resolver
	 * (`src/placement.ts`); the resolver overlays an EXPLICIT operator flag
	 * (top) and the UNTRUSTED-ORIGIN force (staging) on top, in that order.
	 * `intake` NEVER sets placement itself. Spec US #6 / the governing ADR: the
	 * runner OWNS placement from unforgeable inputs; the agent cannot
	 * influence it. KEY-LEVEL SYMMETRY with `tasksLandIn` — one resolver, two
	 * lifecycles, one precedence change touches ONE place.
	 *
	 * The sole spec-placement key after the ''prd'' → `spec` HARD CUTOVER (spec
	 * `prd-to-spec-vocabulary-cutover-and-migration-command`): the legacy
	 * `prdsLandIn` config key + `--prds-land-in` flag are GONE (clean break).
	 */
	specsLandIn: SpecsLandIn;
	/**
	 * **The PR-INTENT axis** (ADR §6): on the `propose` path, do NOT open a review
	 * request even on a GitHub arbiter with auth — push the branch (the
	 * safety-bearing recovery point) but SKIP `openRequest`. `true` ⇒ deliberately
	 * no PR (the explicit, no-warning "suppress the PR" intent that re-homes the old
	 * `provider: none` use); `false`/unset (default) ⇒ "I want a PR", so propose
	 * opens it via the arbiter-derived provider as normal. This is NOT a provider
	 * choice — `selectProvider` stays purely arbiter-derived; `noPR` is an intent
	 * LAYERED on top. Its honest-failure twin: when `noPR` is unset + propose + a
	 * GitHub arbiter but a `gh` auth PROBE says `gh` cannot open a PR, the run FAILS
	 * UP FRONT (a pre-flight guard) instead of silently degrading. `merge` mode
	 * ignores it (it never opens a PR). Resolved per-repo like `review`: flag
	 * (`--no-pr`) > env > per-repo > global > default `false`.
	 */
	noPR: boolean;
	/**
	 * The command the runner shells out to for one task. The runner appends the
	 * built prompt on stdin; the command does NO git ops on the repo (the runner
	 * owns those). Empty string ⇒ no agent configured (run will refuse). Consumed
	 * by the **null** harness adapter (it shells out to this verbatim); the **pi**
	 * adapter ignores it (it invokes the pi CLI directly — see `harness`).
	 */
	agentCmd: string;
	/**
	 * The model a job's agent runs on (harness-agnostic ROUTING intent, ADR §13).
	 * dorfl decides WHICH model; it never touches auth/keys (those stay the
	 * harness's job). Optional with NO default so "unset" is meaningful: unset ⇒
	 * dorfl forces no model (the harness's own default / a model baked into
	 * `agentCmd` is used untouched). Carried through the harness seam
	 * (`LaunchInput.model`); the ADAPTER decides HOW it reaches its tool — the pi
	 * adapter passes `--model <model>` natively, the null/shell adapter substitutes
	 * a `{model}` placeholder in `agentCmd`. Resolved per-repo like `integration`:
	 * flag (`--model`) > env > per-repo > global > default (unset).
	 */
	model?: string;
	/**
	 * Which harness adapter launches + reports liveness for a job's agent (the
	 * harness seam, ADR §5): `null` (default — shells out to `agentCmd`,
	 * PID-only liveness) or `pi` (invokes the pi CLI with the work-agent prompt;
	 * liveness from PID + the pi session dir/log, never mtime). pi specifics stay
	 * behind the adapter; the core only sees the `Harness` interface.
	 */
	harness?: HarnessAdapter;
	/**
	 * The pi CLI binary the `pi` harness invokes (default `pi` on `PATH`).
	 * Overridable so an operator can pin a path; tests stub it. Ignored unless
	 * `harness` is `pi`.
	 */
	piBin?: string;
	/**
	 * The ROOT folder under which the runner generates a job's pi session FILE —
	 * the adapter passes `--session <sessionsDir>/<unique-id>.jsonl` (a literal
	 * file path pi creates + writes; never `--session-dir`). A **HOST-ONLY machine
	 * path** (same class as `piBin`/`workspacesDir`): resolved flag (`--sessions-
	 * dir`) > env (`DORFL_SESSIONS_DIR`) > global > default — there is NO
	 * per-repo layer (a committed repo file must not redirect where the host writes
	 * session logs), so it is in `REPO_REJECTED_KEYS`. Optional with a DYNAMIC
	 * default (NOT a `DEFAULT_CONFIG` entry): unset ⇒ the path generator derives
	 * pi's default per-cwd sessions folder at launch from the job cwd (a direct
	 * child of `~/.pi/agent/sessions/`, so the dashboard's non-recursive `listAll`
	 * scans it). Set ⇒ any folder (e.g. a dedicated `run` fleet folder).
	 */
	sessionsDir?: string;
	/**
	 * The per-repo ENV-PREP step (install deps, fetch submodules, run codegen) —
	 * the SIBLING of `verify`, NOT part of it. `prepare` makes a freshly-
	 * materialised worktree's environment READY; `verify` checks the tree is
	 * GREEN. The runner sequences `prepare` THEN `verify`: `prepare` runs ONCE,
	 * before the FIRST `verify`, on a worktree that needs deps but does not have
	 * them (a fresh job worktree off the hub mirror). Install MUST NOT be baked
	 * into `verify` — that would make `verify` stop being a pure, cheaply-re-
	 * runnable acceptance check and make every gate run pay the install cost.
	 * `prepare` is where install belongs. A deterministic shell command (or an
	 * ordered list, all must pass); no model in the loop. Same shape and the SAME
	 * resolution/precedence as `verify` (flag > env > per-repo > global > default).
	 * The ONE difference from `verify`: unset (omitted) ⇒ NO prepare step (a
	 * no-op) — there is NO default install (a repo with no deps needs none; we
	 * never invent a default that would run `pnpm install` in a repo that has no
	 * lockfile). See `prepare.ts`.
	 */
	prepare?: VerifyConfig;
	/**
	 * The per-repo acceptance gate run by `dorfl verify` (a deterministic
	 * shell command, or an ordered list of commands). NOT per-task and NOT model-
	 * interpreted — it is declared, auditable config (ADR §8). Unset (omitted) ⇒
	 * a sensible `pnpm -r build && test && format:check` default; the field is
	 * intentionally optional so "unset" is distinguishable from "empty". Install
	 * must NOT be baked into `verify` — env-prep belongs in the sibling `prepare`
	 * field, which the runner runs ONCE before the first `verify` on a fresh
	 * worktree (the prepare=env-ready / verify=tree-green split).
	 */
	verify?: VerifyConfig;
	/**
	 * **Gate 2 — the PR/code review gate** (GATES spec `work/specs/tasked/review.md`): run the
	 * `review` SKILL as a fresh-context judgement gate ON TOP of the deterministic
	 * `verify` floor, AFTER `verify` passes and BEFORE the done-move, on the
	 * `do`/`complete` path. Default **OFF** (it puts a model on the merge path —
	 * opt-in, ADR §8). Resolved per-repo like `integration`: flag
	 * (`--review`/`--no-review`) > env > per-repo > global > default false.
	 * `verify` is never replaced — review is layered, never a substitute.
	 */
	review: boolean;
	/**
	 * The model the REVIEW agent runs on (de-correlation from the builder's
	 * `model`). Optional with NO default so "unset" means "no forced review model"
	 * (the harness's own default). Carried to the review-agent launch through the
	 * EXISTING harness seam (`LaunchInput.model` / `substituteModel`) — NOT a new
	 * mechanism. Resolved like `model`: flag (`--review-model`) > env > per-repo >
	 * global > default (unset). Distinct from the builder's `model`.
	 */
	reviewModel?: string;
	/**
	 * How many CORROBORATING review rounds Gate 2 runs on the SAME tip. Semantics are
	 * UNANIMOUS-APPROVAL, not retry-until-pass: the gate approves ONLY if EVERY round
	 * approves, and a `block` is TERMINAL (it short-circuits the loop and is never
	 * re-rolled — re-reviewing an unchanged tip after a block would just be a
	 * stochastic dice re-roll that could launder a real reject into a pass). So a
	 * value > 1 makes a FALSE APPROVE harder to slip through (each extra round is a
	 * veto), it does NOT give blocked work a second chance. A non-approve forces the
	 * item stuck (the lock `state: stuck`; never silently merges or loops), per the maintainer
	 * decision. Default a small N (2): two independent approvals required. (A future
	 * builder-REVISE step that MUTATES the tree between rounds is the only thing that
	 * should make a block retryable, because it changes the artifact under review; it
	 * is not implemented yet.) Resolved like `integration`: flag
	 * (`--review-max-rounds`) > env > per-repo > global > default.
	 */
	reviewMaxRounds: number;
	/**
	 * **The tasker IMPROVER loop on/off toggle** (`--tasker-loop` /
	 * `--no-tasker-loop`). On the `do spec:<slug>` tasking path the improver loop is
	 * the task path's quality engine (auto-tasking has no `verify` floor), so it is
	 * ON by default; setting this false gates wiring the loop seam (the candidate
	 * tasks land as-is). Resolved per-repo like `integration`: flag
	 * (`--tasker-loop`/`--no-tasker-loop`) > env > per-repo > global > default (on).
	 * DISTINCT from the acceptance gate's `review` toggle.
	 */
	taskerLoop: boolean;
	/**
	 * **The tasker IMPROVER loop's convergence cap** (`slicer-review-edit-loop`,
	 * GATES spec `work/specs/tasked/review.md` RESOLVED DESIGN — Shape 2 / insertion point
	 * A). On the `do spec:<slug>` tasking path, AFTER the agent produces candidate
	 * tasks the loop runs the `review` SKILL, APPLIES its edits, and re-reviews
	 * until a pass finds no NEW blocking issue (the natural terminator).
	 * `taskerLoopMax` is the HARD CAP on the in-context review passes (N) so the
	 * loop can never run forever; on hitting it WITH unresolved blockers the loop
	 * REJECTS via the needsAnswers / needs-attention sink. It lives on the LOOP,
	 * never on a gate (the orphaned `reviewMaxRounds` belongs to the Gate-2 path —
	 * separate cleanup). A cheap default (3). Resolved per-repo like `integration`:
	 * flag (`--tasker-loop-max`) > env > per-repo > global > default. Distinct from
	 * Gate-2's `reviewMaxRounds`.
	 */
	taskerLoopMax: number;
	/**
	 * The model the tasker IMPROVER loop's review agent runs on (de-correlation
	 * from the tasker). Optional with NO default so "unset" means "no forced model"
	 * (the harness's own default). Carried to the review-agent launch through the
	 * EXISTING harness seam (`LaunchInput.model` / `substituteModel`). Resolved like
	 * `model`: flag (`--tasker-loop-model`) > env > per-repo > global > default
	 * (unset). DISTINCT from the acceptance gate's `reviewModel` (build
	 * `--review-model`).
	 */
	taskerLoopModel?: string;
	/**
	 * **The fresh-worktree acceptance-gate toggle** (`--fresh-worktree-gate` /
	 * `--no-fresh-worktree-gate`). When ON (the default), the acceptance gate
	 * (`prepare` then `verify`) runs in a CLEAN throwaway worktree cut from the
	 * work branch REBASED onto the latest `<arbiter>/main` — i.e. the exact tree
	 * the arbiter will integrate — rather than the agent's pre-rebase working
	 * checkout. So a green gate provably describes the merged artifact: a
	 * gitignored/uncommitted file the checkout has but the committed/pushed tree
	 * does NOT cannot leak into a falsely-green gate, and a change introduced only
	 * by the integration rebase IS gated. When OFF (`freshWorktreeGate: false` /
	 * `--no-fresh-worktree-gate`), `verify` runs in the agent's build worktree
	 * exactly as before (the PRE-rebase gate) — the opt-out for when the per-gate
	 * install cost is too high. The throwaway gate worktree is fresh (no deps), so
	 * `prepare` runs in it before `verify` (the per-gate install cost the opt-out
	 * exists for). Modelled EXACTLY on `taskerLoop`: a POSITIVE boolean, default
	 * ON, `--no-` negation. Resolved per-repo like `integration`: flag
	 * (`--fresh-worktree-gate`/`--no-fresh-worktree-gate`) > env > per-repo >
	 * global > default (on). DISTINCT from `review`/`taskerLoop` (a separate
	 * concern: WHICH tree the gate runs against, not whether a review runs).
	 *
	 * The shared gate→integrate band (`performIntegration`) simply HONOURS the
	 * boolean it is handed (caller-agnostic). The `run` FLEET caller passes
	 * `(resolvedFlag && perRepoMax === 1)` so the fresh gate is used only when
	 * same-repo concurrency is OFF (two pre-existing run-fleet races would
	 * otherwise fire at `perRepoMax > 1`; they are their own task). Single-job
	 * callers (`do` in-place / `--isolated` / `--remote` / `complete`) pass the
	 * resolved flag UNCONDITIONALLY.
	 */
	freshWorktreeGate: boolean;
	/**
	 * **The cross-job merge serialiser's CAS-retry cap** — the git-alone FLOOR of the
	 * land-time cross-job queue (spec `land-time-reverify-and-parallel-merge-ceiling`,
	 * Story 5 + Applied Answer q1 (a)). The merge-mode `${branch}:main` push retries
	 * a non-fast-forward rejection by re-rebasing onto the moved `<arbiter>/main` and
	 * pushing again, up to this cap; only after exhaustion does a loser bounce to
	 * needs-attention. The in-process `integrateLock` only serialises sibling
	 * INTEGRATES in ONE process; across separate CI jobs the CAS loop IS the queue,
	 * and this cap is what determines how wide a matrix burst converges before any
	 * spurious bounce. A wide-matrix CI raises it; the default stays modest. Race-1
	 * safety is unchanged (a lost CAS costs only a re-rebase + re-gate retry, never a
	 * `--force`, never a both-land-broken) — scaling the cap only changes WHEN a
	 * genuinely-stuck loser gives up. Resolved per-repo like `freshWorktreeGate`:
	 * flag (`--merge-retries`) > env (`DORFL_MERGE_RETRIES`) > per-repo > global >
	 * default. The default matches `integration-core.ts`'s built-in fallback (1000 —
	 * the C2 rebase-until-real-conflict liveness ceiling, not a small Race-1 budget),
	 * so resolving it through this layer is byte-for-byte today's behaviour when no
	 * source sets it. Forwarded into `performIntegration`'s `mergeRetries` (resolved
	 * ONCE per `performIntegration` call, fixed across that call's CAS-retry loop —
	 * the same per-item resolution `freshWorktreeGate` / `review` use).
	 */
	mergeRetries: number;
	/**
	 * **Per-repo OPT-IN strictness layered on the OQ6 stale-approval default**
	 * (spec `land-time-reverify-and-parallel-merge-ceiling`, sidecar OQ6 / task
	 * `strict-merge-approval-gate`). Controls how the apply rung treats a prior
	 * merge-answer when the merge-base CHANGED between the human's answer and
	 * the apply step. The default (`false`) honours the prior answer and lands
	 * when the rebased tip re-verifies GREEN — a green re-verify is trusted as
	 * sufficient (the cheap fast-path). `true` re-surfaces the merge-question
	 * (clears the answer back to no-answer and re-authors the question on
	 * `main`/runner under the `advancing` lock — no branch-side mutation)
	 * instead of auto-landing on a merge-base change, even on a green re-verify
	 * — the host-agnostic analogue of GitHub's "dismiss stale approvals when
	 * the base changes". Story #16's RED-re-verify refusal is UNCHANGED and
	 * independent of this flag.
	 *
	 * This module ONLY resolves the boolean; the re-surface vs. land branch
	 * lives in `apply-rung-merge-disposition`'s consumer. Resolved per-repo
	 * through the SAME gate-family precedence chain as the sibling gates
	 * (flag `--strict-merge-approval` > env `DORFL_STRICT_MERGE_APPROVAL` >
	 * per-repo > global > default `false`). DOES NOT alter `mergeQuestions` /
	 * `observationTriage` default or shape — a SEPARATE, independent axis.
	 */
	strictMergeApproval: boolean;
	/**
	 * The optional runner **identity** (a bot): run the runner's git + provider
	 * operations as a configured entity via process-scoped env overrides, without
	 * mutating the user's global git/`gh` config (see `identity.ts`). HOST-ONLY
	 * (it carries secrets and is per-machine) ⇒ rejected in a per-repo file
	 * (`REPO_REJECTED_KEYS`); it lives only in the global config. Optional with NO
	 * default: unset ⇒ fully ambient (today's behaviour, byte-for-byte) — the CI
	 * path relies on `actions/checkout`'s ambient HTTPS+`GITHUB_TOKEN`. When set,
	 * `auth` is mandatory and validated at load time ({@link validateIdentity}).
	 */
	identity?: Identity;
}

/** A partial config, e.g. loaded from a JSON file or built from CLI flags. */
export type PartialConfig = Partial<Config>;

/**
 * The DEPRECATED config/env keys: present in an OLD config keeps working but is
 * IGNORED with a one-line warning (never a hard error), so an existing setup is
 * not broken by a removal. Each maps to the human-facing replacement hint. Mirrors
 * the `allowAgents`→`autoBuild` removal-with-warning precedent.
 *
 * `provider` (the review-request provider OVERRIDE + `--provider` flag) was
 * removed: the provider is purely ARBITER-derived now (a GitHub remote ⇒ the
 * GitHub provider, else `none`), so an override could only contradict the arbiter.
 * The legitimate `provider: none` use ("suppress the PR") is re-homed to the
 * `noPR` intent axis.
 */
export const DEPRECATED_CONFIG_KEYS: Readonly<Record<string, string>> = {
	provider:
		'the `provider` axis was removed — the review-request provider is now purely ' +
		'arbiter-derived (a GitHub remote ⇒ the GitHub provider, else none). To ' +
		'deliberately suppress the PR (the old `provider: none` use), set `noPR: true` ' +
		'(or pass `--no-pr`).',
};

/**
 * Warn (once per offending key) for any DEPRECATED key present in a parsed config
 * object, then DELETE it from the object so it never lingers in the resolved
 * config. A stale key is IGNORED, not an error — an existing config keeps working.
 * For `provider`, the warning points specifically at the `noPR` replacement when
 * the stale value was the old `none` ("suppress the PR") use.
 */
export function warnDeprecatedConfigKeys(
	parsed: Record<string, unknown>,
	source: string,
	warn: (message: string) => void = (m) => console.error(`>> ${m}`),
): void {
	for (const key of Object.keys(DEPRECATED_CONFIG_KEYS)) {
		if (!(key in parsed) || parsed[key] === undefined) {
			continue;
		}
		const staleNone = key === 'provider' && parsed[key] === 'none';
		const hint = DEPRECATED_CONFIG_KEYS[key];
		warn(
			`Ignoring deprecated key '${key}' in ${source}: ${hint}` +
				(staleNone
					? ' (your `provider: none` maps directly to `noPR: true`.)'
					: ''),
		);
		delete parsed[key];
	}
}

/**
 * Built-in defaults. Chosen so that zero-config is useful: stay strict about the
 * autonomy gate (agents claim nothing unless a repo opts in via `autoBuild`).
 * Discovery has no default `roots` — it is the registered hub-mirror set (empty
 * until `remote add`/`remote find` registers a target).
 */
export const DEFAULT_CONFIG: Config = {
	autoBuild: false,
	// The `promptGuidance` nudge namespace defaults to ALL members off — so the
	// worker prompt is byte-identical to today when no repo opts in. NOT a gate;
	// `verify` remains the sole acceptance bar regardless.
	promptGuidance: {testFirst: false},
	// Auto-tasking is human-first by default: an agent tasks nothing unless a
	// repo opts in via `autoTask` (mirrors `autoBuild`, one level up).
	autoTask: false,
	// The observation INBOX is calm by default (`off`): the triage pool is dropped
	// from the auto-pick selection, so observations are left untouched unless a repo
	// opts in via `observationTriage` (`ask` ⇒ surface a question for each; `auto` ⇒
	// auto-dispose the no-question cases). ADR `ci-config-policy-and-gate-family` §3.
	observationTriage: 'off',
	// The merge-question SURFACER defaults to `ask` — the conservative default
	// (spec `land-time-reverify-and-parallel-merge-ceiling` Applied answer q2 /
	// task `merge-questions-gate-axis` Applied answer q2). NEVER `off` by default:
	// a silently-dropped merge-question means finished, pushed work never lands —
	// strictly more consequential than a dropped observation-promote prompt, so
	// this gate axis is DELIBERATELY HIGHER than `observationTriage`'s `off`. A
	// trusted-repo fast path opts into `auto` (runner self-supplies the `merge`
	// answer + lands via the SAME deterministic apply-time re-verify); a repo that
	// lands by some other means opts into `off`. Resolved per-repo through the
	// SAME precedence chain (flag > env > per-repo > global > default).
	mergeQuestions: 'ask',
	// DECLARED blocked work is calm by default (`false`): the `needsAnswers`-blocked
	// pool is dropped from the auto-pick selection, so `advance` does NOT proactively
	// render a declared blocker into a question sidecar unless a repo opts in via
	// `surfaceBlockers`. Orthogonal PEER to `observationTriage`; `needs-attention`
	// (a stuck build) is separate + always-on. ADR `ci-config-policy-and-gate-family` §3.
	surfaceBlockers: false,
	// SURFACING widens to STAGING by default (`true`) — a `needsAnswers` task in
	// `tasks/backlog/` or a `needsAnswers` spec in `specs/proposed/` surfaces
	// its questions BEFORE promotion, so a human promotes an already-clarified
	// item. Spec `staging-surface-and-apply-promote-safety` (F2). BUILD/claim
	// stays pool-only + trust-gated regardless: this widens ONLY the surface
	// polarity, not the build polarity. Set `false` to restore the legacy
	// pool-only surface behaviour.
	surfaceStaging: true,
	// The `drain` selection-order preset by default (ADR `ci-config-policy-and-gate-
	// family`, selection-order section): drain ready work (build eligible tasks →
	// task taskable prds) before creating/asking (surface → triage); `apply` is
	// always first. Reproduces today's tasks-first two-pool default. Subsumes the
	// removed `prdsFirst` boolean (`[task, build, ...]` reproduces `prdsFirst: true`).
	selectionOrder: DEFAULT_SELECTION_ORDER,
	maxParallel: 4,
	perRepoMax: 2,
	defaultArbiter: 'origin',
	workspacesDir: join(homedir(), brand.workdirName),
	arbitersDir: join(homedir(), 'git'),
	integration: 'propose',
	// The PR-INTENT axis defaults to `false` ("I want a PR"): on a GitHub arbiter,
	// propose opens the PR via the arbiter-derived provider. Set `true` to push the
	// branch but deliberately skip the PR (the explicit suppress-PR intent that
	// re-homes the old `provider: none` use). NOT a provider choice.
	noPR: false,
	// The tasker's emitted tasks land STAGED (`pre-backlog/`) by default — the
	// conservative landing that preserves the tracer task's behaviour: an item is
	// durable + readable but NOT in the agent-eligible pool until a human/runner
	// promotes it. A repo opts into the trusted fast-path with `tasksLandIn:
	// 'ready'` (or `--tasks-land-in ready` / `DORFL_TASKS_LAND_IN=ready`).
	// The runner-deterministic resolver overlays explicit-flag + untrusted-origin
	// force on top of this default (`src/placement.ts`).
	tasksLandIn: 'pre-backlog',
	// `intake`-authored specs land STAGED (`pre-proposed/`) by default — the
	// conservative landing that mirrors `tasksLandIn`'s built-in floor: a spec is
	// durable + readable but NOT in the auto-tasking POOL until a human/runner
	// promotes it. A repo opts into the trusted fast-path with `specsLandIn: 'ready'`
	// (or `--specs-land-in ready` / `DORFL_SPECS_LAND_IN=ready`). The same
	// runner-deterministic resolver overlays explicit-flag + untrusted-origin
	// force on top of this default (`src/placement.ts`).
	specsLandIn: 'pre-proposed',
	agentCmd: '',
	// Gate 2 (PR/code review) defaults OFF — it puts a model on the merge path, so
	// it is opt-in (ADR §8). On an `approve` a resolved `merge` lands automatically
	// (`merge` IS the auto-land mode); `propose` always leaves the merge to a human.
	// The loop bound is a small N so an unattended revise↔review can never run forever.
	review: false,
	reviewMaxRounds: 2,
	// The tasker improver loop is ON by default — auto-tasking has no `verify`
	// floor, so the loop is the task path's quality engine (distinct from the
	// acceptance gate's `review`, which defaults OFF).
	taskerLoop: true,
	// The tasker improver loop's hard cap on in-context review passes — a cheap
	// default so an unattended review→edit→re-review can never run forever (the
	// natural terminator is "no new blocking issue"; this is the ceiling on top).
	taskerLoopMax: 3,
	// The fresh-worktree acceptance gate is ON by default: most CI/tooling caches
	// deps so `pnpm install` is fast, so correctness-first (the gate tests what
	// MERGES, not the agent's pre-rebase checkout) is the right default. The
	// opt-out (`--no-fresh-worktree-gate`) runs `verify` in the build worktree as
	// before, for when the per-gate install cost is too high. Mirrors `taskerLoop`
	// (positive name, default-on).
	freshWorktreeGate: true,
	// The cross-job merge serialiser's CAS-retry cap — the git-alone FLOOR of the
	// land-time cross-job queue (spec `land-time-reverify-and-parallel-merge-ceiling`,
	// Story 5 + Applied Answer q1 (a)). Matches `integration-core.ts`'s built-in
	// `DEFAULT_MERGE_RETRIES` fallback (1000 — the C2 large liveness ceiling, NOT a
	// small Race-1 budget) so resolving it through this layer is byte-for-byte
	// today's behaviour when no source sets it. A wide-matrix CI raises it via
	// `--merge-retries`/`DORFL_MERGE_RETRIES`/per-repo `mergeRetries`.
	mergeRetries: 1000,
	// The strict-merge-approval gate defaults OFF (sidecar OQ6 / task
	// `strict-merge-approval-gate`): the cheap "green re-verify is enough" path
	// is the default; the OQ6 SPEC answer pins this. A repo opts in to the
	// host-agnostic "dismiss stale approvals on base change" discipline with
	// `strictMergeApproval: true` (or `--strict-merge-approval` /
	// `DORFL_STRICT_MERGE_APPROVAL=true`). The re-surface vs. land branch is
	// `apply-rung-merge-disposition`'s consumer, NOT here.
	strictMergeApproval: false,
};

/** The conventional config location (`~/.config/dorfl/config.json`). */
export function defaultConfigPath(): string {
	return join(homedir(), '.config', brand.configDirName, 'config.json');
}

/** Merge a partial config over the built-in defaults; arrays are replaced. */
export function mergeConfig(overrides: PartialConfig): Config {
	const merged: Config = {...DEFAULT_CONFIG};
	// Iterate the override's own keys (not the defaults') so optional keys like
	// `verify` (absent from DEFAULT_CONFIG, left unset by design) are carried over.
	for (const key of Object.keys(overrides) as (keyof Config)[]) {
		const value = overrides[key];
		if (value !== undefined) {
			// Assign through `unknown`: each key's value type matches by construction.
			(merged as Record<keyof Config, unknown>)[key] = value;
		}
	}
	return merged;
}

/**
 * Persist `config` to `path` as pretty JSON (creating the parent dir). Used by
 * `work-on` to SAVE the prompted `humanWorktreesDir` on first use so the human is
 * never asked again. Only the keys present in `config` are written — we round-trip
 * whatever the loader produced (defaults + file + the new key), which keeps the
 * on-disk file explicit and stable.
 */
export function saveConfig(config: PartialConfig, path: string): void {
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Load config from `path`, merged over defaults. A missing file is not an error
 * (defaults make the tool work out of the box); invalid JSON is.
 */
export function loadConfig(path: string = defaultConfigPath()): Config {
	if (!existsSync(path)) {
		return mergeConfig({});
	}
	let raw: string;
	try {
		raw = readFileSync(path, 'utf8');
	} catch (err) {
		throw new Error(
			`Failed to read config at ${path}: ${(err as Error).message}`,
		);
	}
	let parsed: PartialConfig;
	try {
		parsed = JSON.parse(raw) as PartialConfig;
	} catch (err) {
		throw new Error(
			`Invalid JSON in config at ${path}: ${(err as Error).message}`,
		);
	}
	// Drop (with a one-line warning) any DEPRECATED key (e.g. the removed `provider`
	// override) so an existing config keeps working — ignored, never a hard error.
	warnDeprecatedConfigKeys(parsed as Record<string, unknown>, path);
	// Validate a present identity at LOAD time (dumb — no arbiter URL resolution;
	// the transport-coherence check is push-time). A bad identity is a hard config
	// error, never a silent ambient fallback.
	if (parsed.identity !== undefined) {
		try {
			validateIdentity(parsed.identity);
		} catch (err) {
			throw new Error(
				`Invalid identity in config at ${path}: ${(err as Error).message}`,
			);
		}
	}
	return mergeConfig(parsed);
}
