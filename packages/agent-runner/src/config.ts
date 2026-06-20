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
 * **Per-repo SLICE-PLACEMENT default** (PRD
 * `staging-pool-position-gate-and-trust-model`, slice
 * `runner-deterministic-slice-placement-policy-and-precedence`, governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`). Which
 * folder the runner lands the slicer's emitted slice files in BY DEFAULT —
 * `'pre-backlog'` (staging — durable + readable but NOT in the agent-eligible
 * pool; a runner/human promotion is needed to make an item claimable) or
 * `'backlog'` (the agent-eligible POOL — the trusted fast-path landing). The
 * runner-deterministic placement RESOLVER (`src/placement.ts`) layers on top:
 * `explicit operator flag > untrusted-origin ⇒ pre-backlog > slicesLandIn
 * default > built-in (pre-backlog)`. An untrusted-origin slicer output is
 * FORCED to staging even in a `'backlog'` repo (the positional analogue of
 * the existing `untrusted-origin-forces-build-propose` rule).
 */
export type SlicesLandIn = 'pre-backlog' | 'backlog';

/**
 * **Per-repo PRD-PLACEMENT default** (PRD
 * `staging-pool-position-gate-and-trust-model`, slice
 * `pre-prd-staging-pool-split-and-untrusted-prd-placement`, governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`). Which
 * folder the runner lands `intake`-authored PRD files in BY DEFAULT —
 * `'pre-prd'` (staging — durable + readable but NOT in the auto-slice POOL; a
 * runner/human promotion is needed to make the PRD auto-sliceable) or
 * `'prd'` (the auto-slice POOL — the trusted fast-path landing). The same
 * runner-deterministic placement RESOLVER (`src/placement.ts`) layers on top:
 * `explicit operator flag > untrusted-origin ⇒ pre-prd > prdsLandIn
 * default > built-in (pre-prd)`. An untrusted-origin intake PRD is FORCED to
 * staging even in a `'prd'` repo (the positional analogue of the existing
 * `untrusted-origin-forces-build-propose` rule). The PRD twin of
 * {@link SlicesLandIn}; the SAME shape, the SAME precedence chain. STEP A
 * (this slice) keeps `prd/` as the auto-slice pool name; the STEP-B taxonomy
 * rename to `prd-ready/` is deferred to
 * `work/prd/folder-taxonomy-reorg-and-rename.md`.
 */
export type PrdsLandIn = 'pre-prd' | 'prd';

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
 * Resolved runner configuration. There is NO `roots`/`remotes` field: discovery
 * is the registered hub-mirror set under `<workspacesDir>/repos/` (the registry,
 * ADR `command-surface-and-journeys` §1), NOT a config roots walk. `scan` reads
 * the eligibility fields per repo; `run --once` additionally consumes the
 * execution fields (maxParallel, perRepoMax, defaultArbiter, integration,
 * agentCmd).
 */
export interface Config {
	/**
	 * Per-repo policy: may agents auto-BUILD *undeclared* (not `humanOnly`) slices
	 * in this repo? `false` (default, strict) ⇒ agents claim nothing automatically;
	 * `true` ⇒ agents may claim any slice that is not `humanOnly: true`. Resolved
	 * like `integration`: flag (`--auto-build`/`--no-auto-build`) > `AGENT_RUNNER_AUTO_BUILD`
	 * env > per-repo > global > default. The build member of the per-action gate family
	 * (`autoBuild`/`autoSlice` + the question-surfacing gates `observationTriage`/
	 * `surfaceBlockers`).
	 */
	autoBuild: boolean;
	/**
	 * Per-repo policy: may an agent auto-slice *undeclared* (not `humanOnly`,
	 * no open questions) PRDs in this repo? `false` (default, strict, human-first)
	 * ⇒ a human must drive every PRD's slicing; `true` ⇒ an agent may auto-slice
	 * any PRD that is not `humanOnly: true` and has no `needsAnswers`. Resolved like
	 * `autoBuild`: flag > `AGENT_RUNNER_AUTO_SLICE` env > per-repo > global >
	 * default. The two-axis slicing gate (`work/prd/auto-slice.md`), one level up
	 * from the build gate's `autoBuild`.
	 */
	autoSlice: boolean;
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
	 * flag (`--observation-triage`) > `AGENT_RUNNER_OBSERVATION_TRIAGE` env >
	 * per-repo > global > default `off`. Gates the CREATE phase only; APPLY (consume
	 * a committed answer) stays ALWAYS allowed.
	 */
	observationTriage: ObservationTriage;
	/**
	 * Per-repo policy governing DECLARED blocked work — the BOOLEAN member of the
	 * question-surfacing gate family (its orthogonal PEER is `observationTriage`,
	 * which governs the raw observation INBOX; ADR `ci-config-policy-and-gate-family`
	 * §2). It gates whether a slice/PRD carrying `needsAnswers: true` is rendered
	 * into an answerable question sidecar (`on`) or left silently blocked in the
	 * backlog (`off`). `false` (default, calm) ⇒ the `needsAnswers`-blocked pool is
	 * dropped from the auto-pick SELECTION, so a bare `advance` does NOT proactively
	 * surface a declared blocker; `true` ⇒ the blocked pool IS enumerated and
	 * `advance`'s surface rung renders the declared blocker into a sidecar the human
	 * can answer + unblock in-repo. This is a DIFFERENT job from `observationTriage`:
	 * it is about committed work items, not the raw inbox (so
	 * `observationTriage: ask|auto` + `surfaceBlockers: off` — "groom my inbox, leave
	 * my blocked work alone" — is expressible). Resolved like `autoBuild`: flag
	 * (`--surface-blockers`/`--no-surface-blockers`) > `AGENT_RUNNER_SURFACE_BLOCKERS`
	 * env > per-repo > global > default `false`. Gates the CREATE (surface) phase
	 * only; APPLY (consume a committed answer) stays ALWAYS allowed, and
	 * `needs-attention` (a stuck build) is a SEPARATE always-on mechanism this gate
	 * does NOT touch.
	 */
	surfaceBlockers: boolean;
	/**
	 * Per-repo SELECTION ORDER across the four ORDERABLE auto-pick pools (`build` =
	 * eligible slices, `slice` = sliceable PRDs, `surface` = `needsAnswers`
	 * blockers, `triage` = untriaged observations). `apply` (consume a committed
	 * answer) is PINNED FIRST and is NOT orderable (consume-always-wins). The value
	 * is EITHER a PRESET keyword (`drain` (default) ⇒ `[build, slice, surface,
	 * triage]`, drain ready work then create then ask; `groom` ⇒ `[surface, triage,
	 * build, slice]`) OR an explicit ordered pool-name list (the env comma form
	 * `build,slice,surface,triage`); the preset is sugar over the list. It only
	 * REORDERS pools; the gates decide what is PRESENT (a gated-off pool named in
	 * the order is a no-op). SUBSUMES the old `prdsFirst` boolean: `drain`
	 * reproduces its default, `[slice, build, ...]` reproduces `prdsFirst: true`.
	 * Resolved per-repo like `autoBuild`/`autoSlice`: flag
	 * (`--selection-order`) > `AGENT_RUNNER_SELECTION_ORDER` env (the `'list'`
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
	 * under a single visible `~/.agent-runner/`, NEVER `~/.cache`. Overridable so
	 * tests (and unusual setups) can relocate it.
	 */
	workspacesDir: string;
	/**
	 * Where local `--bare` arbiters (offline source of truth) are provisioned:
	 * `<dir>/<host>/<org>/<name>.git` (hierarchical, reusing the repo→key
	 * encoding). Arbiters are precious DATA, not state/cache (ADR §7): they live
	 * under a visible `~/git/` and MUST NEVER be placed under `~/.agent-runner/`
	 * (a `gc`/cleanup mishap could nuke the only copy). Overridable so tests can
	 * relocate it.
	 */
	arbitersDir: string;
	/**
	 * Where the HUMAN `work-on` command checks out its parallel worktrees:
	 * `<dir>/<key>/<slug>/` on branch `work/<slug>`. This is a **human-only**,
	 * editor-facing area — deliberately NOT under `~/.agent-runner/` (the agents'
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
	 * **Per-TRANSITION override for the PRD→slices (SLICING) transition only.** When
	 * set, the slicing transition (a `do prd:<slug>` run: emit `work/backlog/*.md` +
	 * the `work/prd/ → work/prd-sliced/` lifecycle move) integrates with THIS
	 * mode instead of the flat {@link integration}; the slice-BUILD transition is
	 * unaffected (it always reads {@link integration}). UNSET (the default) ⇒ slicing
	 * falls back to {@link integration} — byte-for-byte today's behaviour for any repo
	 * that does not set it. The maintainer's target is `integration: 'propose'` +
	 * `slicingIntegration: 'merge'`: slice a PRD straight onto `main` (the slice FILES
	 * land, no PR) but build each slice as a reviewable PR. Resolved per-repo like
	 * {@link integration}: flag (`--merge`/`--propose`) > env
	 * (`AGENT_RUNNER_SLICING_INTEGRATION`) > per-repo > global > (fall back to)
	 * `integration` > default `propose`. DISTINCT from intake's per-EMITTED-TYPE
	 * `{slice, prd}` resolver (front door, author-trust-resolved): this is a
	 * per-LIFECYCLE-TRANSITION knob, inside the trust boundary, operator/config-only.
	 */
	slicingIntegration?: IntegrationMode;
	/**
	 * **Per-repo DEFAULT landing for the SLICER's emitted slices** (PRD
	 * `staging-pool-position-gate-and-trust-model` US #5, slice
	 * `runner-deterministic-slice-placement-policy-and-precedence`). Resolved
	 * per-repo EXACTLY like {@link slicingIntegration} (flag `--slices-land-in`
	 * > env `AGENT_RUNNER_SLICES_LAND_IN` > per-repo > global > built-in
	 * `'pre-backlog'`). The slicing path reads it and passes it as the
	 * CONFIGURED-DEFAULT rung into the shared placement resolver
	 * (`src/placement.ts`); the resolver overlays an EXPLICIT operator flag
	 * (top) and the UNTRUSTED-ORIGIN force (staging) on top, in that order. The
	 * slicer NEVER sets placement itself. PRD US #6 / the governing ADR: the
	 * runner OWNS placement from unforgeable inputs; the agent cannot
	 * influence it.
	 */
	slicesLandIn: SlicesLandIn;
	/**
	 * **Per-repo DEFAULT landing for `intake`-authored PRD files** (PRD
	 * `staging-pool-position-gate-and-trust-model` US #2/#5/#6/#12, slice
	 * `pre-prd-staging-pool-split-and-untrusted-prd-placement`). The PRD twin of
	 * {@link slicesLandIn}: resolved per-repo EXACTLY like it (flag
	 * `--prds-land-in` > env `AGENT_RUNNER_PRDS_LAND_IN` > per-repo > global >
	 * built-in `'pre-prd'`). `intake`'s `prd` dispatch reads it and passes it as
	 * the CONFIGURED-DEFAULT rung into the shared placement resolver
	 * (`src/placement.ts`); the resolver overlays an EXPLICIT operator flag
	 * (top) and the UNTRUSTED-ORIGIN force (staging) on top, in that order.
	 * `intake` NEVER sets placement itself. PRD US #6 / the governing ADR: the
	 * runner OWNS placement from unforgeable inputs; the agent cannot
	 * influence it. KEY-LEVEL SYMMETRY with `slicesLandIn` — one resolver, two
	 * lifecycles, one precedence change touches ONE place.
	 */
	prdsLandIn: PrdsLandIn;
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
	 * The command the runner shells out to for one slice. The runner appends the
	 * built prompt on stdin; the command does NO git ops on the repo (the runner
	 * owns those). Empty string ⇒ no agent configured (run will refuse). Consumed
	 * by the **null** harness adapter (it shells out to this verbatim); the **pi**
	 * adapter ignores it (it invokes the pi CLI directly — see `harness`).
	 */
	agentCmd: string;
	/**
	 * The model a job's agent runs on (harness-agnostic ROUTING intent, ADR §13).
	 * agent-runner decides WHICH model; it never touches auth/keys (those stay the
	 * harness's job). Optional with NO default so "unset" is meaningful: unset ⇒
	 * agent-runner forces no model (the harness's own default / a model baked into
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
	 * dir`) > env (`AGENT_RUNNER_SESSIONS_DIR`) > global > default — there is NO
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
	 * The per-repo acceptance gate run by `agent-runner verify` (a deterministic
	 * shell command, or an ordered list of commands). NOT per-slice and NOT model-
	 * interpreted — it is declared, auditable config (ADR §8). Unset (omitted) ⇒
	 * a sensible `pnpm -r build && test && format:check` default; the field is
	 * intentionally optional so "unset" is distinguishable from "empty". Install
	 * must NOT be baked into `verify` — env-prep belongs in the sibling `prepare`
	 * field, which the runner runs ONCE before the first `verify` on a fresh
	 * worktree (the prepare=env-ready / verify=tree-green split).
	 */
	verify?: VerifyConfig;
	/**
	 * **Gate 2 — the PR/code review gate** (GATES PRD `work/prd/review.md`): run the
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
	 * Bound the revise↔review loop (Gate 2). On exhaustion the gate ERRORS OUT and
	 * forces `needs-attention/` (never silently merges or loops), per the maintainer
	 * decision. Default a small N (2). Resolved like `integration`: flag
	 * (`--review-max-rounds`) > env > per-repo > global > default.
	 */
	reviewMaxRounds: number;
	/**
	 * **The slicer IMPROVER loop on/off toggle** (`--slicer-loop` /
	 * `--no-slicer-loop`). On the `do prd:<slug>` slicing path the improver loop is
	 * the slice path's quality engine (auto-slicing has no `verify` floor), so it is
	 * ON by default; setting this false gates wiring the loop seam (the candidate
	 * slices land as-is). Resolved per-repo like `integration`: flag
	 * (`--slicer-loop`/`--no-slicer-loop`) > env > per-repo > global > default (on).
	 * DISTINCT from the acceptance gate's `review` toggle.
	 */
	slicerLoop: boolean;
	/**
	 * **The slicer IMPROVER loop's convergence cap** (`slicer-review-edit-loop`,
	 * GATES PRD `work/prd/review.md` RESOLVED DESIGN — Shape 2 / insertion point
	 * A). On the `do prd:<slug>` slicing path, AFTER the agent produces candidate
	 * slices the loop runs the `review` SKILL, APPLIES its edits, and re-reviews
	 * until a pass finds no NEW blocking issue (the natural terminator).
	 * `slicerLoopMax` is the HARD CAP on the in-context review passes (N) so the
	 * loop can never run forever; on hitting it WITH unresolved blockers the loop
	 * REJECTS via the needsAnswers / needs-attention sink. It lives on the LOOP,
	 * never on a gate (the orphaned `reviewMaxRounds` belongs to the Gate-2 path —
	 * separate cleanup). A cheap default (3). Resolved per-repo like `integration`:
	 * flag (`--slicer-loop-max`) > env > per-repo > global > default. Distinct from
	 * Gate-2's `reviewMaxRounds`.
	 */
	slicerLoopMax: number;
	/**
	 * The model the slicer IMPROVER loop's review agent runs on (de-correlation
	 * from the slicer). Optional with NO default so "unset" means "no forced model"
	 * (the harness's own default). Carried to the review-agent launch through the
	 * EXISTING harness seam (`LaunchInput.model` / `substituteModel`). Resolved like
	 * `model`: flag (`--slicer-loop-model`) > env > per-repo > global > default
	 * (unset). DISTINCT from the acceptance gate's `reviewModel` (build
	 * `--review-model`).
	 */
	slicerLoopModel?: string;
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
	 * exists for). Modelled EXACTLY on `slicerLoop`: a POSITIVE boolean, default
	 * ON, `--no-` negation. Resolved per-repo like `integration`: flag
	 * (`--fresh-worktree-gate`/`--no-fresh-worktree-gate`) > env > per-repo >
	 * global > default (on). DISTINCT from `review`/`slicerLoop` (a separate
	 * concern: WHICH tree the gate runs against, not whether a review runs).
	 *
	 * The shared gate→integrate band (`performIntegration`) simply HONOURS the
	 * boolean it is handed (caller-agnostic). The `run` FLEET caller passes
	 * `(resolvedFlag && perRepoMax === 1)` so the fresh gate is used only when
	 * same-repo concurrency is OFF (two pre-existing run-fleet races would
	 * otherwise fire at `perRepoMax > 1`; they are their own slice). Single-job
	 * callers (`do` in-place / `--isolated` / `--remote` / `complete`) pass the
	 * resolved flag UNCONDITIONALLY.
	 */
	freshWorktreeGate: boolean;
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
	// Auto-slicing is human-first by default: an agent slices nothing unless a
	// repo opts in via `autoSlice` (mirrors `autoBuild`, one level up).
	autoSlice: false,
	// The observation INBOX is calm by default (`off`): the triage pool is dropped
	// from the auto-pick selection, so observations are left untouched unless a repo
	// opts in via `observationTriage` (`ask` ⇒ surface a question for each; `auto` ⇒
	// auto-dispose the no-question cases). ADR `ci-config-policy-and-gate-family` §3.
	observationTriage: 'off',
	// DECLARED blocked work is calm by default (`false`): the `needsAnswers`-blocked
	// pool is dropped from the auto-pick selection, so `advance` does NOT proactively
	// render a declared blocker into a question sidecar unless a repo opts in via
	// `surfaceBlockers`. Orthogonal PEER to `observationTriage`; `needs-attention`
	// (a stuck build) is separate + always-on. ADR `ci-config-policy-and-gate-family` §3.
	surfaceBlockers: false,
	// The `drain` selection-order preset by default (ADR `ci-config-policy-and-gate-
	// family`, selection-order section): drain ready work (build eligible slices →
	// slice sliceable PRDs) before creating/asking (surface → triage); `apply` is
	// always first. Reproduces today's slices-first two-pool default. Subsumes the
	// removed `prdsFirst` boolean (`[slice, build, ...]` reproduces `prdsFirst: true`).
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
	// The slicer's emitted slices land STAGED (`pre-backlog/`) by default — the
	// conservative landing that preserves the tracer slice's behaviour: an item is
	// durable + readable but NOT in the agent-eligible pool until a human/runner
	// promotes it. A repo opts into the trusted fast-path with `slicesLandIn:
	// 'backlog'` (or `--slices-land-in backlog` / `AGENT_RUNNER_SLICES_LAND_IN=backlog`).
	// The runner-deterministic resolver overlays explicit-flag + untrusted-origin
	// force on top of this default (`src/placement.ts`).
	slicesLandIn: 'pre-backlog',
	// `intake`-authored PRDs land STAGED (`pre-prd/`) by default — the
	// conservative landing that mirrors `slicesLandIn`'s built-in floor: a PRD is
	// durable + readable but NOT in the auto-slice POOL until a human/runner
	// promotes it. A repo opts into the trusted fast-path with `prdsLandIn: 'prd'`
	// (or `--prds-land-in prd` / `AGENT_RUNNER_PRDS_LAND_IN=prd`). The same
	// runner-deterministic resolver overlays explicit-flag + untrusted-origin
	// force on top of this default (`src/placement.ts`).
	prdsLandIn: 'pre-prd',
	agentCmd: '',
	// Gate 2 (PR/code review) defaults OFF — it puts a model on the merge path, so
	// it is opt-in (ADR §8). On an `approve` a resolved `merge` lands automatically
	// (`merge` IS the auto-land mode); `propose` always leaves the merge to a human.
	// The loop bound is a small N so an unattended revise↔review can never run forever.
	review: false,
	reviewMaxRounds: 2,
	// The slicer improver loop is ON by default — auto-slicing has no `verify`
	// floor, so the loop is the slice path's quality engine (distinct from the
	// acceptance gate's `review`, which defaults OFF).
	slicerLoop: true,
	// The slicer improver loop's hard cap on in-context review passes — a cheap
	// default so an unattended review→edit→re-review can never run forever (the
	// natural terminator is "no new blocking issue"; this is the ceiling on top).
	slicerLoopMax: 3,
	// The fresh-worktree acceptance gate is ON by default: most CI/tooling caches
	// deps so `pnpm install` is fast, so correctness-first (the gate tests what
	// MERGES, not the agent's pre-rebase checkout) is the right default. The
	// opt-out (`--no-fresh-worktree-gate`) runs `verify` in the build worktree as
	// before, for when the per-gate install cost is too high. Mirrors `slicerLoop`
	// (positive name, default-on).
	freshWorktreeGate: true,
};

/** The conventional config location (`~/.config/agent-runner/config.json`). */
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
