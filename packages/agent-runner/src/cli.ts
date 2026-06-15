#!/usr/bin/env node
import {Command, Option} from 'commander';
import type {Command as Commander} from 'commander';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {realpathSync, mkdirSync, rmSync} from 'node:fs';
import {join as joinPath} from 'node:path';
import {git} from './git.js';
import {
	loadConfig,
	mergeConfig,
	defaultConfigPath,
	type Config,
	type PartialConfig,
} from './config.js';
import {envOverrides} from './env-config.js';
import {scan} from './scan.js';
import {remoteAdd, remoteRm, listMirrors, RegistryError} from './registry.js';
import {findParticipatingRepos} from './detect.js';
import {formatReport} from './format.js';
import {resolveCwdSection} from './cwd-section.js';
import {
	runOnce,
	runLoop,
	type ItemResult,
	type RunOnceResult,
	type RunTick,
} from './run.js';
import {performClaim} from './claim-cas.js';
import {createClaimSpinner} from './cli-spinner.js';
import {performStart} from './start.js';
import {
	performWorkOn,
	loadHumanWorktreesDir,
	persistHumanWorktreesDir,
} from './work-on.js';
import {performComplete, integrationFromFlags} from './complete.js';
import {
	performRecoverIsolated,
	locateIsolatedRecovery,
} from './recover-isolated.js';
import {
	performDo,
	performDoRemote,
	resolveArbiterUrlFromCheckout,
	type DoOptions,
	type DoRemoteOptions,
} from './do.js';
import {performDoRemoteAuto, performDoRemoteArgs} from './do-remote-auto.js';
import {performAdvance, type AdvanceContext} from './advance.js';
import {
	performAdvanceAuto,
	performAdvanceArgs,
	runAdvanceTickWithTreelessPublish,
	type AdvanceMultiResult,
} from './advance-drivers.js';
import {
	performAdvanceIsolated,
	performAdvanceIsolatedAuto,
	performAdvanceIsolatedArgs,
	type IsolatedAdvanceContext,
} from './advance-isolated.js';
import {advanceRegistrySetRunTick} from './advance-loop-driver.js';
import {performIntake, resolveIntakeIntegrationModes} from './intake.js';
import {workFolderPrefix} from './work-layout.js';
import {
	performDoAuto,
	performDoArgs,
	type DoMultiResult,
} from './do-autopick.js';
import {createHarness} from './pi-harness.js';
import {generateSessionPath} from './session-path.js';
import type {InteractiveLauncher} from './harness.js';
import {shouldUseColor} from './output.js';
import {
	resolveRepoConfig,
	resolveRepoConfigFromLoaded,
	loadRepoConfigFromContent,
	REPO_CONFIG_FILENAME,
	type LoadedRepoConfig,
} from './repo-config.js';
import {
	ensureMirrorMain,
	readRepoConfigFromMirrorMain,
	encodeRepoKey,
} from './repo-mirror.js';
import {identityEnv, type Identity} from './identity.js';
import {
	harnessFlagOverrides,
	doFlagOverrides,
	doNeedsAgentCmd,
	NO_AGENT_CMD_MESSAGE,
	reviewFlagOverrides,
	freshWorktreeGateFlagOverrides,
	noPRFlagOverrides,
} from './do-config.js';
import {harnessReviewGate, harnessSliceAcceptanceGate} from './review-gate.js';
import {harnessSurfaceGate} from './surface-gate.js';
import {harnessTriageGate} from './triage-gate.js';
import {harnessSliceReviewGate} from './slicer-review-loop.js';
import {runVerify} from './verify.js';
import {renderPrompt} from './prompt.js';
import {gc, RETAIN_REASON_TEXT} from './gc.js';
import {sweepRemoteMergedBranches} from './reap-branches.js';
import {sweepLedgerDuplicates, formatLedgerSweep} from './ledger-lint.js';
import {status, formatStatus} from './status.js';
import {ledgerWrite} from './ledger-write.js';
import {
	releaseItemLock,
	reportItemLocks,
	formatItemLockReport,
	itemLockReportNeedsAttention,
	reapStaleItemLocks,
	formatReapReport,
	reapReportNeedsAttention,
} from './item-lock.js';
import {
	promoteFromPreBacklog,
	promoteFromPrePrd,
	listPromotable,
} from './needs-attention.js';
import {parseSlugArg} from './slug-namespace.js';
import {arbiterStatus, DEFAULT_ARBITER_REMOTE} from './arbiter.js';
import {
	resolveSliceOnlyArg,
	workBranchRef,
	SlugResolutionError,
} from './slug-namespace.js';
import {brand} from './brand.js';
import {installCI, type WizardPrompts} from './install-ci.js';
import {GitHubCIContext} from './install-ci-github.js';
import {loadCapabilityRegistry} from './install-ci-core.js';
import {performCloseMergedIssues} from './close-job.js';

interface ScanFlags {
	config?: string;
	autoBuild?: boolean;
	json?: boolean;
	cwd?: boolean;
	arbiterRemote?: string;
}

/**
 * Whether `--auto-build` / `--no-auto-build` was explicitly passed on the command
 * line. Commander gives a negatable boolean option a default of `true`, so we
 * must check the value SOURCE to distinguish "user set it" from "default"; only an
 * explicit flag becomes a config override (so config/defaults still win
 * otherwise).
 */
function autoBuildFromCli(command: Commander | undefined): boolean | undefined {
	if (!command) {
		return undefined;
	}
	if (command.getOptionValueSource('autoBuild') === 'cli') {
		return command.getOptionValue('autoBuild') as boolean;
	}
	return undefined;
}

/**
 * Build the overrides a user supplied via CLI flags. Discovery is the registry
 * (the hub-mirror set, ADR §1), so there are no `--root`/`--include`/`--exclude`
 * flags any more — only the autonomy-gate `--auto-build` toggle.
 */
function flagOverrides(flags: ScanFlags, command?: Commander): PartialConfig {
	const overrides: PartialConfig = {};
	const autoBuild = autoBuildFromCli(command);
	if (autoBuild !== undefined) {
		overrides.autoBuild = autoBuild;
	}
	return overrides;
}

/**
 * Resolve the global (non-per-repo) config along the chain
 *
 *   flag > ENV (AGENT_RUNNER_*) > global file > built-in default
 *
 * by layering the file config, then the `AGENT_RUNNER_*` env layer, then the
 * flag overrides on top. Env is a per-machine source (like a flag or the global
 * file) and may set ANY key, host-only included. Used by the commands that build
 * a single global config (`scan`, `run`); per-repo commands fold env in via
 * `resolveRepoConfig` instead.
 */
function resolveGlobalConfig(
	fileConfig: PartialConfig,
	flags: PartialConfig,
): Config {
	return mergeConfig({...fileConfig, ...envOverrides(), ...flags});
}

/**
 * Resolve the effective config for a `do --remote <r>` run, layering the target
 * repo's COMMITTED `.agent-runner.json` (read from `<arbiter>/main` via the hub
 * mirror) into the SAME `flag > env > per-repo > global > default` chain in-place
 * `do` uses. This is the no-checkout analogue of {@link resolveRepoConfig}: there
 * is no working tree, so the bytes come from the arbiter's `main` instead of the
 * cwd — but the parse + allow/reject FILTER (`loadRepoConfigFromContent`) and the
 * layering (`resolveRepoConfigFromLoaded`) are the EXISTING per-repo machinery,
 * reused verbatim. Host-only keys in the committed file are rejected + reported
 * exactly as the in-place read rejects them.
 *
 * Resilient by design: a config-less repo (no file on main) OR an unreachable
 * mirror falls back to global+default (the pre-slice behaviour), with a warning
 * on a genuine fetch/read fault — a `--remote` build must not be blocked because
 * the arbiter was momentarily offline.
 *
 * The config read uses {@link ensureMirrorMain} (main-only, NO-prune), NOT the
 * all-heads pruning {@link ensureMirror}: `git show main:.agent-runner.json` only
 * needs `main`, and the all-heads `+refs/heads/*:refs/heads/*` fetch would let a
 * `work/<slug>` branch CHECKED OUT in some stale job worktree block it (git
 * refuses to fetch into a checked-out branch), throwing the read into its
 * fallback and silently dropping the per-repo `harness`/`verify`/etc. The build's
 * own worktree MATERIALISATION still calls the all-heads `ensureMirror` later
 * (continue-detection needs the kept `work/<slug>` head) — that is a separate,
 * untouched concern; only the CONFIG-READ fetch is narrowed here.
 */
function resolveRemoteRepoConfig(options: {
	remote: string;
	workspacesDir: string;
	global: Config;
	flags: PartialConfig;
	identity: Identity | undefined;
	note: (message: string) => void;
}): Config {
	const {remote, workspacesDir, global, flags, identity, note} = options;
	let loaded: LoadedRepoConfig;
	try {
		const env = identityEnv(identity, process.env);
		const mirror = ensureMirrorMain({url: remote, workspacesDir, env});
		const content = readRepoConfigFromMirrorMain(mirror.path, env);
		loaded =
			content === undefined
				? {
						path: `${remote}#main:${REPO_CONFIG_FILENAME}`,
						config: {},
						rejected: [],
					}
				: loadRepoConfigFromContent(
						content,
						`${remote}#main:${REPO_CONFIG_FILENAME}`,
					);
	} catch (err) {
		// A fetch/read fault (offline arbiter, corrupt mirror) must NOT block the
		// build: warn + fall back to global+default (today's no-per-repo behaviour).
		note(
			`could not read the target repo's ${REPO_CONFIG_FILENAME} from ` +
				`${remote}/main; resolving config from global + flags only. ` +
				`${err instanceof Error ? err.message : String(err)}`,
		);
		loaded = {path: `${remote}#main`, config: {}, rejected: []};
	}
	if (loaded.message) {
		note(loaded.message);
	}
	return resolveRepoConfigFromLoaded(loaded, {global, flags}).config;
}

/**
 * Build the {@link RunTick} that **plain `run`** (no flag) loops: the REGISTRY-SET
 * ADVANCE tick (slice `run-uses-advance-tick`). This points the deliberate
 * {@link RunTick} swap seam at the precursor's registry-set advance driver
 * ({@link advanceRegistrySetRunTick}) instead of the build-only `runOnce` tick, so
 * plain `run` ≡ advance with calm-default gates: behaviour-preserving today
 * (both lifecycle gates default off ⇒ build ready slices / slice ready PRDs /
 * route failures to needs-attention, over the SAME registry-set discovery +
 * per-mirror job-worktree isolation the build tick used), lifecycle-capable the
 * moment a gate is flipped (triage / surface / apply).
 *
 * Where the deprecated single-mirror advance wiring drained ONE named mirror
 * IN-PLACE in the cwd checkout (the library {@link advanceRunTick}, now reached
 * only by the precursor's single-mirror tests, no longer the CLI), this discovers
 * the WHOLE registry via
 * `scan(config)` (the SAME discovery the build tick uses) and the registry-set
 * driver threads a PER-MIRROR job-worktree `doDriver` so each mirror's build/slice
 * rungs run isolated off THAT mirror's arbiter (NOT `process.cwd()`). The
 * tree-less surface/triage/apply rungs commit in a per-mirror working CLONE of the
 * mirror's arbiter (materialised lazily under the agents' workspace), since a bare
 * hub mirror has no work tree to `git mv`/`git commit` in.
 */
function buildRegistrySetAdvanceTick(options: {
	config: Config;
	workspace: string;
	arbiter?: string;
	env?: NodeJS.ProcessEnv;
}): RunTick {
	const {config, workspace, arbiter, env} = options;
	const gitEnv = identityEnv(config.identity, env);
	const harness = createHarness({harness: config.harness, piBin: config.piBin});
	return advanceRegistrySetRunTick({
		config,
		workspace,
		// The SELECTION-layer gates for the loop/CI path, IDENTICAL to the
		// single-mirror wiring above: `observationTriage != off` enumerates the
		// observation (triage) pool; `surfaceBlockers` enumerates the `needsAnswers`-
		// blocked (surface) pool. `off`/`false` drops the respective pool. Apply
		// (consume) is always-on (never gated here). Both default to their calm state,
		// so plain `run` out of the box is behaviour-identical to the old build tick.
		lifecycleGates: {
			triage: config.observationTriage !== 'off',
			surface: config.surfaceBlockers,
		},
		// Build the per-mirror advance CONTEXT the registry-set driver injects its
		// per-mirror job-worktree `doDriver` on top of: the build/slice `doOptions`
		// base + the surface/triage gate seams + a tree-less working clone of THIS
		// mirror's arbiter (the ledger-write cwd the surface/triage/apply rungs commit
		// in — a bare mirror cannot `git mv`/`git commit`).
		contextFor: ({mirrorPath, originUrl}) => {
			// A per-mirror working clone of the mirror's arbiter for the tree-less
			// lifecycle rungs (surface/triage/apply). Keyed by the mirror's repo key so
			// distinct mirrors get distinct clones; re-created fresh each tick so the
			// rungs always commit onto the latest mirror `main` (idempotent, cheap
			// local clone). The build/slice rungs DO NOT use this cwd (the worktree
			// `doDriver` replaces it); it serves ONLY the tree-less moves.
			const treelessCwd = joinPath(
				workspace,
				'advance-cwd',
				encodeRepoKey(originUrl).split('/').join('__'),
			);
			rmSync(treelessCwd, {recursive: true, force: true});
			mkdirSync(joinPath(treelessCwd, '..'), {recursive: true});
			git(['clone', '--quiet', mirrorPath, treelessCwd], workspace, {
				env: gitEnv,
			});
			const doOptions: Omit<DoOptions, 'arg'> = {
				cwd: treelessCwd,
				arbiter: arbiter ?? config.defaultArbiter,
				identity: config.identity,
				autoSlice: config.autoSlice,
				integration: config.integration,
				// The per-TRANSITION SLICING override: the `do prd:` slicing path threads
				// `slicingIntegration ?? integration`; the build path stays on `integration`.
				slicingIntegration: config.slicingIntegration,
				// The SLICE-PLACEMENT configured default (`do prd:` slicing output:
				// `pre-backlog` staged vs `backlog` pool). No operator flag on this
				// registry-driven advance context, so only the configured default rung is
				// threaded (the resolver still layers untrusted-origin force + built-in floor).
				slicesLandIn: config.slicesLandIn,
				prepare: config.prepare,
				verify: config.verify,
				// Single-job build path: gate the REBASED tip (the default) unconditionally.
				freshWorktreeGate: config.freshWorktreeGate,
				noPR: config.noPR,
				harness,
				agentCmd: config.agentCmd,
				model: config.model,
				sessionsDir: config.sessionsDir,
				review: config.review,
				reviewModel: config.reviewModel,
				reviewMaxRounds: config.reviewMaxRounds,
				reviewGate: config.review
					? harnessReviewGate({harness, agentCmd: config.agentCmd})
					: undefined,
				reviewLoop: config.slicerLoop
					? harnessSliceReviewGate({harness, agentCmd: config.agentCmd})
					: undefined,
				slicerLoopMax: config.slicerLoopMax,
				slicerLoopModel: config.slicerLoopModel,
				sliceReviewGate: config.review
					? harnessSliceAcceptanceGate({harness, agentCmd: config.agentCmd})
					: undefined,
				color: shouldUseColor(process.stdout),
				note: (message) => console.error(`>> ${message}`),
				noteBlock: (message) => console.error(message),
			};
			const context: AdvanceContext = {
				cwd: treelessCwd,
				arbiter: arbiter ?? config.defaultArbiter,
				doOptions,
				surfaceGate: harnessSurfaceGate({harness, agentCmd: config.agentCmd}),
				surfaceModel: config.model,
				observationTriage: config.observationTriage,
				triageGate: harnessTriageGate({harness, agentCmd: config.agentCmd}),
				triageModel: config.model,
				note: (message) => console.error(`>> ${message}`),
			};
			return context;
		},
	});
}

/**
 * Resolve the arbiter URL for `do --isolated <slug>` from the CURRENT repo (cwd).
 *
 * `--isolated` builds in a job worktree off MY OWN arbiter (the same isolation +
 * integrate pipeline `do --remote <url>` uses), so it needs the URL of the cwd's
 * arbiter remote. It uses the SAME arbiter-remote resolution in-place `do` does:
 * `--arbiter` > the resolved cwd `defaultArbiter` (the per-repo/global config), as
 * the remote NAME, then `git remote get-url <name>` in the checkout to get its URL.
 * That URL is then fed into the EXISTING `performDoRemote` pipeline as `remote`.
 *
 * Returns the URL, or `undefined` when there is no resolvable arbiter (cwd is not
 * a git repo, or the named arbiter remote does not exist) — the "isolated against
 * what?" case the caller turns into a clear error naming `--remote <url>`.
 */
function resolveDefaultArbiterForCwd(
	cwd: string,
	global: Config,
	flags: PartialConfig,
): string {
	// The SAME per-repo config read in-place `do` uses (`resolveRepoConfig` on the
	// cwd), so `--isolated` resolves the arbiter remote NAME (`defaultArbiter`)
	// through the identical `flag > env > per-repo > global > default` chain. An
	// absent `.agent-runner.json` falls back to the global/default (`origin`).
	return resolveRepoConfig({repoPath: cwd, global, flags}).config
		.defaultArbiter;
}

/**
 * First-use prompt for the human worktree root (`work-on`). Offers `suggestion`
 * as the default (Enter accepts it); a blank non-interactive answer aborts. The
 * prompt goes to stderr so `--print-dir`'s stdout stays clean.
 */
function promptForWorktreesRoot(suggestion: string): Promise<string> {
	return new Promise((resolvePrompt) => {
		const rl = createInterface({input: process.stdin, output: process.stderr});
		rl.question(
			'work-on needs a human worktree root (NOT under ~/.agent-runner). ' +
				`Where should parallel worktrees live? [${suggestion}] `,
			(answer) => {
				rl.close();
				const trimmed = answer.trim();
				resolvePrompt(trimmed === '' ? suggestion : trimmed);
			},
		);
	});
}

interface RunFlags extends ScanFlags {
	once?: boolean;
	/**
	 * `run --advance` is a DEPRECATED NO-OP ALIAS (slice `run-uses-advance-tick`).
	 * Plain `run` (no flag) now ALREADY drives the registry-set ADVANCE tick with
	 * calm-default gates, so there is no longer a separate advance MODE to opt into:
	 * passing `--advance` warns + is otherwise ignored (it does NOT change the tick,
	 * which is already advance). Kept so an existing `run --advance` invocation does
	 * not break; it carries NO value (the old `--advance <mirror>` single-mirror
	 * form is gone — the daemon discovers the WHOLE registry via `scan(config)`, the
	 * SAME discovery the build tick used).
	 */
	advance?: boolean;
	maxIterations?: string;
	maxDuration?: string;
	interval?: string;
	maxParallel?: string;
	perRepoMax?: string;
	arbiter?: string;
	integration?: string;
	/** `--no-pr` ⇒ commander stores `pr === false` (the suppress-PR intent). */
	pr?: boolean;
	agentCmd?: string;
	model?: string;
	harness?: string;
	piBin?: string;
	sessionsDir?: string;
	workspace?: string;
	review?: boolean;
	reviewModel?: string;
	reviewMaxRounds?: string;
	/** `--fresh-worktree-gate` / `--no-fresh-worktree-gate` — gate the REBASED tip in a clean throwaway worktree (ON by default). */
	freshWorktreeGate?: boolean;
}

function runFlagOverrides(flags: RunFlags, command?: Commander): PartialConfig {
	const overrides = flagOverrides(flags, command);
	if (flags.maxParallel !== undefined) {
		overrides.maxParallel = Number(flags.maxParallel);
	}
	if (flags.perRepoMax !== undefined) {
		overrides.perRepoMax = Number(flags.perRepoMax);
	}
	if (flags.arbiter !== undefined) {
		overrides.defaultArbiter = flags.arbiter;
	}
	if (flags.integration === 'propose' || flags.integration === 'merge') {
		overrides.integration = flags.integration;
	}
	// `--no-pr` (the PR-INTENT axis): suppress the PR even on an authed GitHub
	// arbiter. Commander stores the negatable flag as `pr` (false when `--no-pr` is
	// passed). Rides the SAME flag-override chain as `integration`.
	if (flags.pr === false) {
		overrides.noPR = true;
	}
	// The harness/adapter flags (--agent-cmd/--model/--harness/--pi-bin) map via
	// the SHARED per-key mapping `do` also reuses (do-config.harnessFlagOverrides),
	// so there is exactly ONE override path for them.
	Object.assign(overrides, harnessFlagOverrides(flags));
	// Gate 2 (PR/code review) flags ride the SAME flag-override path so
	// `--review`/`--review-model`/`--review-max-rounds` resolve
	// flag > env > per-repo > global > default — mirroring the `do` command (the
	// fleet inherits the review gate via the converged `performIntegration` core).
	Object.assign(overrides, reviewFlagOverrides(flags));
	// `--fresh-worktree-gate`/`--no-fresh-worktree-gate` rides the SAME chain: gate
	// the REBASED tip in a clean throwaway worktree (ON by default). The `run` fleet
	// caller additionally downgrades it to today's gate at `perRepoMax > 1` (the
	// fleet conditional lives in `runOnce`, not in this flag mapping).
	Object.assign(overrides, freshWorktreeGateFlagOverrides(flags));
	return overrides;
}

function formatItemLine(item: ItemResult): string {
	const extra = item.detail ? ` — ${item.detail}` : '';
	return `  [${item.status}] ${item.repoPath} :: ${item.slug}${extra}`;
}

interface ClaimFlags {
	arbiter?: string;
	retries?: string;
	dryRun?: boolean;
	ignoreNotReady?: boolean;
}

interface VerifyFlags {
	config?: string;
}

/**
 * The flags that drive an INTERACTIVE `--agent` launch (slice
 * `agent-interactive-launch`), shared by `start` and `work-on`. `--agent` opts
 * into launching the configured harness interactively after onboarding; the
 * harness/model/pi-bin/sessions-dir flags resolve the SAME way the autonomous
 * `do`/`run` path resolves them (flag > env > per-repo > global > default), so
 * the human starts pinned to the intended model (decision #4).
 */
interface AgentLaunchFlags {
	agent?: boolean;
	harness?: string;
	model?: string;
	piBin?: string;
	sessionsDir?: string;
}

interface StartFlags extends AgentLaunchFlags {
	config?: string;
	arbiter?: string;
	resume?: boolean;
	ignoreNotReady?: boolean;
	/** `--isolated` (resume only): re-engage the slug's retained job worktree. */
	isolated?: boolean;
	workspace?: string;
}

interface WorkOnFlags extends AgentLaunchFlags {
	config?: string;
	arbiter?: string;
	remote?: string;
	copy?: string;
	copyFrom?: string;
	ignoreNotReady?: boolean;
	printDir?: boolean;
	workspace?: string;
}

interface CompleteFlags {
	config?: string;
	arbiter?: string;
	merge?: boolean;
	propose?: boolean;
	/** `--no-pr` ⇒ commander stores `pr === false` (the suppress-PR intent). */
	pr?: boolean;
	switch?: boolean;
	ignoreDivergedMain?: boolean;
	skipVerify?: boolean;
	type?: string;
	message?: string;
	review?: boolean;
	reviewModel?: string;
	reviewMaxRounds?: string;
	/** `--fresh-worktree-gate` / `--no-fresh-worktree-gate` — gate the REBASED tip in a clean throwaway worktree (ON by default). */
	freshWorktreeGate?: boolean;
	/** `--isolated`: finish the slug's retained job worktree (the stranded-branch recover). */
	isolated?: boolean;
	workspace?: string;
}

/**
 * Resolve the EXPLICIT operator placement override from `--slices-land-in <where>`
 * (the top of the `do prd:` slicing-placement precedence — slice
 * `runner-deterministic-slice-placement-policy-and-precedence`). Mirrors the
 * `flagMode === 'merge'` ⇒ `explicitMerge: true` shape: it contributes
 * `explicitSlicesLandIn` ONLY when the operator actually typed the flag, so an
 * untrusted-origin's staging force still wins when the value came from config, not
 * the flag. An invalid value FAILS LOUDLY (a usage error, never silently dropped
 * — the SAME discipline the `--observation-triage` enum + the
 * `AGENT_RUNNER_SLICES_LAND_IN` env coercion use).
 */
function explicitSlicesLandInFromFlag(
	raw: string | undefined,
): 'pre-backlog' | 'backlog' | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (raw !== 'pre-backlog' && raw !== 'backlog') {
		throw new Error(
			`--slices-land-in must be 'pre-backlog' or 'backlog' (got '${raw}').`,
		);
	}
	return raw;
}

/**
 * The PRD twin of {@link explicitSlicesLandInFromFlag} (slice
 * `pre-prd-staging-pool-split-and-untrusted-prd-placement`). Resolve the
 * EXPLICIT operator PRD-placement override from `--prds-land-in <where>` for
 * `intake`'s `prd` dispatch — the TOP of the same precedence chain that the
 * slicer placement uses. Contributes `explicitPrdsLandIn` ONLY when the
 * operator actually typed the flag, so an untrusted-origin's staging force
 * still wins when the value came from config. An invalid value FAILS LOUDLY
 * (a usage error, never silently dropped), mirroring the slice helper above
 * and the `AGENT_RUNNER_PRDS_LAND_IN` env coercion.
 */
function explicitPrdsLandInFromFlag(
	raw: string | undefined,
): 'pre-prd' | 'prd' | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (raw !== 'pre-prd' && raw !== 'prd') {
		throw new Error(
			`--prds-land-in must be 'pre-prd' or 'prd' (got '${raw}').`,
		);
	}
	return raw;
}

interface DoFlags {
	config?: string;
	arbiter?: string;
	remote?: string;
	/** `--isolated`: build in a job worktree off THIS repo's arbiter (no checkout takeover). */
	isolated?: boolean;
	/** `-n <x>`: do x eligible items in sequence (auto-pick form). */
	number?: string;
	/** `--selection-order <order>`: a preset keyword (drain/groom) or comma-separated pool order. */
	selectionOrder?: string;
	/** `--observation-triage <off|ask|auto>`: the observation-inbox gate (`advance`). */
	observationTriage?: string;
	/** `--surface-blockers` / `--no-surface-blockers`: the declared-blocked-work gate (`advance`). */
	surfaceBlockers?: boolean;
	merge?: boolean;
	propose?: boolean;
	/** `--slices-land-in <pre-backlog|backlog>`: the explicit operator placement override for `do prd:` slicing output (top of the placement precedence). */
	slicesLandIn?: string;
	/** `--no-pr` ⇒ commander stores `pr === false` (the suppress-PR intent). */
	pr?: boolean;
	ignoreDivergedMain?: boolean;
	agentCmd?: string;
	model?: string;
	harness?: string;
	piBin?: string;
	sessionsDir?: string;
	watch?: boolean;
	review?: boolean;
	reviewModel?: string;
	reviewMaxRounds?: string;
	/** `--slicer-loop` / `--no-slicer-loop` — the slicer improver loop on/off toggle (`do prd:` path). */
	slicerLoop?: boolean;
	/** `--slicer-loop-max <n>` — the slicer improver loop's in-context convergence cap (`do prd:` path). */
	slicerLoopMax?: string;
	/** `--slicer-loop-model <id>` — the slicer improver loop reviewer's de-correlated model (`do prd:` path). */
	slicerLoopModel?: string;
	/** `--fresh-worktree-gate` / `--no-fresh-worktree-gate` — gate the REBASED tip in a clean throwaway worktree (ON by default). */
	freshWorktreeGate?: boolean;
}

interface IntakeFlags {
	config?: string;
	arbiter?: string;
	merge?: boolean;
	propose?: boolean;
	/** `--no-pr` ⇒ commander stores `pr === false` (the suppress-PR intent). */
	pr?: boolean;
	mergePrd?: boolean;
	proposePrd?: boolean;
	mergeSlice?: boolean;
	proposeSlice?: boolean;
	/**
	 * `--origin-trust <trusted|untrusted>` — the author-trust verdict the CI shell
	 * passes IN so `intake` STAMPS the emitted PRD/slice (slice
	 * `untrusted-origin-forces-build-propose`). `intake` does NOT resolve trust; the
	 * shell derives it from the SAME `author_association` case as the integration
	 * flags. UNSET (a local intake) ⇒ emit unstamped ⇒ human/trusted.
	 */
	originTrust?: string;
	/** `--prds-land-in <pre-prd|prd>`: the explicit operator PRD-placement override (top of the precedence). */
	prdsLandIn?: string;
	agentCmd?: string;
	model?: string;
	harness?: string;
	piBin?: string;
	sessionsDir?: string;
}

interface GcFlags {
	config?: string;
	workspace?: string;
	force?: boolean;
	yes?: boolean;
	json?: boolean;
	ledger?: string;
	remoteBranches?: boolean;
	arbiter?: string;
	cwd?: string;
	dryRun?: boolean;
	reapStaleLocks?: boolean;
}

interface StatusFlags {
	config?: string;
	workspace?: string;
	arbiterRemote?: string;
	noArbiter?: boolean;
	cwd?: boolean;
	json?: boolean;
}

interface RequeueFlags {
	config?: string;
	cwd?: string;
	arbiter?: string;
	reset?: boolean;
	message?: string;
}

interface PromoteFlags {
	config?: string;
	cwd?: string;
	arbiter?: string;
}

interface ReleaseLockFlags {
	config?: string;
	cwd?: string;
	arbiter?: string;
}

interface RemoteAddFlags {
	config?: string;
	local?: boolean;
	arbiterRemote?: string;
	force?: boolean;
}

interface RemoteRmFlags {
	config?: string;
}

interface RemoteLsFlags {
	config?: string;
	json?: boolean;
}

interface RemoteFindFlags {
	config?: string;
	yes?: boolean;
}

interface InstallCiFlags {
	config?: string;
	fake?: boolean;
	exportConfig?: string;
	includeSecrets?: boolean;
	installSource?: string;
	cwd?: string;
	repo?: string;
	ghBin?: string;
}

interface CloseMergedIssuesFlags {
	cwd?: string;
	ghBin?: string;
	json?: boolean;
}

/**
 * Resolve a slice-only command's slug argument through the §3a namespace guard
 * (`resolveSliceOnlyArg`): accept bare (= slice) + `slice:` (explicit alias),
 * REJECT `prd:` with a clear "operates on slices, not PRDs" error. On rejection
 * it prints the error to stderr and exits 1 (the slice-only commands never act
 * on a PRD). An OMITTED slug (`start`/`complete`/`prompt` infer it from the
 * branch) passes through untouched.
 *
 * `do` is the ONE command that spans both namespaces; it consumes the full
 * `resolveSlug` (with the cross-namespace collision check) in the `do-in-place`
 * slice. This guard is the slice-only half of ADR §3a.
 */
function resolveSliceOnlySlug(slug: string | undefined): string | undefined {
	if (slug === undefined) {
		return undefined;
	}
	try {
		return resolveSliceOnlyArg(slug);
	} catch (err) {
		if (err instanceof SlugResolutionError) {
			console.error(`error: ${err.message}`);
			process.exit(1);
		}
		throw err;
	}
}

/**
 * Build the INTERACTIVE launcher closure for `--agent` (slice
 * `agent-interactive-launch`), or `undefined` when `--agent` was not passed.
 *
 * It resolves the harness + model the SAME way the autonomous `do`/`run` path
 * does — per-repo config layered flag > env > per-repo > global > default (ADR
 * §13) — so the human starts pinned to the intended model (decision #4). The
 * returned closure is what `start.ts`/`work-on.ts` call AFTER onboarding: it
 * generates the pi `--session` path for the onboarded working tree and calls
 * `harness.launchInteractive` (which inherits stdio, drops `--print`, feeds no
 * prompt, foreground). A NON-pi harness throws a clear pi-only error from the
 * adapter (decision #2). This keeps the git-logic modules decoupled from
 * `createHarness`/config (they only receive the thin {@link InteractiveLauncher}).
 *
 * `repoPath` is the per-repo config root (the current checkout for `start` /
 * in-repo `work-on`); `undefined` (remote `work-on`, no checkout) resolves from
 * the global config only — mirroring `do --remote`.
 */
function buildInteractiveLauncher(
	flags: AgentLaunchFlags,
	configPath: string | undefined,
	repoPath: string | undefined,
): InteractiveLauncher | undefined {
	if (flags.agent !== true) {
		return undefined;
	}
	const global = loadConfig(configPath);
	const overrides = harnessFlagOverrides(flags);
	const config =
		repoPath !== undefined
			? resolveRepoConfig({repoPath, global, flags: overrides}).config
			: resolveGlobalConfig(global, overrides);
	const harness = createHarness({
		harness: config.harness,
		piBin: config.piBin,
	});
	return (site) => {
		// Generate the pi `--session` path for the onboarded working tree so the
		// human session is recorded + dashboard-visible (decision #2); the resolved
		// model flows in (decision #4). The harness's `launchInteractive` runs pi
		// WITHOUT `--print`, inherited stdio, no piped prompt, in `site.dir`.
		const session = generateSessionPath({
			sessionsDir: config.sessionsDir,
			cwd: site.dir,
			id: site.slug,
		});
		harness.launchInteractive({
			slug: site.slug,
			dir: site.dir,
			model: config.model,
			session,
			env: site.env,
		});
	};
}

/**
 * The shared `start`/`resume` action body. `start` and `resume` are the two
 * human in-place verbs of ADR §4: `start` BEGINS work here (claim if needed +
 * switch); `resume` CONTINUES here (re-engage an already-in-progress item by
 * switching to its `work/<slug>` branch WITHOUT claiming). The runtime
 * difference is exactly the `resume` flag — `resume` forces it on (its only mode
 * is to re-engage), while `start` honours the (now hidden) `--resume` alias.
 * Both are slice-only (§3a: accept bare + `slice:`, reject `prd:`).
 */
async function runStartAction(
	rawSlug: string | undefined,
	flags: StartFlags,
	resume: boolean,
): Promise<void> {
	// Slice-only command (§3a): accept bare + `slice:`, reject `prd:`.
	const slug = resolveSliceOnlySlug(rawSlug);
	const cwd = process.cwd();

	// `resume --isolated <slug>`: re-engage the slug's RETAINED job worktree (the
	// inverse of `do --isolated`) WITHOUT claiming \u2014 locate it off THIS repo's
	// arbiter and report its path so the operator can cd in. The symmetric
	// companion of `complete --isolated` (finish the stranded worktree). `start`
	// (begin-here) has no isolated form \u2014 there is nothing retained to re-engage yet.
	if (resume && flags.isolated === true) {
		if (slug === undefined || slug === '') {
			console.error(
				'error: resume --isolated requires <slug> (the retained worktree to re-engage).',
			);
			process.exit(1);
		}
		const {config} = loadHumanWorktreesDir(flags.config ?? defaultConfigPath());
		const located = locateIsolatedRecovery({
			slug,
			cwd,
			arbiter: flags.arbiter ?? config.defaultArbiter,
			workspacesDir: flags.workspace ?? config.workspacesDir,
			env: process.env,
		});
		if ('error' in located) {
			console.error(`error: ${located.error}`);
			process.exit(1);
		}
		if (!located.present) {
			console.error(
				`>> No retained isolated worktree for '${slug}' (already integrated and ` +
					'reaped, or never stranded) \u2014 nothing to resume.',
			);
			process.exit(0);
		}
		console.error(
			`>> Re-engaging the retained worktree for '${slug}'. cd into it to ` +
				`continue, then 'agent-runner complete --isolated ${slug}' to finish:`,
		);
		process.stdout.write(`${located.dir}\n`);
		process.exit(0);
	}

	const result = await performStart({
		slug,
		cwd,
		arbiter: flags.arbiter ?? 'origin',
		// `resume` (the verb) always asserts ownership; `start` honours --resume.
		resume: resume || flags.resume === true,
		override: flags.ignoreNotReady === true,
		// `--agent`: launch the configured harness INTERACTIVELY in the checkout
		// after onboarding (slice `agent-interactive-launch`). The per-repo config
		// root is the current checkout.
		launchInteractive: buildInteractiveLauncher(flags, flags.config, cwd),
		// HUMAN commands (`start` = "begin here", `resume` = "continue here"): the
		// onboard/branch/switch is the human's, so it is NOT given the runner
		// `config.identity` (the autonomous onboard is `do`/`run`, identity-aware).
		// Ambient `process.env` threaded EXPLICITLY so the choice is declared here,
		// not left to the seam's silent `?? process.env` fallback.
		env: process.env,
		note: (message) => console.error(`>> ${message}`),
	});
	if (result.exitCode !== 0) {
		console.error(`error: ${result.message}`);
	}
	process.exit(result.exitCode);
}

/**
 * Help GROUP labels for the two-tier surface (ADR §7). commander v14's
 * `command.helpGroup(...)` renders each command under its label heading, so the
 * HEADLINE tier (the surface a user reaches for) lists first and the
 * ADVANCED/PLUMBING tier (kept, but de-emphasised) lists under its own heading
 * — without removing or hiding anything. Headline: run/do/work-on/start/resume/
 * complete/requeue/scan/status + remote add/ls/find. Advanced: claim/prompt/
 * verify/gc + remote rm.
 */
const HEADLINE_GROUP = 'Commands:';
const ADVANCED_GROUP = 'Advanced / plumbing:';
/** Help group for the de-emphasised plumbing FLAGS named in ADR §7. */
const ADVANCED_OPT_GROUP = 'Advanced / plumbing options:';

export function buildProgram(): Command {
	const program = new Command();

	program
		.name(brand.bin)
		.description('Autonomous parallel agents over file-based work/ queues.');

	program
		.command('scan')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'Read-only: list the cross-repo queue of work items (across the registered hub mirrors) and whether each is runnable now. Discovery is the registry — the hub-mirror set under workspacesDir/repos/ (no --root/roots).',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--auto-build',
			'allow agents to auto-build undeclared (not humanOnly) slices',
		)
		.option(
			'--no-auto-build',
			'forbid agents from auto-building undeclared slices (default)',
		)
		.option(
			'--arbiter-remote <name>',
			`the current repo's arbiter remote to fetch + diff its local section against (default: ${DEFAULT_ARBITER_REMOTE})`,
		)
		.option(
			'--no-cwd',
			'skip the cwd-local section (report only the cross-repo registry view)',
		)
		.option('--json', 'output the raw report as JSON')
		.action(async (flags: ScanFlags, command: Commander) => {
			const fileConfig = loadConfig(flags.config);
			const config = resolveGlobalConfig(
				fileConfig,
				flagOverrides(flags, command),
			);
			const warn = (message: string) => console.error(`>> ${message}`);
			const report = await scan(config, {warn});
			// The cwd-local section (the `scan-status-read-cwd-repo` slice): when run
			// INSIDE a participating repo, ALSO report it as a separately-counted local
			// block (fetch-its-arbiter-first), distinct from the registry view.
			const cwdSection =
				flags.cwd === false
					? undefined
					: await resolveCwdSection({
							cwd: process.cwd(),
							config,
							arbiterRemote: flags.arbiterRemote,
							warn,
						});
			if (flags.json) {
				console.log(
					JSON.stringify(
						{...report, cwd: cwdSection},
						(_key, value) => (value instanceof Set ? [...value] : value),
						2,
					),
				);
			} else {
				console.log(formatReport(report, cwdSection));
			}
		});

	program
		.command('run')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'The cross-repo, parallel daemon: loop the supervised tick over the registry — each tick claims up to maxParallel eligible items (perRepoMax per repo), runs the agents CONCURRENTLY in isolation, integrates, then loops (forever, or until a stop bound). Stuck items surface via the needs-attention seam (on main). `run --once` = one debug tick (NOT the CI path — CI is `do`).',
		)
		.option(
			'--once',
			'run a SINGLE supervised tick then stop — the debug/test affordance on the daemon (NOT the CI path; CI uses `do`)',
		)
		.option(
			'--advance',
			'DEPRECATED no-op alias: plain `run` ALREADY drives the registry-set advance tick (build/slice with calm-default gates; flip observationTriage / surfaceBlockers for the lifecycle). Passing this warns and is otherwise ignored. The old `--advance <mirror>` single-mirror form is gone — the daemon discovers the whole registry via scan.',
		)
		.option(
			'--max-iterations <n>',
			'stop after N ticks (a bounded session; default: loop forever)',
		)
		.option(
			'--max-duration <seconds>',
			'stop after this many seconds of wall-clock (a bounded session; default: no bound)',
		)
		.option(
			'--interval <seconds>',
			'pause this many seconds between ticks (default: 0, back-to-back)',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--auto-build',
			'allow agents to auto-build undeclared (not humanOnly) slices',
		)
		.option(
			'--no-auto-build',
			'forbid agents from auto-building undeclared slices (default)',
		)
		.option('--max-parallel <n>', 'global cap on items claimed+run this tick')
		.option('--per-repo-max <n>', 'per-repo cap on concurrent claims')
		.option('--arbiter <remote>', 'name of the arbiter git remote')
		.option(
			'--integration <mode>',
			'integration mode: propose (default) or merge',
		)
		.option(
			'--no-pr',
			'propose without opening a PR: push the branch but deliberately skip the review request, even on an authed GitHub arbiter (the explicit suppress-PR intent). Resolved flag > env > per-repo > global > default off.',
		)
		.option('--agent-cmd <cmd>', 'command to run one agent on a slice prompt')
		.option(
			'--model <id>',
			'model the agent runs on (routing intent; auth/keys stay the harness\u2019s job). pi: passed as --model; null/shell: substitutes a {model} placeholder in agentCmd. Resolved flag > env > per-repo > global > default (unset).',
		)
		.option(
			'--harness <adapter>',
			'harness adapter that launches the agent + reports liveness: null (default, shells out to agentCmd) or pi (the pi CLI)',
		)
		.option(
			'--pi-bin <path>',
			'pi CLI binary the pi harness invokes (default: pi on PATH)',
		)
		.option(
			'--sessions-dir <dir>',
			'HOST-ONLY root folder under which pi session files are generated (--session <dir>/<id>.jsonl). Default: pi per-cwd folder under ~/.pi/agent/sessions. Resolved flag > env > global > default (no per-repo).',
		)
		.option(
			'--workspace <dir>',
			'execution working area for hub mirrors + job worktrees (default: workspacesDir / ~/.agent-runner)',
		)
		.option(
			'--review',
			'run Gate 2 (PR/code review) after verify, before the done-move, on every item (overrides config). Resolved flag > env > per-repo > global > default off.',
		)
		.option('--no-review', 'do NOT run Gate 2 this tick (overrides config)')
		.option(
			'--review-model <id>',
			'model the Gate-2 review agent runs on (de-correlated from the builder; routing intent). Resolved flag > env > per-repo > global > default.',
		)
		.option(
			'--review-max-rounds <n>',
			'bound the revise/review loop; on exhaustion force needs-attention (default 2)',
		)
		.option(
			'--fresh-worktree-gate',
			'run the acceptance gate (prepare then verify) against the REBASED tip in a CLEAN throwaway worktree (the tree that integrates). ON by default; the `run` fleet uses it only when same-repo concurrency is off (perRepoMax=1), else today\u2019s in-build-worktree gate.',
		)
		.option(
			'--no-fresh-worktree-gate',
			'run the acceptance gate in the build worktree (the pre-rebase tree) — the opt-out for when the per-gate install cost is too high',
		)
		.option('--json', 'output the raw result as JSON')
		.action(async (flags: RunFlags, command: Commander) => {
			const fileConfig = loadConfig(flags.config);
			const config = resolveGlobalConfig(
				fileConfig,
				runFlagOverrides(flags, command),
			);
			// The null adapter shells out to agentCmd, so it is required there; the
			// pi adapter invokes the pi CLI directly and does not consume agentCmd.
			// Share the ONE predicate (doNeedsAgentCmd) with `do`/`--remote`.
			if (doNeedsAgentCmd(config)) {
				throw new Error(NO_AGENT_CMD_MESSAGE);
			}
			const workspace = flags.workspace ?? config.workspacesDir;
			// Gate 2 (PR/code review): wire the PRODUCTION harness-backed gate ONLY when
			// `config.review` resolves on (mirror the `do`/`complete` commands). The
			// per-repo review flags are resolved per-item inside `runOneItem`; only the
			// gate SEAM is threaded here. Off ⇒ undefined ⇒ no review (the default).
			const reviewGate = config.review ? harnessReviewGate() : undefined;
			const onWarn = (message: string) => console.error(`>> ${message}`);

			// Plain `run` (no flag) NOW drives the REGISTRY-SET ADVANCE tick as its
			// per-item unit (slice `run-uses-advance-tick`), via the deliberate
			// {@link RunTick} swap seam: the loop machinery (`runLoop`) is UNCHANGED, the
			// tick it loops is the precursor's registry-set advance driver instead of the
			// build-only `runOnce`. With BOTH lifecycle gates at their calm defaults
			// (observationTriage off, surfaceBlockers off) the advance tick degrades to
			// EXACTLY the old build tick's behaviour over the SAME substrate (registry-set
			// discovery + per-mirror job-worktree isolation) — behaviour-preserving today;
			// flip a gate and the SAME tick performs the lifecycle (triage/surface/apply).
			// `run` ≡ CI: the same advance tick, a different cadence.
			const advanceTick = buildRegistrySetAdvanceTick({
				config,
				workspace,
				arbiter: flags.arbiter,
				env: process.env,
			});
			// `--advance` is now a DEPRECATED NO-OP ALIAS: plain `run` already IS advance,
			// so there is no separate mode to opt into. Warn (but do not fail) so an
			// existing `run --advance` invocation keeps working without surprise.
			if (flags.advance) {
				onWarn(
					'`run --advance` is deprecated and ignored: plain `run` already runs the ' +
						'advance tick (build/slice with calm-default gates; set observationTriage ' +
						'/ surfaceBlockers for the lifecycle).',
				);
			}

			const printTick = (result: RunOnceResult): void => {
				if (flags.json) {
					console.log(JSON.stringify(result, null, 2));
					return;
				}
				for (const item of result.items) {
					console.log(formatItemLine(item));
				}
				console.log(
					`Summary: ${result.claimedAndDone} done, ${result.skipped} skipped, ${result.failed} failed.`,
				);
			};

			// `run --once` = ONE debug tick (NOT the CI path; CI is `do`). The existing
			// `runOnce` IS this tick.
			if (flags.once) {
				// The advance tick IS a RunTick, so `run --once` debug-ticks it (one
				// registry-set advance batch) identically to how it looped.
				const result = await advanceTick({
					config,
					workspace,
					reviewGate,
					onWarn,
				});
				printTick(result);
				return;
			}

			// `run` (no flag) = the cross-repo, parallel, forever-looping DAEMON: loop
			// the concurrent tick over the registry until a stop bound (--max-iterations
			// / --max-duration) or a SIGINT/SIGTERM (graceful shutdown after the current
			// tick). Stuck items surface via the existing needs-attention seam inside the
			// tick — the loop never infinite-retries and adds no bespoke reporting.
			let stopRequested = false;
			const requestStop = (): void => {
				if (!stopRequested) {
					stopRequested = true;
					console.error(
						'>> stop requested — finishing the current tick, then exiting.',
					);
				}
			};
			process.on('SIGINT', requestStop);
			process.on('SIGTERM', requestStop);
			try {
				const summary = await runLoop({
					config,
					workspace,
					reviewGate,
					onWarn,
					// The swap seam: plain `run` ALWAYS drives the registry-set ADVANCE tick
					// (build/slice with calm-default gates; the lifecycle when a gate is on).
					tick: advanceTick,
					maxIterations:
						flags.maxIterations !== undefined
							? Number(flags.maxIterations)
							: undefined,
					maxDurationMs:
						flags.maxDuration !== undefined
							? Number(flags.maxDuration) * 1000
							: undefined,
					intervalMs:
						flags.interval !== undefined ? Number(flags.interval) * 1000 : 0,
					stop: () => stopRequested,
					onTick: (result, iteration) => {
						if (!flags.json) {
							console.error(`>> tick ${iteration}:`);
						}
						printTick(result);
					},
				});
				if (!flags.json) {
					console.log(
						`Loop ended (${summary.stoppedBy}) after ${summary.iterations} tick(s): ` +
							`${summary.claimedAndDone} done, ${summary.skipped} skipped, ${summary.failed} failed.`,
					);
				} else {
					console.log(JSON.stringify(summary, null, 2));
				}
			} finally {
				process.off('SIGINT', requestStop);
				process.off('SIGTERM', requestStop);
			}
		});

	program
		.command('verify')
		.helpGroup(ADVANCED_GROUP)
		.description(
			"Run the repo's declared acceptance gate (per-repo `verify` config) and exit with its status (0 = pass). Deterministic shell gate; no model. Read-only with respect to work/.",
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.action(async (flags: VerifyFlags) => {
			const config = resolveGlobalConfig(loadConfig(flags.config), {});
			// DELIBERATELY verify-ONLY: the standalone `verify` command does NOT run the
			// `prepare` env-prep step first. `verify` is the PURE acceptance gate (env-
			// ready is a separate concern); a human invoking it prepares their own
			// checkout. `prepare` runs only in the runner's fresh-worktree lifecycle
			// (`do`/`run`/`complete` → `performIntegration`), where a fresh job worktree
			// off the hub mirror genuinely needs deps before the gate can be trusted.
			const result = await runVerify({
				cwd: process.cwd(),
				verify: config.verify,
			});
			process.exit(result.exitCode);
		});

	program
		.command('claim')
		.helpGroup(ADVANCED_GROUP)
		.description(
			'Atomically claim a work/backlog/<slug>.md item via a compare-and-swap push to the arbiter (in-process; mirrors scripts/claim.sh).',
		)
		.argument('<slug>', 'the slug of the backlog item to claim')
		.option(
			'--arbiter <remote>',
			'name of the arbiter git remote (default: origin)',
			'origin',
		)
		.option('--retries <n>', 'cap on push retries when main advances', '3')
		.option('--dry-run', 'show the intended push without mutating the arbiter')
		.option(
			'--ignore-not-ready',
			'override the readiness guard: claim despite an unmet blockedBy, and silence the needsAnswers warning (loud, never default)',
		)
		.action(async (rawSlug: string, flags: ClaimFlags) => {
			// Slice-only command (§3a): accept bare + `slice:`, reject `prd:`.
			const slug = resolveSliceOnlySlug(rawSlug) as string;
			// Wrap ONLY this CLI surface's `performClaim` call with the spinner
			// helper (slice `claim-cas-spinner`): the push can take seconds, so the
			// terminal looked frozen. In non-TTY mode the helper is a no-op and
			// stderr stays byte-identical to today (silent on success,
			// `error: <message>` on failure, `>> <note>` lines unchanged). The
			// autonomous `performClaim` call sites (`do`/`run`/`start`/`work-on`/
			// `continue-branch`) are explicitly OUT OF SCOPE.
			const spinner = createClaimSpinner({
				stream: process.stderr,
				isTTY: process.stdout.isTTY === true,
				clock: {
					setInterval: (fn, ms) => setInterval(fn, ms),
					clearInterval: (handle) =>
						clearInterval(handle as ReturnType<typeof setInterval>),
				},
				label: `Claiming ${slug}\u2026`,
			});
			const onSigint = (): void => {
				spinner.stop();
				process.exit(130);
			};
			process.on('SIGINT', onSigint);
			spinner.start();
			let result;
			try {
				result = await performClaim({
					slug,
					cwd: process.cwd(),
					arbiter: flags.arbiter ?? 'origin',
					retries:
						flags.retries !== undefined ? Number(flags.retries) : undefined,
					dryRun: flags.dryRun,
					humanPath: true,
					override: flags.ignoreNotReady === true,
					// HUMAN command (the `humanPath: true` above already says so): the
					// standalone `claim` CAS micro-commit + push is the human's, so it is
					// NOT given the runner `config.identity`. The AUTONOMOUS claim is the one
					// inside `do`/`run`/`intake` (identity-aware). Thread the ambient
					// `process.env` EXPLICITLY so the human-identity choice is declared at the
					// call site, not left to the seam's silent `?? process.env` fallback.
					env: process.env,
					note: (message) => spinner.note(message),
				});
			} catch (err) {
				// Unhandled error: tear the spinner down cleanly BEFORE the throw
				// propagates so the cursor is restored + no orphaned ANSI state.
				spinner.stop();
				process.off('SIGINT', onSigint);
				throw err;
			}
			spinner.finish(result);
			process.off('SIGINT', onSigint);
			process.exit(result.exitCode);
		});

	program
		.command('start')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'Claim a backlog item (only if needed) and onboard onto its work/<slug> branch in the CURRENT checkout. Decides on the folder on <arbiter>/main, never on a frontmatter field. Launches no agent/editor.',
		)
		.argument(
			'[slug]',
			'the slug to start (inferred from a work/<slug> branch if omitted)',
		)
		.option(
			'--arbiter <remote>',
			'name of the arbiter git remote (default: origin)',
			'origin',
		)
		// `--resume` is now the HIDDEN alias of the `resume` verb (ADR §4/§7): the
		// documented surface is `start` = begin here, `resume` = continue here. Kept
		// (hidden) for muscle memory; addHelpText below points at the verb.
		.addOption(
			new Option(
				'--resume',
				'(hidden alias of the `resume` verb) assert ownership of an already in-progress item: switch to its work branch without claiming',
			).hideHelp(),
		)
		.option(
			'--ignore-not-ready',
			'override the readiness guard: claim despite an unmet blockedBy, and silence the needsAnswers warning (loud, never default)',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--agent',
			'after onboarding, launch the configured harness INTERACTIVELY in the checkout (foreground, you drive it — no prepared prompt). Requires harness: pi. Not a tracked job (no record/gate); you still run `complete`/`requeue`.',
		)
		.option(
			'--harness <name>',
			'harness adapter for --agent: pi (interactive launch requires pi). Resolved flag > env > per-repo > global > default.',
		)
		.option(
			'--model <model>',
			'model the interactive --agent session starts pinned to (routing intent; you may switch inside pi). Resolved flag > env > per-repo > global > default.',
		)
		.option('--pi-bin <path>', 'path to the pi CLI binary (for --agent)')
		.option(
			'--sessions-dir <dir>',
			'HOST-ONLY root folder under which the --agent pi session file is generated',
		)
		.action((rawSlug: string | undefined, flags: StartFlags) =>
			runStartAction(rawSlug, flags, false),
		);

	program
		.command('resume')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'Re-engage an already in-progress item in the CURRENT checkout: switch to its work/<slug> branch WITHOUT claiming (the item is already in-progress; you assert ownership). The human “continue here” verb — the counterpart to `start` (“begin here”). Decides on the folder on <arbiter>/main, never on a frontmatter field. Launches no agent/editor.',
		)
		.argument(
			'[slug]',
			'the slug to resume (inferred from a work/<slug> branch if omitted)',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--arbiter <remote>',
			'name of the arbiter git remote (default: origin)',
			'origin',
		)
		.option(
			'--isolated',
			"re-engage the slug's RETAINED isolated job worktree (the inverse of `do --isolated`) WITHOUT claiming: locate it off THIS repo's arbiter and print its path to cd into. The symmetric companion of `complete --isolated` (finish the stranded worktree).",
		)
		.option(
			'--workspace <dir>',
			'execution working area for job worktrees (--isolated; default: workspacesDir / ~/.agent-runner)',
		)
		.action((rawSlug: string | undefined, flags: StartFlags) =>
			runStartAction(rawSlug, flags, true),
		);

	program
		.command('work-on')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'HUMAN command: claim a slice and create an isolated worktree in a human-friendly location (under config humanWorktreesDir, NEVER ~/.agent-runner) for parallel work, and cd you in by default (via the shell wrapper). Two forms: `work-on <slug>` (in-repo: infer the arbiter from the current repo) and `work-on --remote <r> <slug>` (ensure a hub mirror via repo-mirror, creating if absent) — consistent with `do --remote` (bare = current repo; --remote = anywhere). BOTH claim, then always fetch + branch work/<slug> off the freshly-fetched <arbiter>/main — same claim, same starting commit; only the worktree LOCATION differs. --copy <patterns> copies named gitignored files (copy, not symlink; --copy-from required in remote mode) with a security notice. A binary cannot cd your shell, so install the wrapper `work-on(){ cd "$(agent-runner work-on "$@" --print-dir)"; }`; --print-dir is that wrapper’s plumbing (emits ONLY the path).',
		)
		.argument(
			'<slug>',
			'the slug to work on (bare = the slice; the target repo is the current one, or --remote <r>)',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--remote <r>',
			'work on a REGISTERED repo with NO checkout: ensure a hub mirror via repo-mirror (creating if absent) and claim against it (consistent with `do --remote`). Omit for the in-repo form (the arbiter is inferred from the current repo).',
		)
		.option(
			'--arbiter <remote>',
			'name of the arbiter git remote in the current repo (in-repo form; default: origin)',
			'origin',
		)
		.addOption(
			new Option(
				'--copy <patterns>',
				'comma-separated gitignored filenames to COPY into the worktree (e.g. .env.local,.env). In-repo: from the current repo; remote: requires --copy-from. Copy, not symlink.',
			).helpGroup(ADVANCED_OPT_GROUP),
		)
		.addOption(
			new Option(
				'--copy-from <path>',
				'source dir for --copy in the remote form (required there; there is no implicit current repo)',
			).helpGroup(ADVANCED_OPT_GROUP),
		)
		.addOption(
			new Option(
				'--print-dir',
				'print ONLY the worktree path to stdout (for a shell wrapper: work-on(){ cd "$(agent-runner work-on "$@" --print-dir)"; })',
			).helpGroup(ADVANCED_OPT_GROUP),
		)
		.option(
			'--workspace <dir>',
			'execution working area for hub mirrors (default: workspacesDir / ~/.agent-runner)',
		)
		.option(
			'--ignore-not-ready',
			'override the readiness guard: claim despite an unmet blockedBy, and silence the needsAnswers warning (loud, never default)',
		)
		.option(
			'--agent',
			'after creating the worktree, launch the configured harness INTERACTIVELY in it (foreground, you drive it — no prepared prompt). Requires harness: pi. Not a tracked job (no record/gate); you still run `complete`/`requeue`.',
		)
		.option(
			'--harness <name>',
			'harness adapter for --agent: pi (interactive launch requires pi). Resolved flag > env > per-repo > global > default.',
		)
		.option(
			'--model <model>',
			'model the interactive --agent session starts pinned to (routing intent; you may switch inside pi). Resolved flag > env > per-repo > global > default.',
		)
		.option('--pi-bin <path>', 'path to the pi CLI binary (for --agent)')
		.option(
			'--sessions-dir <dir>',
			'HOST-ONLY root folder under which the --agent pi session file is generated',
		)
		.action(async (rawSlug: string, flags: WorkOnFlags) => {
			// The two forms are now distinguished by the `--remote` FLAG (ADR §4,
			// consistent with `do --remote`), not a positional <remote>: bare =
			// the current repo, `--remote <r>` = any registered repo.
			const remote =
				flags.remote !== undefined && flags.remote.trim() !== ''
					? flags.remote
					: undefined;
			// Slice-only command (§3a): accept bare + `slice:`, reject `prd:`.
			const theSlug = resolveSliceOnlySlug(rawSlug) as string;

			const configPath = flags.config ?? defaultConfigPath();
			const {dir: configuredRoot, config} = loadHumanWorktreesDir(configPath);
			const workspace = flags.workspace ?? config.workspacesDir;

			// --print-dir wants a clean stdout, so all human-facing notes go to
			// stderr; the path is the ONLY thing on stdout (printed below).
			const printDir = flags.printDir === true;
			const result = await performWorkOn({
				slug: theSlug,
				remote,
				cwd: process.cwd(),
				arbiter: flags.arbiter ?? 'origin',
				copy: flags.copy,
				copyFrom: flags.copyFrom,
				override: flags.ignoreNotReady === true,
				workspacesDir: workspace,
				humanWorktreesDir: configuredRoot,
				promptForRoot: (suggestion) => promptForWorktreesRoot(suggestion),
				saveRoot: (chosen) => persistHumanWorktreesDir(chosen, configPath),
				// `--agent`: launch the configured harness INTERACTIVELY in the new
				// worktree after creation (slice `agent-interactive-launch`). In-repo
				// mode resolves per-repo config from the current checkout; remote mode
				// (no checkout) resolves from the global config only (like `do --remote`).
				launchInteractive: buildInteractiveLauncher(
					flags,
					configPath,
					remote === undefined ? process.cwd() : undefined,
				),
				// HUMAN command (the description says so): claim + worktree + branch is
				// the human's, NOT given the runner `config.identity`. Ambient
				// `process.env` threaded EXPLICITLY (not the seam's silent fallback).
				env: process.env,
				note: (message) => console.error(`>> ${message}`),
			});
			if (result.exitCode !== 0) {
				console.error(`error: ${result.message}`);
				process.exit(result.exitCode);
			}
			if (printDir) {
				// Path only on stdout, so `cd "$(... --print-dir)"` works.
				process.stdout.write(`${result.dir}\n`);
			}
			process.exit(0);
		});

	program
		.command('prompt')
		.helpGroup(ADVANCED_GROUP)
		.description(
			"Print to stdout the work-agent prompt for a slice: the canonical CLAIM-PROTOCOL wrapper + the slice's own ## Prompt (with <slug> and source PRD substituted). Resolves work/in-progress/<slug>.md then work/backlog/<slug>.md; infers <slug> from a work/<slug> branch when omitted. Read-only, stdout only — the same assembly the autonomous runner feeds agentCmd.",
		)
		.argument(
			'[slug]',
			'the slug to render (inferred from a work/<slug> branch if omitted)',
		)
		.action((rawSlug: string | undefined) => {
			// Slice-only command (§3a): accept bare + `slice:`, reject `prd:`.
			const slug = resolveSliceOnlySlug(rawSlug);
			const output = renderPrompt({slug, cwd: process.cwd()});
			process.stdout.write(output);
		});

	program
		.command('complete')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'On a work/<slug> branch (slug inferred if omitted): run the gate, mark done (git mv in-progress\u2192done), commit (<type>(<slug>): <summary>; done) the agent\u2019s uncommitted work + the move, rebase onto <arbiter>/main, and integrate. Mode resolved at completion time (--merge/--propose > per-repo > global > default propose): merge\u2192push to main + switch+ff local main; propose\u2192push branch + switch to main (no ff). Then delete the LOCAL work branch iff provably on the arbiter (never the remote); --no-switch stays on the branch and keeps it. Never --force.',
		)
		.argument(
			'[slug]',
			'the slug to complete (inferred from a work/<slug> branch if omitted)',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--arbiter <remote>',
			'name of the arbiter git remote (default: origin)',
			'origin',
		)
		.option(
			'--merge',
			'integrate in merge mode this invocation (mutually exclusive with --propose; overrides config)',
		)
		.option(
			'--propose',
			'integrate in propose mode this invocation (mutually exclusive with --merge; overrides config)',
		)
		.option(
			'--no-pr',
			'propose without opening a PR: push the branch but deliberately skip the review request, even on an authed GitHub arbiter (the explicit suppress-PR intent). Resolved flag > env > per-repo > global > default off.',
		)
		.option(
			'--no-switch',
			'stay on the work/<slug> branch (and keep it) instead of switching back to main',
		)
		.option(
			'--ignore-diverged-main',
			'override the merge-mode divergence guard: complete --merge even when local main is ahead of <arbiter>/main (unpushed). The work still lands on the arbiter; local main is left for you to `git rebase`. Loud, never default.',
		)
		.option(
			'--isolated',
			"FINISH a STRANDED isolated worktree: integrate the slug's already-committed, already-done-moved retained job worktree (a terminal push failed AFTER the done-move+commit) by running ONLY the rebase\u2192integrate tail from the kept commit \u2014 the locate-EXISTING inverse of `do --isolated`. Detection is unspoofable: an already-integrated slice is a clean no-op; no retained worktree is a clean \u201cnothing to recover\u201d. --merge/--propose/--arbiter resolve identically to a normal integrate; the already-passed gate is skipped.",
		)
		.option(
			'--workspace <dir>',
			'execution working area for job worktrees (--isolated; default: workspacesDir / ~/.agent-runner)',
		)
		.addOption(
			new Option(
				'--skip-verify',
				'skip the acceptance gate (human-only escape hatch; the runner never skips)',
			).helpGroup(ADVANCED_OPT_GROUP),
		)
		.addOption(
			new Option('--type <type>', 'conventional-commit type for the commit')
				.default('feat')
				.helpGroup(ADVANCED_OPT_GROUP),
		)
		.addOption(
			new Option(
				'--message <summary>',
				'commit summary (default: the slice title, minus a leading "slug \u2014 " prefix)',
			).helpGroup(ADVANCED_OPT_GROUP),
		)
		.option(
			'--review',
			'run Gate 2 (PR/code review) after verify, before the done-move (overrides config). Resolved flag > per-repo > global > default off.',
		)
		.option(
			'--no-review',
			'do NOT run Gate 2 this invocation (overrides config)',
		)
		.option(
			'--review-model <id>',
			'model the Gate-2 review agent runs on (de-correlated from the builder; routing intent). Resolved flag > env > per-repo > global > default.',
		)
		.option(
			'--review-max-rounds <n>',
			'bound the revise/review loop; on exhaustion force needs-attention (default 2)',
		)
		.option(
			'--fresh-worktree-gate',
			'run the acceptance gate (prepare then verify) against the REBASED tip in a CLEAN throwaway worktree (the tree that integrates). ON by default. Resolved flag > env > per-repo > global > default on.',
		)
		.option(
			'--no-fresh-worktree-gate',
			'run the acceptance gate in the current checkout (the pre-rebase tree) — the opt-out for when the per-gate install cost is too high',
		)
		.action(async (rawSlug: string | undefined, flags: CompleteFlags) => {
			// Slice-only command (§3a): accept bare + `slice:`, reject `prd:`.
			const slug = resolveSliceOnlySlug(rawSlug);
			const cwd = process.cwd();
			const global = loadConfig(flags.config);

			// `--isolated`: FINISH a stranded isolated worktree (the recover-already-
			// committed path) instead of completing the current checkout. It LOCATES the
			// slug's retained job worktree off THIS repo's arbiter and runs ONLY the
			// rebase\u2192integrate tail from the kept commit. The slug is REQUIRED (there is no
			// branch to infer it from in the operator's checkout).
			if (flags.isolated === true) {
				if (slug === undefined || slug === '') {
					console.error(
						'error: complete --isolated requires <slug> (the stranded item to finish).',
					);
					process.exit(1);
				}
				const flagMode = integrationFromFlags(flags);
				const resolved = resolveRepoConfig({
					repoPath: cwd,
					global,
					flags: {
						...(flagMode ? {integration: flagMode} : {}),
						...noPRFlagOverrides(flags),
					},
				});
				if (resolved.message) {
					console.error(`>> ${resolved.message}`);
				}
				const isoConfig = resolved.config;
				const recovered = await performRecoverIsolated({
					slug,
					cwd,
					arbiter: flags.arbiter ?? isoConfig.defaultArbiter,
					workspacesDir: flags.workspace ?? isoConfig.workspacesDir,
					integration: isoConfig.integration,
					noPR: isoConfig.noPR,
					note: (message) => console.error(`>> ${message}`),
					env: process.env,
				});
				if (recovered.exitCode !== 0) {
					console.error(`error: ${recovered.message}`);
				}
				process.exit(recovered.exitCode);
			}

			// Resolve the integration mode at completion time, highest first:
			//   --merge/--propose flag > per-repo .agent-runner.json > global > default.
			// The flag sits at the TOP of the same chain the autonomous runner uses
			// (per-repo > global > default), so human and autonomous paths agree.
			const flagMode = integrationFromFlags(flags);
			const resolved = resolveRepoConfig({
				repoPath: cwd,
				global,
				// The integrate-time mode AND the Gate-2 review flags ride the SAME
				// flag > env > per-repo > global > default chain.
				flags: {
					...(flagMode ? {integration: flagMode} : {}),
					...reviewFlagOverrides(flags),
					// `--fresh-worktree-gate`/`--no-fresh-worktree-gate` rides the SAME chain.
					...freshWorktreeGateFlagOverrides(flags),
					// `--no-pr` (the PR-INTENT axis) rides the SAME chain.
					...noPRFlagOverrides(flags),
				},
			});
			if (resolved.message) {
				console.error(`>> ${resolved.message}`);
			}
			const config = resolved.config;
			const result = await performComplete({
				slug,
				cwd,
				arbiter: flags.arbiter ?? config.defaultArbiter,
				integration: config.integration,
				// An EXPLICIT `--merge` overrides the untrusted-origin build-propose rule (slice
				// `untrusted-origin-forces-build-propose`): `flagMode` is the typed flag
				// (undefined when none), so this is true ONLY when the operator typed
				// `--merge`, never when `merge` was resolved from config.
				explicitMerge: flagMode === 'merge',
				noPR: config.noPR,
				noSwitch: flags.switch === false,
				ignoreDivergedMain: flags.ignoreDivergedMain === true,
				prepare: config.prepare,
				verify: config.verify,
				skipVerify: flags.skipVerify,
				// Gate 2 (PR/code review): when `review` resolves on, run the `review`
				// SKILL as a fresh-context agent (the production harness-backed gate)
				// AFTER the green verify and BEFORE the done-move. The `reviewModel`
				// override flows to the launch through the existing harness seam.
				review: config.review,
				reviewModel: config.reviewModel,
				reviewMaxRounds: config.reviewMaxRounds,
				reviewGate: config.review ? harnessReviewGate() : undefined,
				// Run the acceptance gate against the REBASED tip in a clean throwaway
				// worktree (the tree that integrates) when ON (the default). `complete` is
				// a single-job path, so the resolved flag is passed UNCONDITIONALLY (no
				// fleet downgrade).
				freshWorktreeGate: config.freshWorktreeGate,
				type: flags.type,
				message: flags.message,
				// Color the propose-mode next-step block only on an interactive
				// stdout TTY (and not under NO_COLOR); plain when piped/redirected.
				color: shouldUseColor(process.stdout),
				note: (message) => console.error(`>> ${message}`),
				// The propose next-step block is printed verbatim (no `>> ` prefix)
				// so its blank lines + heading stand out as the human call-to-action.
				noteBlock: (message) => console.error(message),
				// `complete` is a HUMAN command: a human finishing/merging the work, so
				// the commit/push/PR is THEIRS — it is deliberately NOT given the runner
				// `config.identity` (the autonomous completion is `do`'s own integrated
				// complete, which IS identity-aware). Thread the ambient `process.env`
				// EXPLICITLY so the human-identity choice is declared at the call site,
				// not left to the seam's silent `?? process.env` fallback (parity with
				// `requeue`).
				env: process.env,
			});
			if (result.exitCode !== 0) {
				console.error(`error: ${result.message}`);
			}
			process.exit(result.exitCode);
		});

	program
		.command('do')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'The per-repo WORKER (the CI command): claim + onboard onto work/<slug>, run the agent, gate, integrate, and exit. In the CURRENT checkout by default (refuses on a dirty tree, integrates in-place). With --remote <r>: against a REGISTERED repo with NO checkout — materialise a hub mirror + job worktree in the agents\u2019 area, run the same pipeline there, then reap. do <slug> | do task:<slug> | do brief:<slug> (the slicing path) | do (auto-pick one) | do <a> <b> (those, in sequence) | do -n <x> (x eligible, in sequence). Auto-pick draws TASKS-FIRST then BRIEFS-to-slice by default (per-repo selectionOrder reorders the pools). --propose (default) / --merge resolved at integrate-time. Supersedes ar-run.sh.',
		)
		// EXTENSIBLE argument grammar (the three do-* slices grow this one block):
		// `do-autopick` widens the single optional positional into a VARIADIC one so
		// `do` (zero args = auto-pick), `do <a> <b> …` (named, in sequence), and
		// `do <slug>` (exactly one) all share the one command. `-n <x>` is the count
		// for the auto-pick form. `do` stays SEQUENTIAL (parallelism is `run`).
		.argument(
			'[slugs...]',
			'the item(s) to do: bare (= the task), task:<slug>, or brief:<slug> (slice the BRIEF). Zero args = auto-pick; multiple = do them in sequence.',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--arbiter <remote>',
			'name of the arbiter git remote (default: per-repo/global defaultArbiter)',
		)
		.option(
			'-n, --number <x>',
			'AUTO-PICK x eligible items and do them IN SEQUENCE (ordered by selectionOrder, default drain = slices-first then PRDs-to-slice). Sequential — never a parallelism knob (that is `run`). Mutually exclusive with naming items.',
		)
		.option(
			'--selection-order <order>',
			'order the auto-pick pools (build/slice/surface/triage; apply is always first): a preset keyword (drain (default) | groom) or an explicit comma-separated pool list (e.g. build,slice,surface,triage). Resolved flag > env > per-repo > global > default.',
		)
		.option(
			'--remote <r>',
			'run against a REGISTERED repo with NO checkout: materialise a hub mirror + job worktree in the agents\u2019 area (auto-registers an unknown remote), run the pipeline there, then reap (never touches the human area)',
		)
		.option(
			'--isolated',
			"build in an ISOLATED job worktree off THIS repo's arbiter (inferred from cwd) instead of taking over the current checkout, then integrate + reap \u2014 the in-place-but-isolated form. Shares the same grammar as the no-checkout forms: a single named item, multiple named items (in sequence), AND -n/auto-pick over the mirror-side eligible-pool scan. Always SEQUENTIAL (parallelism is `run` / the CI matrix). Orthogonal to --remote (a foreign repo); with --remote, remote wins (isolation is already implied).",
		)
		.option(
			'--merge',
			'integrate in merge mode this invocation (mutually exclusive with --propose; overrides config)',
		)
		.option(
			'--propose',
			'integrate in propose mode this invocation (default; mutually exclusive with --merge; overrides config)',
		)
		.option(
			'--slices-land-in <where>',
			'where `do prd:<slug>` slicing output lands: `pre-backlog` (staged, not agent-eligible) or `backlog` (the pool). The EXPLICIT operator override at the top of the placement precedence (explicit flag > untrusted-origin forces staging > slicesLandIn default > built-in). Resolved flag > env (AGENT_RUNNER_SLICES_LAND_IN) > per-repo > global > built-in.',
		)
		.option(
			'--no-pr',
			'propose without opening a PR: push the branch but deliberately skip the review request, even on an authed GitHub arbiter (the explicit suppress-PR intent). Resolved flag > env > per-repo > global > default off.',
		)
		.option(
			'--ignore-diverged-main',
			'override the in-place divergence guard: run even when local main is ahead of <arbiter>/main (unpushed). The work still lands on the arbiter; local main is left for you to `git rebase`. In-place only; loud, never default.',
		)
		.option('--agent-cmd <cmd>', 'command to run the agent on the slice prompt')
		.option(
			'--model <id>',
			'model the agent runs on (routing intent; resolved flag > env > per-repo > global > default)',
		)
		.option(
			'--harness <adapter>',
			'harness adapter that launches the agent: null (default, shells out to agentCmd) or pi (the pi CLI)',
		)
		.option(
			'--pi-bin <path>',
			'pi CLI binary the pi harness invokes (default: pi on PATH)',
		)
		.option(
			'--sessions-dir <dir>',
			'HOST-ONLY root folder under which the pi session file is generated (--session <dir>/<id>.jsonl). Default: pi per-cwd folder under ~/.pi/agent/sessions. Resolved flag > env > global > default (no per-repo).',
		)
		.option(
			'--watch',
			"stream the agent's high-signal events live by tailing the pi session log (requires harness: pi; READ-ONLY observer — does not change outcome/gate/git)",
		)
		.option(
			'--review',
			'run Gate 2 (PR/code review) after verify, before the done-move (overrides config). Resolved flag > env > per-repo > global > default off.',
		)
		.option(
			'--no-review',
			'do NOT run Gate 2 this invocation (overrides config)',
		)
		.option(
			'--review-model <id>',
			'model the Gate-2 review agent runs on (de-correlated from the builder; routing intent). Resolved flag > env > per-repo > global > default.',
		)
		.option(
			'--review-max-rounds <n>',
			'bound the revise/review loop; on exhaustion force needs-attention (default 2)',
		)
		.option(
			'--slicer-loop',
			'run the slicer IMPROVER loop on `do prd:<slug>` (review→edit→converge over the produced slice set). ON by default; --no-slicer-loop skips it. DISTINCT from the acceptance gate (--review).',
		)
		.option(
			'--no-slicer-loop',
			'skip the slicer improver loop on `do prd:<slug>`',
		)
		.option(
			'--slicer-loop-max <n>',
			'cap the slicer improver loop on `do prd:<slug>` (in-context review passes); on exhaustion with blockers, reject via needsAnswers / route the PRD to needs-attention (default 3)',
		)
		.option(
			'--slicer-loop-model <id>',
			'model the slicer improver loop review agent runs on (de-correlated from the slicer; routing intent). Resolved flag > env > per-repo > global > default. DISTINCT from --review-model.',
		)
		.option(
			'--fresh-worktree-gate',
			'run the acceptance gate (prepare then verify) against the REBASED tip in a CLEAN throwaway worktree (the tree that actually integrates), so a green gate provably describes the merged artifact. ON by default. Resolved flag > env > per-repo > global > default on.',
		)
		.option(
			'--no-fresh-worktree-gate',
			"run the acceptance gate in the agent's build worktree (the pre-rebase tree) as before — the opt-out for when the per-gate install cost is too high",
		)
		.action(async (rawSlugs: string[], flags: DoFlags) => {
			// Variadic grammar (`do-autopick`): zero args = AUTO-PICK; one = the single
			// named item; many = those, IN SEQUENCE. `-n <x>` is the auto-pick count.
			const args = rawSlugs ?? [];

			// `-n <x>` parse + validation. It is the AUTO-PICK count (sequential), so it
			// is mutually exclusive with NAMING items (you either auto-pick a count or
			// name the items, not both).
			let count: number | undefined;
			if (flags.number !== undefined) {
				const n = Number(flags.number);
				if (flags.number.trim() === '' || !Number.isInteger(n) || n < 1) {
					console.error(
						`error: -n/--number must be a positive integer (got '${flags.number}').`,
					);
					process.exit(1);
				}
				if (args.length > 0) {
					console.error(
						'error: -n/--number auto-picks a COUNT of eligible items; do not also ' +
							'name items. Use `do -n <x>` OR `do <a> <b> ...`, not both.',
					);
					process.exit(1);
				}
				count = n;
			}

			const cwd = process.cwd();
			const global = loadConfig(flags.config);
			// Resolve the integration mode at integrate-time, highest first:
			//   --merge/--propose flag > per-repo .agent-runner.json > global > default.
			// (Same chain `complete` uses — `do` is the autonomous twin.)
			let flagMode;
			try {
				flagMode = integrationFromFlags(flags);
			} catch (err) {
				console.error(
					`error: ${err instanceof Error ? err.message : String(err)}`,
				);
				process.exit(1);
			}

			// `do --remote <r>` / `do --isolated <slug>`: run the NO-CHECKOUT job-worktree
			// pipeline. Both materialise a hub mirror + job worktree in the agents' area
			// (`workspacesDir`) and reap per ADR §4 — the human area is NEVER touched.
			//
			// `--remote <r>` names the TARGETING axis (a FOREIGN repo, no checkout); the
			// arbiter spec is the `<r>` URL. `--isolated` names the ISOLATION intent (a
			// worktree off MY OWN arbiter, even though I am inside the repo); its arbiter
			// URL is RESOLVED FROM THE CWD's arbiter remote (the same `--arbiter` >
			// per-repo/global `defaultArbiter` name in-place `do` uses). The two are
			// ORTHOGONAL: `--isolated` + `--remote` is REDUNDANT (a foreign `--remote` is
			// already isolated), so we accept it and `--remote` WINS (see `## Decisions`).
			//
			// In BOTH cases the repo's COMMITTED `.agent-runner.json` is reachable on
			// `<arbiter>/main` (the mirror), so we layer it — `flag > env > per-repo >
			// global > default` parity with in-place `do` (slice
			// `remote-do-reads-per-repo-config-from-arbiter-main`). Only the whitelisted
			// `REPO_ALLOWED_KEYS` are layered (host-only keys stay global/flag/env-only,
			// rejected by the SAME `repo-config.ts` split).
			const isolatedNoRemote =
				flags.isolated === true && flags.remote === undefined;
			if (flags.remote !== undefined || isolatedNoRemote) {
				// The form's user-facing name + canonical usage, for the shared error
				// messages below (so `--isolated` errors read in its own terms).
				const form = isolatedNoRemote ? '--isolated' : '--remote';
				const usage = isolatedNoRemote
					? '`do --isolated <slug>`'
					: '`do --remote <r> <slug>`';
				// The no-checkout forms now support the SAME variadic grammar the in-place
				// form does: a single NAMED item, MULTIPLE named items (sequential), and
				// AUTO-PICK / `-n <x>` (sequential) over the MIRROR-SIDE eligible-pool scan
				// (`mirror-side-eligible-pool-scan`). The old inline `-n`×`--remote` REFUSAL
				// is GONE — the mirror scan backs it now (US #25); `-n` stays ALWAYS
				// SEQUENTIAL (parallelism is `run` / the CI matrix). `-n` is still mutually
				// exclusive with naming items (validated above, shared with the in-place form).
				const remoteFlags = doFlagOverrides(flags, flagMode);
				// Resolve the arbiter spec the rest of the pipeline consumes as `remote`.
				// `--remote` supplies it directly (a foreign URL). `--isolated` resolves it
				// from the CWD's arbiter remote (`git remote get-url`); no resolvable
				// arbiter ⇒ a CLEAR error naming `--remote <url>` as the foreign-repo
				// alternative — NOT a confusing URL-parse failure downstream.
				let effectiveRemote: string;
				if (isolatedNoRemote) {
					const bootstrapIdentity = resolveGlobalConfig(
						global,
						remoteFlags,
					).identity;
					const arbiterName =
						flags.arbiter ??
						resolveDefaultArbiterForCwd(cwd, global, remoteFlags);
					const resolvedUrl = resolveArbiterUrlFromCheckout(
						cwd,
						arbiterName,
						identityEnv(bootstrapIdentity, process.env),
					);
					if (resolvedUrl === undefined) {
						console.error(
							`error: --isolated builds in a worktree off this repo's arbiter ` +
								`('${arbiterName}'), but no such arbiter remote is configured/found ` +
								`here. Run inside a participating repo (a clone with an arbiter ` +
								`remote), or use --remote <url> to target another repo.`,
						);
						process.exit(1);
					}
					effectiveRemote = resolvedUrl;
				} else {
					effectiveRemote = flags.remote as string;
				}
				// BOOTSTRAP resolution (global + flags, no per-repo layer) — it supplies
				// the HOST-ONLY keys needed to even reach the arbiter's committed file:
				// `workspacesDir` (where the mirror lives) and `identity` (the git env the
				// mirror fetch runs under). These are host-only by definition (rejected
				// per-repo), so reading them from global+flags first is correct and stable.
				const bootstrap = resolveGlobalConfig(global, remoteFlags);
				// Source the committed `.agent-runner.json` from `<arbiter>/main` via the
				// hub mirror, then layer ONLY its whitelisted keys through the EXISTING
				// per-repo machinery. The read refreshes ONLY `main` (no-prune), so a
				// `work/<slug>` branch checked out in a stale worktree can never block it,
				// and the build's later all-heads materialisation fetch is unaffected. A
				// config-less repo (no file on
				// main, or an unreachable mirror) → exactly the bootstrap config, i.e.
				// byte-identical to the pre-slice global+default behaviour.
				const remoteConfig = resolveRemoteRepoConfig({
					remote: effectiveRemote,
					workspacesDir: bootstrap.workspacesDir,
					global,
					flags: remoteFlags,
					identity: bootstrap.identity,
					note: (message) => console.error(`>> ${message}`),
				});
				if (doNeedsAgentCmd(remoteConfig)) {
					console.error(`error: ${NO_AGENT_CMD_MESSAGE}`);
					process.exit(1);
				}
				const remoteHarness = createHarness({
					harness: remoteConfig.harness,
					piBin: remoteConfig.piBin,
				});
				// The per-item `DoRemoteOptions` (everything BUT `arg`) — built ONCE and
				// reused for the single-item path AND threaded by the mirror-side auto-pick
				// driver (`performDoRemoteAuto`) to each sequential `performDoRemote`.
				const baseRemoteOptions: Omit<DoRemoteOptions, 'arg'> = {
					remote: effectiveRemote,
					workspacesDir: remoteConfig.workspacesDir,
					arbiter: flags.arbiter ?? remoteConfig.defaultArbiter,
					// Host-only runner IDENTITY — scopes git/provider ops only (not the
					// agent launch); absent ⇒ ambient.
					identity: remoteConfig.identity,
					// `do --remote prd:<slug>` slicing-gate policy (slice-build path ignores it).
					autoSlice: remoteConfig.autoSlice,
					integration: remoteConfig.integration,
					// EXPLICIT `--merge` override for the untrusted-origin build-propose rule.
					explicitMerge: flagMode === 'merge',
					// Per-TRANSITION SLICING override (the `do --remote prd:` slicing path).
					slicingIntegration: remoteConfig.slicingIntegration,
					// SLICE-PLACEMENT: the configured default + the EXPLICIT operator override
					// (`--slices-land-in`), the top of the placement precedence — mirrors
					// `explicitMerge` (set only when the flag was typed).
					slicesLandIn: remoteConfig.slicesLandIn,
					explicitSlicesLandIn: explicitSlicesLandInFromFlag(
						flags.slicesLandIn,
					),
					prepare: remoteConfig.prepare,
					verify: remoteConfig.verify,
					// Single-job build path: gate the REBASED tip (the default) unconditionally.
					freshWorktreeGate: remoteConfig.freshWorktreeGate,
					noPR: remoteConfig.noPR,
					harness: remoteHarness,
					agentCmd: remoteConfig.agentCmd,
					model: remoteConfig.model,
					sessionsDir: remoteConfig.sessionsDir,
					review: remoteConfig.review,
					reviewModel: remoteConfig.reviewModel,
					reviewMaxRounds: remoteConfig.reviewMaxRounds,
					reviewGate: remoteConfig.review
						? harnessReviewGate({
								harness: remoteHarness,
								agentCmd: remoteConfig.agentCmd,
							})
						: undefined,
					// The slicer IMPROVER loop on the `do --remote prd:` path is ON by default
					// (auto-slicing has no `verify` floor, so the loop is the slice path's
					// quality engine). `--slicer-loop`/`--no-slicer-loop` gates wiring the seam;
					// `slicerLoopMax`/`slicerLoopModel` resolve per-repo (flag > env > per-repo
					// > global > default). DISTINCT from the gate's `--review*` family.
					reviewLoop: remoteConfig.slicerLoop
						? harnessSliceReviewGate({
								harness: remoteHarness,
								agentCmd: remoteConfig.agentCmd,
							})
						: undefined,
					slicerLoopMax: remoteConfig.slicerLoopMax,
					slicerLoopModel: remoteConfig.slicerLoopModel,
					// The slice-SET ACCEPTANCE GATE on the `do --remote prd:` path too.
					sliceReviewGate: remoteConfig.review
						? harnessSliceAcceptanceGate({
								harness: remoteHarness,
								agentCmd: remoteConfig.agentCmd,
							})
						: undefined,
					watch: flags.watch === true,
					color: shouldUseColor(process.stdout),
					note: (message) => console.error(`>> ${message}`),
					noteBlock: (message) => console.error(message),
				};

				// DISPATCH the variadic grammar (the NO-CHECKOUT forms):
				//   zero args        -> AUTO-PICK `count` (default 1) over the MIRROR-SIDE
				//                       eligible-pool scan, run SEQUENTIALLY.
				//   one named arg     -> the single-item remote pipeline (unchanged).
				//   many named args   -> those, IN SEQUENCE (operator's order; no pool).
				// `--watch` tails ONE session, so it only fits the single-named-item form;
				// the auto/`-n`/multi forms run many ticks and do not stream a single log.
				const remoteMulti =
					args.length === 0 || count !== undefined || args.length > 1;
				if (remoteMulti && flags.watch === true) {
					console.error(
						`error: --watch streams ONE session; it does not combine with the ` +
							`${form} auto-pick / -n / multi-item forms. Name a single item: ${usage}.`,
					);
					process.exit(1);
				}
				if (args.length === 0 || count !== undefined) {
					// AUTO-PICK / `-n <x>` over the MIRROR-SIDE eligible-pool scan, SEQUENTIAL.
					const multi = await performDoRemoteAuto({
						...baseRemoteOptions,
						config: remoteConfig,
						count,
						warn: (message) => console.error(`>> ${message}`),
					});
					console.error(`>> ${multi.message}`);
					process.exit(multi.exitCode);
				}
				if (args.length > 1) {
					// EXPLICIT named items, IN SEQUENCE (the operator's order; no pool).
					const multi = await performDoRemoteArgs(args, {
						...baseRemoteOptions,
						config: remoteConfig,
					});
					console.error(`>> ${multi.message}`);
					process.exit(multi.exitCode);
				}

				// Exactly one named item: the single-item remote pipeline.
				const remoteResult = await performDoRemote({
					...baseRemoteOptions,
					arg: args[0],
				});
				if (remoteResult.exitCode !== 0) {
					console.error(`error: ${remoteResult.message}`);
				}
				process.exit(remoteResult.exitCode);
			}

			// Thread the `do` CLI flags (--harness/--agent-cmd/--pi-bin/--model)
			// AND the integrate-time mode into the resolved config — the SAME flag
			// override path `run` uses (do-config.doFlagOverrides reuses
			// harnessFlagOverrides). Passing only `{integration}` here silently
			// DROPPED --harness pi etc.; now flag > env > per-repo > global > default
			// holds for `do` as for `run`.
			const resolved = resolveRepoConfig({
				repoPath: cwd,
				global,
				flags: doFlagOverrides(flags, flagMode),
			});
			if (resolved.message) {
				console.error(`>> ${resolved.message}`);
			}
			const config = resolved.config;
			// The null adapter shells out to agentCmd, so it is required there; the
			// pi adapter invokes the pi CLI directly and does not consume agentCmd.
			if (doNeedsAgentCmd(config)) {
				console.error(`error: ${NO_AGENT_CMD_MESSAGE}`);
				process.exit(1);
			}
			const harness = createHarness({
				harness: config.harness,
				piBin: config.piBin,
			});
			// The per-item `DoOptions` (everything BUT `arg`) — built ONCE and reused for
			// the single-item path AND threaded by the multi-item layer to each
			// sequential `performDo` (do-autopick runs the EXISTING pipeline per item).
			const baseDoOptions: Omit<DoOptions, 'arg'> = {
				cwd,
				arbiter: flags.arbiter ?? config.defaultArbiter,
				// The host-only runner IDENTITY (a bot): scopes the runner's git/provider
				// ops (claim, push, integrate, `gh`) — NEVER the agent launch. Absent ⇒
				// ambient (today's behaviour). Mapped Config → DoOptions like model/agentCmd.
				identity: config.identity,
				// `do prd:<slug>` slicing-gate policy (the slice-build path ignores it).
				autoSlice: config.autoSlice,
				integration: config.integration,
				// EXPLICIT `--merge` override for the untrusted-origin build-propose rule (slice
				// `untrusted-origin-forces-build-propose`): true ONLY when the operator
				// typed `--merge` (`flagMode`), never when `merge` came from config — so an
				// untrusted-origin slice still forces propose under a config `merge`.
				explicitMerge: flagMode === 'merge',
				// Per-TRANSITION SLICING override: the `do prd:` slicing path threads
				// `slicingIntegration ?? integration`; the slice-build path stays on
				// `integration`. Unset ⇒ slicing falls back to `integration` (today's behaviour).
				slicingIntegration: config.slicingIntegration,
				// SLICE-PLACEMENT (`do prd:` slicing output): the configured default rung +
				// the EXPLICIT operator override `--slices-land-in` (top of the precedence).
				// `explicitSlicesLandIn` is set ONLY when the flag was typed (mirrors
				// `explicitMerge`), so an untrusted-origin staging force still wins under a
				// config default.
				slicesLandIn: config.slicesLandIn,
				explicitSlicesLandIn: explicitSlicesLandInFromFlag(flags.slicesLandIn),
				// In-place divergence guard override (mirrors --ignore-not-ready).
				ignoreDivergedMain: flags.ignoreDivergedMain === true,
				prepare: config.prepare,
				verify: config.verify,
				// Single-job build path: gate the REBASED tip (the default) unconditionally.
				freshWorktreeGate: config.freshWorktreeGate,
				noPR: config.noPR,
				harness,
				agentCmd: config.agentCmd,
				model: config.model,
				// The HOST-ONLY sessions root (resolved Config → DoOptions bridge, like
				// model/agentCmd): the path generator turns it into
				// `<sessionsDir>/<id>.jsonl` for `--session`. Without this map the key
				// resolves but never reaches the launch (a silent no-op).
				sessionsDir: config.sessionsDir,
				// Gate 2 (PR/code review) rides inside `complete` (so CI inherits it for
				// free): when `review` resolves on, run the `review` SKILL as a
				// fresh-context agent (its OWN harness launch — same adapter + agentCmd,
				// `reviewModel` via the existing model-routing seam) after the green
				// verify, before the done-move. A block routes to needs-attention.
				review: config.review,
				reviewModel: config.reviewModel,
				reviewMaxRounds: config.reviewMaxRounds,
				reviewGate: config.review
					? harnessReviewGate({harness, agentCmd: config.agentCmd})
					: undefined,
				// The slicer IMPROVER loop on the `do prd:` slicing path is ON by default
				// (auto-slicing has no `verify` floor — the loop is the slice path's quality
				// engine). `--slicer-loop`/`--no-slicer-loop` gates wiring the seam;
				// `slicerLoopMax`/`slicerLoopModel` resolve per-repo (flag > env > per-repo
				// > global > default); the slice-build path ignores all of these. DISTINCT
				// from the acceptance gate's `--review*` family.
				reviewLoop: config.slicerLoop
					? harnessSliceReviewGate({
							harness,
							agentCmd: config.agentCmd,
						})
					: undefined,
				slicerLoopMax: config.slicerLoopMax,
				slicerLoopModel: config.slicerLoopModel,
				// The slice-SET ACCEPTANCE GATE (slice-acceptance-gate): the slice-path
				// mirror of Gate-2, on the SAME `--review` family (so `--no-review` skips
				// it). ONE-SHOT (no rounds); production wires the slice-SET-prompt gate.
				sliceReviewGate: config.review
					? harnessSliceAcceptanceGate({harness, agentCmd: config.agentCmd})
					: undefined,
				// `--watch`: tail the pi session log live (pi harness only; the
				// performDo guard errors clearly on any other adapter). READ-ONLY.
				watch: flags.watch === true,
				color: shouldUseColor(process.stdout),
				note: (message) => console.error(`>> ${message}`),
				noteBlock: (message) => console.error(message),
			};

			// DISPATCH the variadic grammar (in-place forms):
			//   zero args         -> AUTO-PICK `count` (default 1) across the two pools
			//                        (ordered by selectionOrder; default drain = slices-first)
			//   one named arg     -> the single-item pipeline (unchanged from do-in-place)
			//   many named args   -> those, IN SEQUENCE (operator's order; no pool)
			// Auto-pick / multi-arg run the EXISTING `performDo` pipeline per item,
			// sequentially (`do` is sequential; parallelism is `run`).
			if (args.length === 0) {
				const multi: DoMultiResult = await performDoAuto({
					...baseDoOptions,
					config,
					count,
				});
				console.error(`>> ${multi.message}`);
				process.exit(multi.exitCode);
			}
			if (args.length > 1) {
				const multi: DoMultiResult = await performDoArgs(args, {
					...baseDoOptions,
					config,
				});
				console.error(`>> ${multi.message}`);
				process.exit(multi.exitCode);
			}

			// Exactly one named item: the single-item in-place pipeline (do-in-place).
			const result = await performDo({...baseDoOptions, arg: args[0]});
			if (result.exitCode !== 0) {
				console.error(`error: ${result.message}`);
			}
			process.exit(result.exitCode);
		});

	// `advance` — the SIBLING top-level verb (NOT a `do` subcommand; `do`
	// subcommands + a standalone `slice` verb are REJECTED in PRD `advance-loop`).
	// It reuses the SAME shared `prefix:arg` resolver `do` uses, EXTENDED with the
	// `obs:` namespace, and wires the classify → lock → execute SKELETON: classify
	// the rung (read-only, no model, no lock), take the `advancing` CAS borrow, then
	// dispatch winner-only — build/slice rungs ORCHESTRATE `do`/`do prd:` (never a
	// duplicate), surface/apply/triage dispatch to a named executor seam later
	// slices fill. The DRIVERS (one-shot/loop) + `-n` + per-action gates and the
	// rung BODIES are LATER slices; the bare eligible-SET form errors clearly here.
	program
		.command('advance')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'Advance work/ item(s) one lifecycle rung toward ready/built (BRIEF advance-loop), the SEQUENTIAL one-shot driver over the advance tick. advance <slug> (bare = the task) | advance brief:<slug> (the BRIEF slice rung) | advance obs:<slug> (triage an observation) | advance (auto-pick one eligible) | advance <a> <b> (those, in sequence) | advance -n <x> (x eligible, in sequence). Each item: classify (read-only, no model, no lock) → take the `advancing` CAS lock → dispatch winner-only — build/slice rungs ORCHESTRATE `do`/`do prd:`, surface/apply always run, triage respects observationTriage (off|ask|auto). The bare/`-n` selection respects the per-action gates (build→autoBuild, slice→autoSlice, triage→observationTriage); `-n` is ALWAYS sequential (parallelism is `run` / the CI matrix).',
		)
		.argument(
			'[slugs...]',
			'the item(s) to advance: bare (= the task), task:<slug>, brief:<slug>, or obs:<slug> (an observation). Zero args = auto-pick one eligible; multiple = advance them in sequence.',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--arbiter <remote>',
			'name of the arbiter git remote (default: per-repo/global defaultArbiter)',
		)
		.option(
			'-n, --number <x>',
			'AUTO-PICK x eligible items and advance them IN SEQUENCE (ordered by selectionOrder, default drain = slices-first then PRDs-to-slice). Sequential — never a parallelism knob (that is `run` / the CI matrix). Mutually exclusive with naming items.',
		)
		.option(
			'--isolated',
			"advance in an ISOLATED worktree off THIS repo's arbiter (inferred from cwd) instead of taking over the current checkout, then integrate + reap — the in-place-but-isolated form. Shares the same grammar: a single named item, multiple named items (in sequence), AND -n/auto-pick over the mirror-side eligible-pool scan. Always SEQUENTIAL (parallelism is `run` / the CI matrix). Lets you advance from a busy/dirty checkout or anywhere with a participating arbiter.",
		)
		.option(
			'--selection-order <order>',
			'order the auto-pick pools (build/slice/surface/triage; apply is always first): a preset keyword (drain (default) | groom) or an explicit comma-separated pool list. Resolved flag > env > per-repo > global > default.',
		)
		.option(
			'--observation-triage <mode>',
			'the observation-inbox gate (off|ask|auto): off (default) leaves observations untouched (the triage pool is dropped from auto-pick); ask surfaces a promote/keep/delete question for each untriaged observation; auto auto-disposes the no-question cases (duplicate/map) and asks about the rest. Resolved flag > env > per-repo > global > default. An explicit `advance obs:<slug>` bypasses the selection gate and runs in ask-mode (auto-disposes only under `auto`).',
		)
		.option(
			'--surface-blockers',
			'the declared-blocked-work gate (the orthogonal peer of --observation-triage): render a slice/PRD carrying needsAnswers:true into an answerable question sidecar (the needsAnswers-blocked pool is enumerated into auto-pick). Resolved flag > env > per-repo > global > default off. An explicit `advance <slug>`/`advance brief:<slug>` bypasses this selection gate and surfaces regardless. Does NOT gate apply (an answered sidecar still applies) or needs-attention (always on).',
		)
		.option(
			'--no-surface-blockers',
			'leave a needsAnswers:true slice/PRD silently blocked (default; the blocked pool is dropped from auto-pick)',
		)
		.option(
			'--merge',
			'integrate the advanced item(s) in merge mode this invocation (mutually exclusive with --propose; overrides config). The CI merge shape is a SINGLE SEQUENTIAL job, so this rides the `-n`/named-sequence path, never the matrix.',
		)
		.option(
			'--propose',
			'integrate the advanced item(s) in propose mode this invocation (default; mutually exclusive with --merge; overrides config). The CI propose shape is the parallel matrix (one PR per item).',
		)
		.option(
			'--slices-land-in <where>',
			'where `advance prd:<slug>` slicing output lands: `pre-backlog` (staged) or `backlog` (the pool). The EXPLICIT operator override at the top of the placement precedence. Resolved flag > env (AGENT_RUNNER_SLICES_LAND_IN) > per-repo > global > built-in.',
		)
		.option(
			'--watch',
			"stream the build agent's high-signal events live by tailing the pi session log (requires harness: pi; READ-ONLY observer — does not change outcome/gate/git). The same view `do --watch` gives, threaded through the build rung; CI uses it so the job log shows the agent working instead of freezing.",
		)
		.action(async (rawSlugs: string[], flags: DoFlags) => {
			// Variadic grammar (mirrors `do`): zero args = AUTO-PICK; one = the single
			// named item; many = those, IN SEQUENCE. `-n <x>` is the auto-pick count
			// (ALWAYS sequential, US #25).
			const args = rawSlugs ?? [];

			// `-n <x>` parse + validation — the AUTO-PICK count (sequential), mutually
			// exclusive with NAMING items (the SAME contract `do -n` enforces).
			let count: number | undefined;
			if (flags.number !== undefined) {
				const n = Number(flags.number);
				if (flags.number.trim() === '' || !Number.isInteger(n) || n < 1) {
					console.error(
						`error: -n/--number must be a positive integer (got '${flags.number}').`,
					);
					process.exit(1);
				}
				if (args.length > 0) {
					console.error(
						'error: -n/--number auto-picks a COUNT of eligible items; do not also ' +
							'name items. Use `advance -n <x>` OR `advance <a> <b> ...`, not both.',
					);
					process.exit(1);
				}
				count = n;
			}

			const cwd = process.cwd();
			const global = loadConfig(flags.config);
			// Resolve the integration mode this invocation asks for, highest first:
			//   --merge/--propose flag > per-repo .agent-runner.json > global > default.
			// The SAME chain `do`/`complete` use (via `integrationFromFlags`), so the
			// human, the autonomous runner, and the CI workflow all resolve the SAME
			// order. This is what ties the CI dispatch `integrationMode` to the actual
			// open-PR-vs-merge-to-main behaviour: the propose-matrix legs pass
			// `--propose` and the single sequential merge job passes `--merge`, so the
			// integration mode can never DESYNC from the job shape the input selected.
			let flagMode;
			try {
				flagMode = integrationFromFlags(flags);
			} catch (err) {
				console.error(
					`error: ${err instanceof Error ? err.message : String(err)}`,
				);
				process.exit(1);
			}
			// Build the flag overrides (the `--observation-triage` enum FAILS LOUDLY on a
			// typo, like the env coercion) before resolving — a bad gate value is a clean
			// usage error, never silently dropped.
			let doOverrides;
			try {
				doOverrides = doFlagOverrides(flags, flagMode);
			} catch (err) {
				console.error(
					`error: ${err instanceof Error ? err.message : String(err)}`,
				);
				process.exit(1);
			}

			// `advance --isolated`: run the advance TICK in an ISOLATED worktree off
			// THIS repo's arbiter (resolved from cwd), then integrate + reap — the
			// in-place-but-isolated form, the SAME ergonomic `do --isolated` has. We
			// REUSE `do --isolated`'s arbiter-from-cwd resolver + the isolation substrate
			// (`ensureMirror` + the job-worktree `doDriver` + reap), threading the
			// arbiter URL into the NEW isolated advance-tick runner. `--isolated` is the
			// only ISOLATION axis here: `advance --remote <url>` is a SEPARATE concern
			// (the action already TYPES `flags.remote` via `DoFlags`, but no `--remote`
			// plumbing exists on `advance` — see `## Decisions`), so `--isolated` always
			// resolves the arbiter from the CWD.
			if (flags.isolated === true) {
				// BOOTSTRAP resolution (global + flags, no per-repo layer) supplies the
				// host-only keys needed to even reach the arbiter (`workspacesDir`,
				// `identity`), exactly as `do --isolated` bootstraps them.
				const bootstrap = resolveGlobalConfig(global, doOverrides);
				const arbiterName =
					flags.arbiter ??
					resolveDefaultArbiterForCwd(cwd, global, doOverrides);
				const arbiterUrl = resolveArbiterUrlFromCheckout(
					cwd,
					arbiterName,
					identityEnv(bootstrap.identity, process.env),
				);
				if (arbiterUrl === undefined) {
					// The SAME clear "isolated against what?" error `do --isolated` gives —
					// naming `--remote <url>` as the foreign-repo alternative, NOT a
					// downstream URL-parse failure.
					console.error(
						`error: --isolated advances in a worktree off this repo's arbiter ` +
							`('${arbiterName}'), but no such arbiter remote is configured/found ` +
							`here. Run inside a participating repo (a clone with an arbiter ` +
							`remote), or use --remote <url> to target another repo.`,
					);
					process.exit(1);
				}
				// Source the arbiter's COMMITTED `.agent-runner.json` from `<arbiter>/main`
				// via the hub mirror + layer ONLY its whitelisted keys — the SAME
				// resolution `do --isolated` uses, so the gate family (autoBuild/autoSlice/
				// observationTriage/surfaceBlockers) + selectionOrder + integration resolve
				// off the arbiter exactly as the in-place advance resolves them off cwd.
				const remoteConfig = resolveRemoteRepoConfig({
					remote: arbiterUrl,
					workspacesDir: bootstrap.workspacesDir,
					global,
					flags: doOverrides,
					identity: bootstrap.identity,
					note: (message) => console.error(`>> ${message}`),
				});
				if (doNeedsAgentCmd(remoteConfig)) {
					console.error(`error: ${NO_AGENT_CMD_MESSAGE}`);
					process.exit(1);
				}
				const isoHarness = createHarness({
					harness: remoteConfig.harness,
					piBin: remoteConfig.piBin,
				});
				// The base `do` options the build/slice rungs ORCHESTRATE through the
				// INJECTED job-worktree driver (the isolated advance-tick runner wires it).
				const isoDoOptions: Omit<DoOptions, 'arg'> = {
					cwd,
					// `--watch`: stream the build agent's session live (pi harness only;
					// validated in `performDo`). Threaded through the orchestrated build rung
					// so `advance --isolated --watch` (and CI) shows the agent working.
					watch: flags.watch === true,
					arbiter: flags.arbiter ?? remoteConfig.defaultArbiter,
					identity: remoteConfig.identity,
					autoSlice: remoteConfig.autoSlice,
					integration: remoteConfig.integration,
					// EXPLICIT `--merge` override for the untrusted-origin build-propose rule.
					explicitMerge: flagMode === 'merge',
					// Per-TRANSITION SLICING override (the isolated `do --remote prd:` path).
					slicingIntegration: remoteConfig.slicingIntegration,
					// SLICE-PLACEMENT: configured default + EXPLICIT `--slices-land-in` override
					// (set only when typed, mirroring `explicitMerge`).
					slicesLandIn: remoteConfig.slicesLandIn,
					explicitSlicesLandIn: explicitSlicesLandInFromFlag(
						flags.slicesLandIn,
					),
					prepare: remoteConfig.prepare,
					verify: remoteConfig.verify,
					// Single-job build path: gate the REBASED tip (the default) unconditionally.
					freshWorktreeGate: remoteConfig.freshWorktreeGate,
					noPR: remoteConfig.noPR,
					harness: isoHarness,
					agentCmd: remoteConfig.agentCmd,
					model: remoteConfig.model,
					sessionsDir: remoteConfig.sessionsDir,
					review: remoteConfig.review,
					reviewModel: remoteConfig.reviewModel,
					reviewMaxRounds: remoteConfig.reviewMaxRounds,
					reviewGate: remoteConfig.review
						? harnessReviewGate({
								harness: isoHarness,
								agentCmd: remoteConfig.agentCmd,
							})
						: undefined,
					reviewLoop: remoteConfig.slicerLoop
						? harnessSliceReviewGate({
								harness: isoHarness,
								agentCmd: remoteConfig.agentCmd,
							})
						: undefined,
					slicerLoopMax: remoteConfig.slicerLoopMax,
					slicerLoopModel: remoteConfig.slicerLoopModel,
					sliceReviewGate: remoteConfig.review
						? harnessSliceAcceptanceGate({
								harness: isoHarness,
								agentCmd: remoteConfig.agentCmd,
							})
						: undefined,
					color: shouldUseColor(process.stdout),
					note: (message) => console.error(`>> ${message}`),
					noteBlock: (message) => console.error(message),
				};
				// The shared per-item ISOLATED advance CONTEXT (everything BUT `arg` and
				// `cwd`/`doDriver`, which the runner supplies from the isolated clone).
				const isoContext: IsolatedAdvanceContext & {
					env: NodeJS.ProcessEnv;
				} = {
					remote: arbiterUrl,
					workspacesDir: remoteConfig.workspacesDir,
					arbiter: flags.arbiter ?? remoteConfig.defaultArbiter,
					doOptions: isoDoOptions,
					surfaceGate: harnessSurfaceGate({
						harness: isoHarness,
						agentCmd: remoteConfig.agentCmd,
					}),
					surfaceModel: remoteConfig.model,
					observationTriage: remoteConfig.observationTriage,
					triageGate: harnessTriageGate({
						harness: isoHarness,
						agentCmd: remoteConfig.agentCmd,
					}),
					triageModel: remoteConfig.model,
					note: (message) => console.error(`>> ${message}`),
					env: process.env,
				};

				// DISPATCH the variadic grammar, ISOLATED + SEQUENTIAL (mirrors
				// `do --isolated`): zero args / `-n` -> AUTO-PICK over the mirror-side
				// eligible-pool scan; many named -> those in sequence; one named -> the
				// single isolated tick. `-n` stays ALWAYS SEQUENTIAL (US #25).
				if (args.length === 0 || count !== undefined) {
					const multi = await performAdvanceIsolatedAuto({
						...isoContext,
						config: remoteConfig,
						count,
						warn: (message) => console.error(`>> ${message}`),
						lifecycleGates: {
							triage: remoteConfig.observationTriage !== 'off',
							surface: remoteConfig.surfaceBlockers,
						},
					});
					console.error(`>> ${multi.message}`);
					process.exit(multi.exitCode);
				}
				if (args.length > 1) {
					const multi = await performAdvanceIsolatedArgs(args, {
						...isoContext,
						config: remoteConfig,
					});
					console.error(`>> ${multi.message}`);
					process.exit(multi.exitCode);
				}
				// Exactly one named item: the single ISOLATED advance tick.
				const result = await performAdvanceIsolated({
					...isoContext,
					arg: args[0],
				});
				if (result.exitCode !== 0) {
					console.error(`error: ${result.message}`);
				}
				process.exit(result.exitCode);
			}

			const resolved = resolveRepoConfig({
				repoPath: cwd,
				global,
				flags: doOverrides,
			});
			if (resolved.message) {
				console.error(`>> ${resolved.message}`);
			}
			const config = resolved.config;
			const harness = createHarness({
				harness: config.harness,
				piBin: config.piBin,
			});
			// The base `do` options the build/slice rungs ORCHESTRATE `performDo` with
			// (the ONE build path / ONE slice path). `advance` is a driver ON TOP — it
			// hands the resolved arg to `performDo`, never re-implementing it.
			const doOptions: Omit<DoOptions, 'arg'> = {
				cwd,
				// `--watch`: stream the build agent's session live (pi harness only;
				// validated in `performDo`). Threaded through the orchestrated build rung
				// so `advance --watch` (and CI) shows the agent working, not a frozen log.
				watch: flags.watch === true,
				arbiter: flags.arbiter ?? config.defaultArbiter,
				identity: config.identity,
				autoSlice: config.autoSlice,
				integration: config.integration,
				// EXPLICIT `--merge` override for the untrusted-origin build-propose rule (a
				// bare `advance` auto-pick passes no flag ⇒ unset ⇒ untrusted forces propose).
				explicitMerge: flagMode === 'merge',
				// Per-TRANSITION SLICING override (the `do prd:` slicing path threads
				// `slicingIntegration ?? integration`; the build path stays on `integration`).
				slicingIntegration: config.slicingIntegration,
				// SLICE-PLACEMENT: configured default + EXPLICIT `--slices-land-in` override
				// (set only when typed, mirroring `explicitMerge`).
				slicesLandIn: config.slicesLandIn,
				explicitSlicesLandIn: explicitSlicesLandInFromFlag(flags.slicesLandIn),
				prepare: config.prepare,
				verify: config.verify,
				// Single-job build path: gate the REBASED tip (the default) unconditionally.
				freshWorktreeGate: config.freshWorktreeGate,
				noPR: config.noPR,
				harness,
				agentCmd: config.agentCmd,
				model: config.model,
				sessionsDir: config.sessionsDir,
				review: config.review,
				reviewModel: config.reviewModel,
				reviewMaxRounds: config.reviewMaxRounds,
				reviewGate: config.review
					? harnessReviewGate({harness, agentCmd: config.agentCmd})
					: undefined,
				reviewLoop: config.slicerLoop
					? harnessSliceReviewGate({harness, agentCmd: config.agentCmd})
					: undefined,
				slicerLoopMax: config.slicerLoopMax,
				slicerLoopModel: config.slicerLoopModel,
				sliceReviewGate: config.review
					? harnessSliceAcceptanceGate({harness, agentCmd: config.agentCmd})
					: undefined,
				color: shouldUseColor(process.stdout),
				note: (message) => console.error(`>> ${message}`),
				noteBlock: (message) => console.error(message),
			};
			// The shared per-item advance CONTEXT (everything BUT `arg`) — built ONCE
			// and threaded by the one-shot DRIVER to each sequential tick. The SURFACE
			// rung spawns `surface-questions` fresh-context through the SAME harness seam
			// the review gate uses (the engine then PERSISTS); the TRIAGE rung is
			// question-gated by default; `observationTriage: 'auto'` enables the
			// conservative auto-disposition exception (`ask`/`off` surface the question).
			// Surface + apply stay ALWAYS allowed regardless of the gate family.
			const advanceContext: AdvanceContext = {
				cwd,
				arbiter: flags.arbiter ?? config.defaultArbiter,
				doOptions,
				surfaceGate: harnessSurfaceGate({harness, agentCmd: config.agentCmd}),
				surfaceModel: config.model,
				observationTriage: config.observationTriage,
				triageGate: harnessTriageGate({harness, agentCmd: config.agentCmd}),
				triageModel: config.model,
				note: (message) => console.error(`>> ${message}`),
			};

			// `--watch` tails ONE pi session, so it only fits the single-named-item form
			// (mirrors `do --watch`). The auto-pick / `-n` / multi-item forms run many
			// ticks in sequence and would tail several logs; reject rather than silently
			// stream only one. The CI propose matrix names a single item per leg, so it
			// satisfies this; the `-n` merge job must NOT pass `--watch`.
			const advanceMulti =
				args.length === 0 || count !== undefined || args.length > 1;
			if (advanceMulti && flags.watch === true) {
				console.error(
					'error: --watch streams ONE session; it does not combine with the ' +
						'auto-pick / -n / multi-item forms. Name a single item.',
				);
				process.exit(1);
			}

			// DISPATCH the variadic grammar (the one-shot SEQUENTIAL driver):
			//   zero args       -> AUTO-PICK `count` (default 1) over the eligible pool
			//                      (slices-first then PRDs-to-slice; per-action gates
			//                      respected by the SELECTION layer; ordered by selectionOrder).
			//   one named arg   -> the single-item tick (the always-allowed surface/apply
			//                      path runs regardless of the gate family).
			//   many named args -> those, IN SEQUENCE (operator's order; no pool).
			// `-n` / auto-pick / multi-arg all run the EXISTING tick per item,
			// SEQUENTIALLY (parallelism is `run` / the CI matrix, never `-n`).
			if (args.length === 0) {
				const multi: AdvanceMultiResult = await performAdvanceAuto({
					...advanceContext,
					config,
					count,
					// The SELECTION-layer gates: `observationTriage != off` enumerates the
					// observation (triage) pool into auto-pick; `surfaceBlockers` enumerates
					// the `needsAnswers`-blocked (surface) pool. `off`/`false` drops the
					// respective pool (its item is left untouched / silently blocked). The
					// two gates are orthogonal peers. The triage rung's ask-vs-auto
					// distinction is read inside the tick from `observationTriage` (threaded
					// on `advanceContext`). Apply (consume) is always-on (never gated here).
					lifecycleGates: {
						triage: config.observationTriage !== 'off',
						surface: config.surfaceBlockers,
					},
				});
				console.error(`>> ${multi.message}`);
				process.exit(multi.exitCode);
			}
			if (args.length > 1) {
				const multi: AdvanceMultiResult = await performAdvanceArgs(args, {
					...advanceContext,
					config,
				});
				console.error(`>> ${multi.message}`);
				process.exit(multi.exitCode);
			}

			// Exactly one named item: the single-item tick. Wrapped in the shared
			// in-place tree-less publish so a surfaced sidecar / `triaged:` marker /
			// applied-answer commit reaches the arbiter's `main` (the CI ephemeral-runner
			// case — the local commit would otherwise be lost). The wrapper is the SAME
			// gate the `--isolated` / loop drivers use (`TREELESS_RUNGS` + exit 0 +
			// arbiter configured); a build/slice rung integrates through the `doDriver`
			// band already, and a no-arbiter laptop checkout sits on the real `main`.
			const result = await runAdvanceTickWithTreelessPublish(
				{...advanceContext, arg: args[0]},
				performAdvance,
			);
			if (result.exitCode !== 0) {
				console.error(`error: ${result.message}`);
			}
			process.exit(result.exitCode);
		});

	program
		.command('gc')
		.helpGroup(ADVANCED_GROUP)
		.description(
			'Re-apply the provably-safe deletion predicate (ADR \u00a74) across every job worktree under workspacesDir/work/*: reap the provably-safe ones (clean tree AND branch tip reachable on the arbiter \u2014 merged or pushed) via git worktree remove (+ prune, never rm -rf), and report each RETAINED one with a reason. The catch-up for when end-of-job auto-reap did not run (runner crash/kill). --force overrides the predicate (discards un-saved work) \u2014 loud, never default.',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--workspace <dir>',
			'execution working area to sweep (default: workspacesDir / ~/.agent-runner)',
		)
		.option(
			'--force',
			'OVERRIDE the predicate: remove worktrees even with un-saved work (requires --yes; never the default)',
		)
		.option('--yes', 'confirm a destructive --force sweep non-interactively')
		.option(
			'--ledger [repoPath]',
			'SWEEP the work/ lifecycle LEDGER instead of job worktrees: REPORT (never delete) every slug present in more than one work/ status folder (the one-slug-one-folder belt-and-suspenders), with its folders + candidate canonical folder, for a HUMAN to resolve. Defaults to the cwd repo.',
		)
		.option(
			'--reap-stale-locks',
			'(with --ledger) OPT-IN: also CLEAR every STALE terminal lock the report finds (a held `active` per-item lock whose item is already TERMINAL on <arbiter>/main — the `cleared-stale` class) via the SAME leased delete `release-lock` uses, so one command sweeps all orphaned terminal locks instead of N hand-run release-locks. SCOPED to `cleared-stale` ONLY: a `kept-stuck` (terminal + stuck) or a `kept-in-flight` (active, non-terminal) lock is NEVER reaped, even with this flag. A concurrent change to a lock ref makes its leased delete REJECT (reported), never --force. WITHOUT this flag `gc --ledger` stays report-only (fail-loud, deletes nothing).',
		)
		.option(
			'--remote-branches',
			'SWEEP the arbiter’s remote work/* BRANCHES instead of job worktrees: delete (via git push --delete, NEVER --force) exactly those PROVABLY MERGED into <arbiter>/main (git merge-base --is-ancestor, the SAME predicate the worktree reaper uses), and RETAIN the rest with a reason. An in-flight/un-merged branch (the recovery point) is NEVER touched. Provider-agnostic plain git — works on a --bare arbiter. The merged-only complement of `requeue --reset`.',
		)
		.option(
			'--arbiter <remote>',
			'(with --remote-branches) the arbiter git remote whose work/* branches to sweep (default: origin); resolved from --cwd',
		)
		.option(
			'--cwd <dir>',
			'(with --remote-branches) the local repo/clone whose --arbiter remote points at the arbiter to sweep (default: cwd); only remote refs are read + deleted, never the working tree',
		)
		.option(
			'--dry-run',
			'(with --remote-branches) REPORT which merged branches WOULD be reaped without deleting anything (a read-only preview)',
		)
		.option('--json', 'output the raw result as JSON')
		.action(async (flags: GcFlags) => {
			const config = resolveGlobalConfig(loadConfig(flags.config), {});
			const workspacesDir = flags.workspace ?? config.workspacesDir;

			// The `gc`-STYLE ledger SWEEP (PRD `ledger-integrity` story 3): a SEPARATE
			// surface from the worktree reaper below — it REPORTS one-slug-one-folder
			// violations in a repo's `work/` lifecycle ledger and NEVER deletes (a human
			// resolves each). Distinct `work/`: the ledger, not the execution substrate.
			if (flags.ledger !== undefined) {
				const repoPath =
					typeof flags.ledger === 'string' ? flags.ledger : process.cwd();
				const result = sweepLedgerDuplicates(repoPath);
				// The UNIFIED-LOCK stuck/orphaned-lock REPORT (slice
				// `release-lock-verb-and-gc-stuck-report`, PRD
				// `ledger-status-per-item-lock-refs` US #12/#13/#14): generalises the
				// advancing-marker report from advancing-only to the unified per-item
				// lock. The locks live on the ARBITER ref (`refs/agent-runner/lock/*`),
				// not in the local tree, so this reads the arbiter (cwd's `--arbiter`
				// remote). Best-effort: an absent lock-ref namespace / unreachable arbiter
				// degrades to an EMPTY report ("all locks released" — recoverable, US #12),
				// exactly as an absent lock-ref namespace reads. It REPORTS only,
				// wiring `reconcileItemLockAgainstMain`'s read-only twin to DISTINGUISH a
				// held/stuck lock from a stale-active lock over a terminal item WITHOUT
				// clearing (no auto-sweep; a human asserts a lock is dead via
				// `release-lock`).
				// OPT-IN SWEEP (`--reap-stale-locks`): the WRITE twin of the report. A
				// human asserting "clear the dead TERMINAL locks now": for EXACTLY the
				// `cleared-stale` class (terminal-on-main + active = stranded) perform the
				// SAME leased delete `release-lock` / the recovery use, so one command
				// sweeps every orphaned terminal lock. A `kept-stuck` / `kept-in-flight`
				// lock is NEVER reaped (scope fence); a concurrent change makes a clear
				// REJECT (reported `lost`), never --force. WITHOUT the flag the surface
				// below stays report-only (fail-loud, deletes nothing).
				if (flags.reapStaleLocks) {
					const reap = await reapStaleItemLocks(
						flags.cwd ?? repoPath,
						flags.arbiter ?? 'origin',
						process.env,
					);
					if (flags.json) {
						console.log(JSON.stringify({...result, reap}, null, 2));
					} else {
						const reapLines = formatReapReport(reap);
						const blocks: string[] = [];
						if (result.duplicates.length > 0) {
							blocks.push(formatLedgerSweep(result));
						}
						if (reapLines.length > 0) {
							blocks.push(reapLines.join('\n'));
						}
						console.log(
							blocks.length > 0
								? blocks.join('\n\n')
								: formatLedgerSweep(result),
						);
					}
					// Fail-loud AFTER the sweep: a `kept-stuck` (rightly left for a human) or
					// a `lost`/`error` (a stale lock whose leased delete lost the race) still
					// needs attention; a clean sweep that reaped every stale lock and left
					// only healthy in-flight holds exits 0.
					process.exit(
						result.duplicates.length > 0 || reapReportNeedsAttention(reap)
							? 1
							: 0,
					);
				}
				const lockReport = await reportItemLocks(
					flags.cwd ?? repoPath,
					flags.arbiter ?? 'origin',
					process.env,
				);
				if (flags.json) {
					console.log(JSON.stringify({...result, lockReport}, null, 2));
				} else {
					const lockLines = formatItemLockReport(lockReport);
					if (result.duplicates.length === 0 && lockLines.length === 0) {
						console.log(formatLedgerSweep(result));
					} else {
						const blocks: string[] = [];
						const sweepText = formatLedgerSweep(result);
						// Only print the duplicate block when it found something (otherwise
						// it returns the "clean" line, which is misleading when there ARE
						// lingering locks below it).
						if (result.duplicates.length > 0) {
							blocks.push(sweepText);
						}
						if (lockLines.length > 0) {
							blocks.push(lockLines.join('\n'));
						}
						console.log(blocks.join('\n\n'));
					}
				}
				// A corrupt ledger, a stuck advancing-lock marker, OR a per-item lock that
				// NEEDS HUMAN ATTENTION is a fail-loud condition: exit non-zero so a human
				// (or a script) cannot miss it, mirroring the integration core's refusal.
				// ALL are REPORTED here (never auto-deleted — no automatic sweep exists; a
				// human clears a NAMED unified lock via `release-lock`).
				//
				// SCOPED to the ATTENTION verdicts only (PRD US#14/#21, ADR
				// `ledger-status-on-per-item-lock-refs`: this surface is the STUCK /
				// crash-orphaned lock, NOT every held one): a `kept-stuck` (terminal +
				// stuck) or a `cleared-stale`-eligible (terminal + stale active = orphaned)
				// lock fails loud, but a `kept-in-flight` (active, non-terminal) lock is the
				// NORMAL in-flight state of a healthy concurrent build (read by `status` as
				// healthy) — it is reported informationally and does NOT make a routine
				// `gc --ledger` health check exit non-zero.
				process.exit(
					result.duplicates.length > 0 ||
						itemLockReportNeedsAttention(lockReport)
						? 1
						: 0,
				);
			}

			// The REMOTE merged-BRANCH sweep (this slice): a SEPARATE surface from the
			// worktree reaper below — it deletes PROVABLY-MERGED remote `work/*` branches
			// on the arbiter (the cross-machine counterpart of reaping local worktrees),
			// guarded by the SAME ancestor-of-main predicate. Provider-agnostic plain git
			// (works on a `--bare` arbiter); NEVER `--force` (a merged ref needs none),
			// NEVER touches an in-flight branch.
			if (flags.remoteBranches) {
				const sweep = sweepRemoteMergedBranches({
					cwd: flags.cwd ?? process.cwd(),
					arbiter: flags.arbiter ?? 'origin',
					dryRun: flags.dryRun === true,
					note: (message) => console.error(`>> ${message}`),
				});
				if (flags.json) {
					console.log(JSON.stringify(sweep, null, 2));
					return;
				}
				if (flags.dryRun === true) {
					for (const w of sweep.wouldReap) {
						console.log(`  [would-reap] ${w.branch} \u2014 merged`);
					}
				} else {
					for (const r of sweep.reaped) {
						console.log(`  [reaped]   ${r.branch} \u2014 merged`);
					}
				}
				for (const ret of sweep.retained) {
					console.log(`  [retained] ${ret.branch} \u2014 ${ret.reasonText}`);
				}
				const reapedCount =
					flags.dryRun === true ? sweep.wouldReap.length : sweep.reaped.length;
				const verb = flags.dryRun === true ? 'would reap' : 'reaped';
				console.log(
					`Summary: ${reapedCount} ${verb}, ${sweep.retained.length} retained.`,
				);
				return;
			}

			// `--force` discards un-saved work, so it is gated behind an explicit
			// confirmation (`--yes`) — loud + intentional, NEVER the default (ADR §4).
			if (flags.force && !flags.yes) {
				console.error(
					'refusing to --force without --yes: this DISCARDS un-saved work in ' +
						'retained worktrees (commits not on the arbiter, dirty trees). ' +
						'Re-run with `gc --force --yes` to confirm.',
				);
				process.exit(1);
			}
			if (flags.force) {
				console.error(
					'>> --force: OVERRIDING the deletion-safety predicate; un-saved work ' +
						'in retained worktrees will be DISCARDED.',
				);
			}

			const result = gc({
				workspacesDir,
				force: flags.force === true,
				note: (message) => console.error(`>> ${message}`),
			});

			if (flags.json) {
				console.log(JSON.stringify(result, null, 2));
				return;
			}
			for (const reaped of result.reaped) {
				const how = reaped.forced
					? 'FORCED (discarded un-saved work)'
					: (reaped.verdict.reachableVia ?? 'safe');
				console.log(`  [reaped]   ${reaped.slug} \u2014 ${how}`);
			}
			for (const retained of result.retained) {
				console.log(
					`  [retained] ${retained.slug} \u2014 ${RETAIN_REASON_TEXT[retained.reason]}`,
				);
			}
			console.log(
				`Summary: ${result.reaped.length} reaped, ${result.retained.length} retained.`,
			);
		});

	program
		.command('status')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'Read-only operational dashboard of JOBS (distinct from scan’s backlog queue): list every job under workspacesDir/work/* from its .agent-runner-job.json record + worktree state, grouped active (running + alive) vs failed/retained (needs-attention with its reason, a crashed running-but-dead job, or a done-but-un-reaped one). Liveness comes from the harness seam (PID/session), NOT mtime. Never claims/runs/moves/deletes (deletion is gc).',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--workspace <dir>',
			'execution working area to inspect (default: workspacesDir / ~/.agent-runner)',
		)
		.option(
			'--arbiter-remote <name>',
			`the current repo's arbiter remote to report on (folds in the old \`arbiter status\`; default: ${DEFAULT_ARBITER_REMOTE})`,
		)
		.option('--no-arbiter', "skip the current repo's arbiter section")
		.option(
			'--no-cwd',
			'skip the cwd-local section (report only the jobs + registry view)',
		)
		.option('--json', 'output the raw report as JSON')
		.action(async (flags: StatusFlags) => {
			const config = resolveGlobalConfig(loadConfig(flags.config), {});
			const workspacesDir = flags.workspace ?? config.workspacesDir;
			const warn = (message: string) => console.error(`>> ${message}`);
			// Surface the folder-native needs-attention set (ADR §12) from each
			// REGISTERED HUB MIRROR (the registry), read from its bare `main` ref
			// through the read seam (mirrors have no working tree).
			const mirrorPaths = listMirrors({workspacesDir}).map((m) => m.path);
			// Fold in the current repo's arbiter state (the old `arbiter status`, ADR
			// §1/§7) unless --no-arbiter. Read-only; tolerates not being in a repo.
			const arbiter =
				flags.noArbiter === true
					? undefined
					: arbiterStatus({
							cwd: process.cwd(),
							remote: flags.arbiterRemote ?? DEFAULT_ARBITER_REMOTE,
						});
			// The cwd-local section (the `scan-status-read-cwd-repo` slice): when run
			// INSIDE a participating repo, ALSO report it as a separately-counted local
			// block (fetch-its-arbiter-first), distinct from the registry/job view.
			const cwdSection =
				flags.cwd === false
					? undefined
					: await resolveCwdSection({
							cwd: process.cwd(),
							config,
							arbiterRemote: flags.arbiterRemote ?? DEFAULT_ARBITER_REMOTE,
							warn,
						});
			const report = await status({
				workspacesDir,
				mirrorPaths,
				arbiter,
				cwd: cwdSection,
				warn,
			});
			if (flags.json) {
				console.log(JSON.stringify(report, null, 2));
			} else {
				console.log(formatStatus(report));
			}
		});

	program
		.command('requeue <slug>')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'Requeue a STUCK slice to the backlog for re-claiming (ADR §12/§14). Recovers a slice stuck in EITHER work/needs-attention/<slug>.md (a resolved surface) OR work/in-progress/<slug>.md (a claim that never surfaced — an un-surfaced abort, a killed run, or an in-place requeue note): the slug’s ACTUAL current folder is resolved on the arbiter and moved to work/backlog/<slug>.md. The move is published as a TREE-LESS compare-and-swap to the arbiter ref, EXACTLY like claim — it NEVER stages or commits in the cwd working tree, so a requeue in a shared checkout can never sweep up a concurrent writer’s uncommitted files. DEFAULT = keep + continue: leave the work/<slug> branch UNTOUCHED so the next claim CONTINUES from its tip (rebased onto fresh main at onboard-time). --reset = discard + fresh: delete the remote work/<slug> branch FIRST (then the move) so the next claim starts fresh (guarded; never the default). -m/--message appends a dated handoff note to the item body (both modes; append-only). Any recorded reason stays in the body as a durable note.',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--cwd <dir>',
			'the repo/working clone whose work/ tree the arbiter remote is resolved FROM (default: cwd) — an ORIGIN SOURCE only; the move is published to the arbiter, never to this tree',
		)
		.option(
			'--arbiter <remote>',
			'the arbiter git remote the tree-less move is CAS-published to (default: origin). --cwd resolves this remote; the move is never written to the cwd tree.',
		)
		.option(
			'--reset',
			'DISCARD the kept work: delete the remote work/<slug> branch FIRST, then move to backlog so the next claim starts FRESH (guarded; a deliberate departure from the never-delete-the-remote-branch invariant). Never the default.',
		)
		.option(
			'-m, --message <note>',
			'append a dated handoff note to the item body for the next agent (append-only; applies to both default and --reset)',
		)
		.action(async (rawSlug: string, flags: RequeueFlags) => {
			// Slice-only command (§3a): accept bare + `slice:`, reject `prd:`.
			const slug = resolveSliceOnlySlug(rawSlug) as string;
			const cwd = flags.cwd ?? process.cwd();
			// Route the requeue (default keep+continue / --reset discard / -m handoff)
			// THROUGH the ledger write seam's transition (same seam the needs-attention
			// move uses), not the helper.
			//
			// `requeue` is a HUMAN command (like `complete`): the human is putting a
			// resolved item back, so the move/commit/push is THEIRS — it is NOT given
			// the runner identity (`config.identity`). The autonomous re-attempt is
			// `do` (which IS identity-aware), not this. We thread the ambient
			// `process.env` EXPLICITLY so the human-identity choice is visible at the
			// call site, rather than relying on the seam's silent `?? process.env`
			// default by omission (the implicit fallback that made `requeue`'s human
			// attribution accidental rather than declared).
			const result = await ledgerWrite.applyReturnToBacklogTransition({
				cwd,
				slug,
				// Tree-less CAS needs a ref to push to (parity with `claim`): default the
				// arbiter to `origin` so the common case Just Works; `--arbiter` overrides.
				// `--cwd` is purely the ORIGIN SOURCE the remote is resolved from.
				arbiter: flags.arbiter ?? 'origin',
				reset: flags.reset,
				message: flags.message,
				env: process.env,
				note: (message) => console.error(`>> ${message}`),
			});
			if (!result.moved) {
				console.error(`error: ${result.reasonNotMoved}`);
				process.exit(1);
			}
			const how = result.deletedRemoteBranch
				? ` (--reset: deleted the remote ${workBranchRef('task', slug)} branch; next claim starts fresh)`
				: ' (kept the work branch; next claim continues from its tip)';
			console.log(`Requeued '${slug}' to backlog for re-claiming.${how}`);
		});

	// `promote [item]` (PRD `staging-pool-position-gate-and-trust-model`, slices
	// `pre-backlog-staging-folder-and-promote-step-a` /
	// `pre-prd-staging-pool-split-and-untrusted-prd-placement`): the HUMAN/runner-
	// owned verb that moves a STAGED item into its agent-eligible POOL — a slice
	// `work/pre-backlog/<slug>.md → work/backlog/<slug>.md`, a PRD
	// `work/pre-prd/<slug>.md → work/prd/<slug>.md` — as a tree-less CAS on the
	// arbiter, the SAME trust model + mechanism as `requeue`. The agent emits STAGED;
	// only this verb (a human, or the runner) admits it to the pool. With NO argument
	// it LISTS what is promotable (the "what is staged waiting for me?" discovery), so
	// a human need not remember the staged slugs.
	program
		.command('promote [item]')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'Admit a STAGED item into its agent-eligible POOL (the runner/human side of the staging gate): a slice `work/pre-backlog/<slug>.md → work/backlog/<slug>.md`, a PRD `work/pre-prd/<slug>.md → work/prd/<slug>.md`, published as a TREE-LESS compare-and-swap to the arbiter ref (EXACTLY like requeue/claim — it never stages/commits in the cwd tree). The agent only ever CREATES staged; this verb is the gate a human (or the runner) opens. Accepts `task:<slug>` / `brief:<slug>` / a bare `<slug>` (= task). With NO argument, LISTS every promotable item (the slices in pre-backlog/ + the PRDs in pre-prd/ on the arbiter) so you can see what is staged waiting for promotion. Idempotent: promoting an already-pooled slug is a clean no-op success.',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--cwd <dir>',
			'the repo/working clone whose arbiter remote the tree-less move is resolved FROM (default: cwd) — an ORIGIN SOURCE only; the move is published to the arbiter, never to this tree',
		)
		.option(
			'--arbiter <remote>',
			'the arbiter git remote the promotion is CAS-published to / the staging folders are listed from (default: origin)',
		)
		.action(async (rawItem: string | undefined, flags: PromoteFlags) => {
			const cwd = flags.cwd ?? process.cwd();
			const arbiter = flags.arbiter ?? 'origin';
			// `promote` is a HUMAN command (like `requeue`): the move/commit/push is
			// THEIRS — NOT the runner identity. Thread the ambient env explicitly.
			const env = process.env;
			const note = (message: string) => console.error(`>> ${message}`);

			// NO ARGUMENT → LIST what is promotable (read-only discovery).
			if (rawItem === undefined) {
				const listed = await listPromotable({cwd, arbiter, env});
				if (listed.error) {
					console.error(`error: ${listed.error}`);
					process.exit(1);
				}
				if (listed.items.length === 0) {
					console.log(
						`Nothing staged to promote on ${arbiter}/main (work/pre-backlog/ and work/pre-prd/ are empty).`,
					);
					return;
				}
				console.log('Staged, awaiting promotion (run `promote <item>`):');
				for (const item of listed.items) {
					console.log(`  ${item.namespace}:${item.slug}`);
				}
				return;
			}

			// AN ITEM → promote it. `slice:`/`prd:` are explicit; a bare slug defaults to
			// a slice (mirrors `requeue`). An `obs:`/`observation:` prefix is rejected
			// (observations have no pool).
			const parsed = parseSlugArg(rawItem);
			if (parsed.explicit === 'observation') {
				console.error(
					`error: promote takes a task or brief, not an observation ('${rawItem}'). Observations have no agent pool.`,
				);
				process.exit(1);
			}
			const namespace = parsed.explicit === 'brief' ? 'brief' : 'task';
			const slug = parsed.slug;
			const result =
				namespace === 'brief'
					? await promoteFromPrePrd({cwd, slug, arbiter, env, note})
					: await promoteFromPreBacklog({cwd, slug, arbiter, env, note});
			if (!result.moved) {
				console.error(`error: ${result.reasonNotMoved}`);
				process.exit(1);
			}
			const dest =
				namespace === 'brief'
					? workFolderPrefix('briefs-ready')
					: workFolderPrefix('tasks-todo');
			console.log(
				`Promoted ${namespace} '${slug}' into the pool (${dest}); it is now ${
					namespace === 'brief' ? 'auto-sliceable' : 'claimable'
				}.`,
			);
		});

	// NOTE: the legacy `release-advancing <item>` verb is RETIRED by the capstone
	// cut-over (slice `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`):
	// the `work/advancing/<entry>.md` marker is gone and an advance hold is now just
	// `action: advance` on the UNIFIED per-item lock, so `release-lock <item>` (below)
	// is the SOLE named human release for ALL holds (implement/slice/advance).

	// `release-lock <item>` (slice `release-lock-verb-and-gc-stuck-report`, PRD
	// `ledger-status-per-item-lock-refs` US #14): the HUMAN-invoked named release of
	// a stuck/orphaned UNIFIED per-item lock (`refs/agent-runner/lock/<entry>`) —
	// the GENERALISATION of `release-advancing` from the advancing-only marker to
	// the one lock per item (implement/slice/advance × active/stuck). Same trust
	// model as `release-advancing` / `requeue`: a HUMAN asserts the lock is dead by
	// NAMING it; the tool never guesses liveness (there is NO heartbeat, NO
	// auto-sweep — the `gc --ledger` report only REPORTS lingering locks). Routes
	// through the existing leased-delete `releaseItemLock` (deleting the ref IS the
	// release; the parentless lock commit becomes gc-reclaimable). NEVER `--force`.
	// Idempotent: deleting an absent ref is a clean exit-0 "nothing to clear"
	// (`not-held`), NOT a failure — deleting the lock ref(s) is "all locks released"
	// and recoverable (the work is safe on the `work/<slug>` branches + `main`).
	program
		.command('release-lock <item>')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'Clear a NAMED stuck/orphaned UNIFIED per-item lock (refs/agent-runner/lock/<entry>) by DELETING the ref on the arbiter — the recovery verb for a lock the system orphaned (a crashed build/slice/advance that left the hold behind). The generalisation of `release-advancing` from the advancing marker to the ONE lock per item. Same trust model as `requeue`: a HUMAN asserts the lock is dead by NAMING it; the tool never guesses liveness (the lock has NO heartbeat, so there is NO automatic sweep / age-based reaper anywhere). Accepts the same item forms as the lock API: `task:<slug>` / `brief:<slug>` / `obs:<slug>` / a bare `<slug>` (= task). Idempotent — re-running on an already-cleared lock is a clean exit-0 no-op (deleting the lock ref is “all locks released”, recoverable). NEVER `--force`. Discoverable via `gc --ledger` (it REPORTS every lingering lock, never deletes).',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--cwd <dir>',
			'the repo/working clone whose arbiter remote the lock ref is DELETED on (default: cwd)',
		)
		.option(
			'--arbiter <remote>',
			'the arbiter git remote the lock ref is deleted on (default: origin)',
		)
		.action(async (item: string, flags: ReleaseLockFlags) => {
			const cwd = flags.cwd ?? process.cwd();
			const arbiter = flags.arbiter ?? 'origin';
			const result = await releaseItemLock({
				item,
				cwd,
				arbiter,
				env: process.env,
			});
			if (result.outcome === 'released') {
				console.log(
					`Released lock '${result.entry}' (${result.ref} deleted on ${arbiter}; the item itself was untouched — it rests on main / its work/<slug> branch).`,
				);
				return;
			}
			// IDEMPOTENT exit semantics: `releaseItemLock` returns `not-held` when the
			// ref is ALREADY absent. For a HUMAN re-running the verb on an
			// already-cleared lock that is the CORRECT "nothing to clear" outcome —
			// deleting the lock ref(s) is "all locks released" and recoverable — so map
			// it to a clean exit-0 with an honest message (NOT a failure).
			if (result.outcome === 'not-held') {
				console.log(
					`No lock to release for '${result.entry}' (${result.ref} is already absent on ${arbiter} — “all locks released”, recoverable).`,
				);
				return;
			}
			console.error(`error: ${result.message}`);
			process.exit(1);
		});

	program
		.command('intake')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'Front-of-funnel: turn a GitHub issue into the right work/ artifact. Reads issue #N + its comment thread via the issue seam (gh), runs a prompt→verdict decision, and dispatches it: a clear, small issue → a proposed work/backlog/<slug>.md PR carrying an `issue: N` closure link (read by a future CI close-job; not `Fixes #N`). GATE-FREE — your explicit invocation IS the authorization (autoSlice/autoBuild do NOT apply), exactly as `do`. A LOCAL one-shot AND the SAME command CI schedules. PER-OUTCOME integration modes (the artifact TYPE is decided at runtime): --merge/--propose set BOTH; --merge-prd/--propose-prd and --merge-slice/--propose-slice override per type; granular overrides the aggregate; unset ⇒ propose for both.',
		)
		.argument(
			'<number>',
			'the GitHub issue number to intake (e.g. `intake 42`)',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--arbiter <remote>',
			'name of the arbiter git remote (default: per-repo/global defaultArbiter)',
		)
		.option(
			'--merge',
			'integrate BOTH outcomes (slice AND PRD) in merge mode (aggregate; overridden per type by --merge-*/--propose-*; mutually exclusive with --propose)',
		)
		.option(
			'--propose',
			'integrate BOTH outcomes (slice AND PRD) in propose mode (aggregate; default; overridden per type; mutually exclusive with --merge)',
		)
		.option(
			'--no-pr',
			'propose without opening a PR for intake emissions: push the branch but deliberately skip the review request (the explicit suppress-PR intent). Resolved flag > env > per-repo > global > default off.',
		)
		.option(
			'--merge-prd',
			'integrate a PRD outcome in merge mode (granular; overrides --merge/--propose for a PRD; mutually exclusive with --propose-prd)',
		)
		.option(
			'--propose-prd',
			'integrate a PRD outcome in propose mode (granular; overrides --merge/--propose for a PRD; mutually exclusive with --merge-prd)',
		)
		.option(
			'--merge-slice',
			'integrate a slice outcome in merge mode (granular; overrides --merge/--propose for a slice; mutually exclusive with --propose-slice)',
		)
		.option(
			'--propose-slice',
			'integrate a slice outcome in propose mode (granular; overrides --merge/--propose for a slice; mutually exclusive with --merge-slice)',
		)
		.option(
			'--origin-trust <trusted|untrusted>',
			"the author-trust verdict to STAMP onto the emitted PRD/slice (origin: issue + originTrust: <value>), so an untrusted origin survives the merge boundary and later forces the slice's BUILD transition to propose. CI's intake.yml derives it from the SAME author_association case as the integration flags. UNSET (a local intake) ⇒ emitted unstamped (human/trusted) — the human running intake IS the checkpoint.",
		)
		.option(
			'--prds-land-in <where>',
			'where an intake-authored PRD lands: `pre-prd` (staged, not auto-sliceable) or `prd` (the auto-slice pool). The EXPLICIT operator override at the top of the placement precedence (explicit flag > untrusted-origin forces staging > prdsLandIn default > built-in). Resolved flag > env (AGENT_RUNNER_PRDS_LAND_IN) > per-repo > global > built-in.',
		)
		.option('--agent-cmd <cmd>', 'command to run the decision agent')
		.option(
			'--model <id>',
			'model the decision agent runs on (routing intent; resolved flag > env > per-repo > global > default)',
		)
		.option(
			'--harness <adapter>',
			'harness adapter that launches the decision agent: null (default) or pi',
		)
		.option(
			'--pi-bin <path>',
			'pi CLI binary the pi harness invokes (default: pi on PATH)',
		)
		.option(
			'--sessions-dir <dir>',
			'HOST-ONLY root folder under which the pi session file is generated',
		)
		.action(async (rawNumber: string, flags: IntakeFlags) => {
			const issueNumber = Number(rawNumber);
			if (
				rawNumber.trim() === '' ||
				!Number.isInteger(issueNumber) ||
				issueNumber < 1
			) {
				console.error(
					`error: intake takes a positive issue NUMBER (got '${rawNumber}').`,
				);
				process.exit(1);
			}
			const cwd = process.cwd();
			const global = loadConfig(flags.config);
			const resolved = resolveRepoConfig({
				repoPath: cwd,
				global,
				flags: {
					...harnessFlagOverrides(flags),
					// `--no-pr` (the PR-INTENT axis) rides the SAME chain.
					...noPRFlagOverrides(flags),
				},
			});
			if (resolved.message) {
				console.error(`>> ${resolved.message}`);
			}
			const config = resolved.config;
			// Resolve the PER-OUTCOME integration modes (PRD US #9): `intake` decides
			// the artifact TYPE at runtime, so a single --merge/--propose can't express
			// a type-conditional policy. The granular flags override the aggregate; an
			// UNSET type falls back to the per-repo/global `integration` (the SAME chain
			// `do`/`complete` use — flag > per-repo > global > default propose). `intake`
			// is GATE-FREE, so autoSlice/autoBuild are NOT consulted (the explicit
			// invocation is its own authorization). `intake` owns only these KNOBS; WHICH
			// knobs CI sets is CI's POLICY (`runner-in-ci`), NOT here.
			let modes;
			try {
				modes = resolveIntakeIntegrationModes(flags, config.integration);
			} catch (err) {
				console.error(
					`error: ${err instanceof Error ? err.message : String(err)}`,
				);
				process.exit(1);
			}
			// The ORIGIN-TRUST stamp (slice `untrusted-origin-forces-build-propose`):
			// the CI shell passes `--origin-trust <trusted|untrusted>`; `intake` writes
			// it onto the emitted artifact (it does NOT resolve trust — the ~L296
			// boundary). UNSET ⇒ undefined ⇒ emit unstamped (a local intake is
			// human/trusted). An INVALID value FAILS LOUDLY (an autonomy/trust signal
			// must never be quietly ignored), mirroring the observation-triage enum.
			let originTrust: 'trusted' | 'untrusted' | undefined;
			if (flags.originTrust !== undefined) {
				if (
					flags.originTrust !== 'trusted' &&
					flags.originTrust !== 'untrusted'
				) {
					console.error(
						`error: --origin-trust must be 'trusted' or 'untrusted' (got '${flags.originTrust}').`,
					);
					process.exit(1);
				}
				originTrust = flags.originTrust;
			}
			const harness = createHarness({
				harness: config.harness,
				piBin: config.piBin,
			});
			// The OPERATOR's EXPLICIT PRD-placement override (`--prds-land-in`), the TOP
			// of the placement precedence — mirrors `explicitSlicesLandInFromFlag` on
			// the `do prd:` path. Fails loudly on a bad value.
			let explicitPrdsLandIn: 'pre-prd' | 'prd' | undefined;
			try {
				explicitPrdsLandIn = explicitPrdsLandInFromFlag(flags.prdsLandIn);
			} catch (err) {
				console.error(
					`error: ${err instanceof Error ? err.message : String(err)}`,
				);
				process.exit(1);
			}
			const result = await performIntake({
				issueNumber,
				cwd,
				arbiter: flags.arbiter ?? config.defaultArbiter,
				integration: modes,
				// The origin-trust stamp the CI shell passes IN (unset ⇒ unstamped).
				originTrust,
				noPR: config.noPR,
				// PRD-PLACEMENT: the configured-default rung + the EXPLICIT
				// `--prds-land-in` override (top of the precedence). The shared placement
				// resolver in `intake.ts` overlays the untrusted-origin staging force.
				prdsLandIn: config.prdsLandIn,
				explicitPrdsLandIn,
				harness,
				agentCmd: config.agentCmd,
				model: config.model,
				sessionsDir: config.sessionsDir,
				// Host-only runner IDENTITY — scopes intake's `gh`/git ops (not the
				// decision/review AGENT launches); absent ⇒ ambient.
				identity: config.identity,
				note: (message) => console.error(`>> ${message}`),
			});
			if (result.exitCode !== 0) {
				console.error(`error: ${result.message}`);
			} else {
				console.error(`>> ${result.message}`);
			}
			process.exit(result.exitCode);
		});

	// The CI CLOSE-JOB driver (PRD `runner-in-ci`, capability E; slice
	// `install-ci-close-job-workflow`). The thin JOB the emitted close-job workflow
	// invokes on a merge to main: resolve which source issue(s) the landed work
	// closes (resolveClosingIssue), run the "PRD complete?" query for the PRD case
	// (prd-complete-query, done), and close via the IssueProvider seam — all
	// UNCHANGED engine pieces, CONSUMED not re-built (the Out-of-Scope fence). CI
	// owns ONLY the job + trigger. Local-runnable too (a manual catch-up close).
	program
		.command('close-merged-issues')
		.helpGroup(ADVANCED_GROUP)
		.description(
			'Close source issues whose work has landed on main (CI capability E, PRD runner-in-ci). Resolves each closing issue from the work/ tree (resolveClosingIssue: a lone slice closes its own `issue:`; a fanned slice/PRD reaches the number via `slice.prd: → PRD issue:`), runs the existing "PRD complete?" query for the PRD case (closes ONLY when ALL its prd:<slug> slices are in work/done/), and closes via the IssueProvider seam (atomic comment+close; NO direct gh). Re-implements NONE of the resolution/query/close — it WIRES them. Invoked by the emitted close-job workflow on a merge to main; DEGRADES (never crashes) on a missing/unauthenticated gh.',
		)
		.option(
			'--cwd <dir>',
			'the repo working dir whose work/ tree to scan (default: cwd)',
		)
		.option('--gh-bin <bin>', 'the gh CLI binary (default: gh on PATH)')
		.option('--json', 'output the raw result as JSON')
		.action(async (flags: CloseMergedIssuesFlags) => {
			const repoPath = flags.cwd ?? process.cwd();
			const result = await performCloseMergedIssues({
				repoPath,
				ghBin: flags.ghBin,
				env: process.env,
			});
			if (flags.json) {
				console.log(JSON.stringify(result, null, 2));
			} else {
				for (const c of result.candidates) {
					if (c.decision === 'closed') {
						console.error(
							`>> closed issue #${c.issueNumber} (${c.via} ${c.slug}).`,
						);
					} else if (c.decision === 'close-failed') {
						console.error(
							`>> issue #${c.issueNumber} (${c.via} ${c.slug}) NOT closed: ${c.reason}`,
						);
					} else {
						console.error(
							`>> issue #${c.issueNumber} (${c.via} ${c.slug}) left open (${c.decision}).`,
						);
					}
				}
				console.error(
					`>> close-merged-issues: closed ${result.closed.length} issue(s).`,
				);
			}
			// The close-job is a terminal CI tick: a degraded close is reported, not a
			// crash (exit 0), exactly like intake's bounce close.
			process.exit(0);
		});

	// The REGISTRY command group (ADR §1): the registered set of targets IS the
	// hub-mirror set on disk. `remote add --local` absorbs the old `arbiter init`;
	// `arbiter status` is folded into `status`. There is no standalone `arbiter`
	// command group, and no `roots`/`remotes` config field.
	const remote = program
		.command('remote')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'The registry: the registered set of targets IS the hub mirrors on disk under workspacesDir/repos/ (no roots/remotes config). add/rm/ls/find manage that set. `remote add --local` provisions a bare arbiter (absorbing `arbiter init`); `arbiter status` is folded into `status`.',
		);

	remote
		.command('add <target>')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'Register a target by creating its hub mirror (idempotent). <target> is the arbiter URL; with --local it is a WORKING REPO whose bare arbiter is provisioned under arbitersDir (~/git, precious DATA, NEVER ~/.agent-runner) and THAT arbiter is registered (absorbing `arbiter init`). The project-identity guard refuses registering one project (same projectId tail) under a second key unless --force; --force REPLACES the existing mirror but STILL refuses if a worktree of the replaced mirror holds un-pushed work (data-loss guard).',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--local',
			'provision a local --bare arbiter from <target> (a working repo) and register it (absorbs `arbiter init`)',
		)
		.option(
			'--arbiter-remote <name>',
			`name of the arbiter remote to wire in the working repo on --local (default: ${DEFAULT_ARBITER_REMOTE})`,
		)
		.option(
			'--force',
			'REPLACE this project’s existing mirror (re-link remote ↔ bare arbiter deliberately); overrides the registration POLICY block ONLY — still refuses if a worktree of the replaced mirror holds un-pushed work (the data-loss block is never overridden)',
		)
		.action((target: string, flags: RemoteAddFlags) => {
			const config = resolveGlobalConfig(loadConfig(flags.config), {});
			try {
				const result = remoteAdd({
					target,
					local: flags.local,
					workspacesDir: config.workspacesDir,
					arbitersDir: config.arbitersDir,
					arbiterRemote: flags.arbiterRemote ?? DEFAULT_ARBITER_REMOTE,
					force: flags.force,
					note: (message) => console.error(`>> ${message}`),
				});
				if (result.arbiter) {
					const a = result.arbiter;
					console.log(
						a.created
							? `Provisioned bare arbiter at ${a.path}`
							: `Arbiter already exists at ${a.path} (not clobbered)`,
					);
					console.log(`Wired remote '${a.remote}' -> ${a.url}`);
				}
				console.log(
					result.created
						? `Registered '${result.key}' (${result.transport}) — hub mirror at ${result.mirrorPath}`
						: `'${result.key}' already registered (mirror at ${result.mirrorPath})`,
				);
			} catch (err) {
				if (err instanceof RegistryError) {
					console.error(`error: ${err.message}`);
					process.exit(1);
				}
				throw err;
			}
		});

	remote
		.command('rm <target>')
		.helpGroup(ADVANCED_GROUP)
		.description(
			'Delete a hub mirror by key (host/org/name) or origin URL. The ONLY mirror deleter — `gc` NEVER reaps mirrors. Plumbing tier.',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.action((target: string, flags: RemoteRmFlags) => {
			const config = resolveGlobalConfig(loadConfig(flags.config), {});
			const result = remoteRm({target, workspacesDir: config.workspacesDir});
			if (!result.removed) {
				console.error(`error: no registered mirror matches '${target}'.`);
				process.exit(1);
			}
			console.log(`Removed mirror '${result.key}' (${result.path}).`);
		});

	remote
		.command('ls')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'List every registered hub mirror with its origin URL + transport. The origin URL is read from each mirror (the key encoding is lossy — it drops scheme/transport), so it is authoritative, not reconstructed from the key.',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option('--json', 'output the raw list as JSON')
		.action((flags: RemoteLsFlags) => {
			const config = resolveGlobalConfig(loadConfig(flags.config), {});
			const mirrors = listMirrors({workspacesDir: config.workspacesDir});
			if (flags.json) {
				console.log(JSON.stringify(mirrors, null, 2));
				return;
			}
			if (mirrors.length === 0) {
				console.log(
					'No registered mirrors. Use `remote add <url>` or `remote find <folder>`.',
				);
				return;
			}
			for (const m of mirrors) {
				console.log(
					`${m.key}   ${m.transport}   ${m.originUrl ?? '(no origin)'}`,
				);
			}
		});

	remote
		.command('find <folder>')
		.helpGroup(HEADLINE_GROUP)
		.description(
			'Discover work/-participating repos under <folder> (a populated work/backlog/), then toggle-add the chosen ones via `remote add`. Interactive multi-select by default; --yes adds ALL discovered repos non-interactively.',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option('--yes', 'add all discovered participating repos (no prompt)')
		.action(async (folder: string, flags: RemoteFindFlags) => {
			const config = resolveGlobalConfig(loadConfig(flags.config), {});
			const repos = findParticipatingRepos(folder);
			if (repos.length === 0) {
				console.log(`No work/-participating repos found under ${folder}.`);
				return;
			}
			const chosen = flags.yes ? repos : await promptMultiSelect(repos);
			if (chosen.length === 0) {
				console.log('Nothing selected; no mirrors added.');
				return;
			}
			for (const repoPath of chosen) {
				// Each discovered repo is registered as a LOCAL bare arbiter (it is a
				// working checkout on disk, not a remote URL) — the same path
				// `remote add --local` takes. The transport guard still applies.
				try {
					const result = remoteAdd({
						target: repoPath,
						local: true,
						workspacesDir: config.workspacesDir,
						arbitersDir: config.arbitersDir,
						arbiterRemote: DEFAULT_ARBITER_REMOTE,
						note: (message) => console.error(`>> ${message}`),
					});
					console.log(
						`${result.created ? 'Registered' : 'Already registered'} '${result.key}' (${repoPath}).`,
					);
				} catch (err) {
					if (err instanceof RegistryError) {
						console.error(`skipped ${repoPath}: ${err.message}`);
						continue;
					}
					throw err;
				}
			}
		});

	program
		.command('install-ci')
		.helpGroup(ADVANCED_GROUP)
		.description(
			'Scaffold the CI auth/setup foundation (a one-time, human-run SCAFFOLDER): write the shared composite setup action (`agent-runner-setup`) + provider auth (models.json default, or auth.json + GH_PAT + OAuth refresh) and set the provider secrets via the GitHub seam. Interactive wizard, or `--config <file>` for a non-interactive reproduction; `--export-config` round-trips the config; `--fake` writes to `.fake/` (never `.github/`) and sets NO real secret (a snapshot dry-run).',
		)
		.option(
			'--config <file>',
			'non-interactive: load the CI config from this JSON file (skips the wizard)',
		)
		.option(
			'--export-config <file>',
			'write the gathered config as JSON to this path instead of generating artifacts',
		)
		.option(
			'--include-secrets',
			'(with --export-config) also gather + include the secret values in the export',
		)
		.option(
			'--fake',
			'snapshot mode: write artifacts to `.fake/` (NEVER `.github/`) and set NO real secret',
		)
		.option(
			'--repo <owner/repo>',
			'the GitHub repo to set secrets on (else auto-detected via gh)',
		)
		.option('--gh-bin <bin>', 'the gh CLI binary (default: gh on PATH)')
		.option('--cwd <dir>', 'the target repo working dir (default: cwd)')
		.option(
			'--install-source <registry|workspace>',
			'where the CI installs the CLI from: `registry` (npm install -g, the default) or `workspace` (build from the checked-out source + link onto PATH, for the self-hosting monorepo). Overrides auto-detection in both directions.',
		)
		.action(async (flags: InstallCiFlags) => {
			const workDir = flags.cwd ?? process.cwd();
			if (
				flags.installSource !== undefined &&
				flags.installSource !== 'registry' &&
				flags.installSource !== 'workspace'
			) {
				console.error(
					`install-ci: --install-source must be "registry" or "workspace" (got "${flags.installSource}")`,
				);
				process.exitCode = 1;
				return;
			}
			const ctx = new GitHubCIContext({
				workDir,
				repo: flags.repo,
				ghBin: flags.ghBin,
			});
			// Discover the registered capability emitters (the directory-of-modules
			// seam: each capability self-registers from its own file under
			// `install-ci-capabilities/`, picked up here WITHOUT a shared-list edit).
			// This core slice ships only a no-op reference (emits []); the sibling
			// capability slices add self-registering modules that flow through here
			// automatically once landed. A no-op emitter contributes nothing.
			const capabilities = await loadCapabilityRegistry();
			const prompts = flags.config ? undefined : readlinePrompts();
			await installCI({
				ctx,
				fake: flags.fake === true,
				configFile: flags.config,
				exportConfig: flags.exportConfig,
				includeSecrets: flags.includeSecrets === true,
				installSource: flags.installSource as
					| 'registry'
					| 'workspace'
					| undefined,
				prompts,
				capabilities,
				log: (line) => console.error(line),
			});
		});

	return program;
}

/**
 * A readline-backed {@link WizardPrompts} for the interactive `install-ci`
 * wizard. Prompts go to stderr (stdout is reserved for any machine output); a
 * non-TTY invocation falls back to defaults (or empty), so a piped run never
 * hangs — use `--config` for a fully non-interactive reproduction.
 */
function readlinePrompts(): WizardPrompts {
	const ask = (message: string, mask = false): Promise<string> =>
		new Promise((resolvePrompt) => {
			if (!process.stdin.isTTY) {
				resolvePrompt('');
				return;
			}
			const rl = createInterface({
				input: process.stdin,
				output: process.stderr,
			});
			void mask; // readline has no native masking; secrets are typed visibly
			rl.question(`${message} `, (answer) => {
				rl.close();
				resolvePrompt(answer);
			});
		});
	return {
		async input(message, opts) {
			const hint = opts?.default ? ` [${opts.default}]` : '';
			const answer = (await ask(`${message}${hint}`)).trim();
			return answer === '' && opts?.default ? opts.default : answer;
		},
		async password(message) {
			return (await ask(message, true)).trim();
		},
		async confirm(message, opts) {
			const hint = opts.default ? ' [Y/n]' : ' [y/N]';
			const answer = (await ask(`${message}${hint}`)).trim().toLowerCase();
			if (answer === '') return opts.default;
			return answer === 'y' || answer === 'yes';
		},
		async select(message, choices) {
			process.stderr.write(`${message}\n`);
			choices.forEach((c, i) => {
				process.stderr.write(`  [${i + 1}] ${c.name}\n`);
			});
			const answer = (await ask('Choose (number):')).trim();
			const n = Number(answer);
			if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
				return choices[n - 1].value;
			}
			return choices[0].value; // default to the first choice
		},
	};
}

/**
 * A minimal interactive multi-select toggle for `remote find`: list the
 * discovered repos numbered, let the user type the numbers to add (space/comma
 * separated; `all` for everything; blank for none). A non-interactive (no TTY)
 * invocation selects nothing — use `--yes` to add all without a prompt.
 */
function promptMultiSelect(repos: string[]): Promise<string[]> {
	return new Promise((resolvePrompt) => {
		if (!process.stdin.isTTY) {
			resolvePrompt([]);
			return;
		}
		const rl = createInterface({input: process.stdin, output: process.stderr});
		process.stderr.write('Discovered work/-participating repos:\n');
		repos.forEach((repo, i) => {
			process.stderr.write(`  [${i + 1}] ${repo}\n`);
		});
		rl.question('Add which? (numbers, `all`, or blank for none) ', (answer) => {
			rl.close();
			const trimmed = answer.trim().toLowerCase();
			if (trimmed === '') {
				resolvePrompt([]);
				return;
			}
			if (trimmed === 'all') {
				resolvePrompt([...repos]);
				return;
			}
			const picks = new Set<string>();
			for (const token of trimmed.split(/[\s,]+/)) {
				const n = Number(token);
				if (Number.isInteger(n) && n >= 1 && n <= repos.length) {
					picks.add(repos[n - 1]);
				}
			}
			resolvePrompt([...picks]);
		});
	});
}

/**
 * Run the CLI: build the program and parse argv. Split from {@link buildProgram}
 * so tests can build + introspect/parse the program WITHOUT triggering a real
 * argv parse + `process.exit` on import (the module-level bootstrap below only
 * fires when this file is the process entry point).
 */
export async function runCli(argv: string[] = process.argv): Promise<void> {
	const program = buildProgram();
	try {
		await program.parseAsync(argv);
	} catch (err: unknown) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}

// Only bootstrap when invoked as the entry point (the installed `bin`), never on
// import (so `buildProgram`/`runCli` are import-safe for tests).
if (isCliEntryPoint()) {
	void runCli();
}

/**
 * True iff this module is the process entry point (the `agent-runner` bin).
 * Resolves both sides through `realpathSync` so a bin SYMLINK (npm/pnpm install
 * a `node_modules/.bin/agent-runner` link to `dist/cli.js`) still matches.
 */
function isCliEntryPoint(): boolean {
	const entry = process.argv[1];
	if (!entry) {
		return false;
	}
	try {
		const entryReal = realpathSync(entry);
		const selfReal = realpathSync(fileURLToPath(import.meta.url));
		return entryReal === selfReal;
	} catch {
		return false;
	}
}
