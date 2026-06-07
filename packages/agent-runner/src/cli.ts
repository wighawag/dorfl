#!/usr/bin/env node
import {Command, Option} from 'commander';
import type {Command as Commander} from 'commander';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
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
import {runOnce, runLoop, type ItemResult, type RunOnceResult} from './run.js';
import {performClaim} from './claim-cas.js';
import {performStart} from './start.js';
import {
	performWorkOn,
	loadHumanWorktreesDir,
	persistHumanWorktreesDir,
} from './work-on.js';
import {performComplete, integrationFromFlags} from './complete.js';
import {performDo, performDoRemote} from './do.js';
import {createHarness} from './pi-harness.js';
import {shouldUseColor} from './output.js';
import {resolveRepoConfig} from './repo-config.js';
import {
	harnessFlagOverrides,
	doFlagOverrides,
	doNeedsAgentCmd,
	reviewFlagOverrides,
} from './do-config.js';
import {harnessReviewGate} from './review-gate.js';
import {runVerify} from './verify.js';
import {renderPrompt} from './prompt.js';
import {gc, RETAIN_REASON_TEXT} from './gc.js';
import {status, formatStatus} from './status.js';
import {ledgerWrite} from './ledger-write.js';
import {arbiterStatus, DEFAULT_ARBITER_REMOTE} from './arbiter.js';
import {resolveSliceOnlyArg, SlugResolutionError} from './slug-namespace.js';
import {brand} from './brand.js';

interface ScanFlags {
	config?: string;
	allowAgents?: boolean;
	json?: boolean;
}

/**
 * Whether `--allow-agents` / `--no-allow-agents` was explicitly passed on the
 * command line. Commander gives a negatable boolean option a default of `true`,
 * so we must check the value SOURCE to distinguish "user set it" from "default";
 * only an explicit flag becomes a config override (so config/defaults still win
 * otherwise).
 */
function allowAgentsFromCli(
	command: Commander | undefined,
): boolean | undefined {
	if (!command) {
		return undefined;
	}
	const source = command.getOptionValueSource('allowAgents');
	if (source !== 'cli') {
		return undefined;
	}
	return command.getOptionValue('allowAgents') as boolean;
}

/**
 * Build the overrides a user supplied via CLI flags. Discovery is the registry
 * (the hub-mirror set, ADR §1), so there are no `--root`/`--include`/`--exclude`
 * flags any more — only the autonomy-gate `--allow-agents` toggle.
 */
function flagOverrides(flags: ScanFlags, command?: Commander): PartialConfig {
	const overrides: PartialConfig = {};
	const allowAgents = allowAgentsFromCli(command);
	if (allowAgents !== undefined) {
		overrides.allowAgents = allowAgents;
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
	maxIterations?: string;
	maxDuration?: string;
	interval?: string;
	maxParallel?: string;
	perRepoMax?: string;
	arbiter?: string;
	integration?: string;
	provider?: string;
	agentCmd?: string;
	model?: string;
	harness?: string;
	piBin?: string;
	sessionsDir?: string;
	workspace?: string;
	review?: boolean;
	autoMerge?: boolean;
	reviewModel?: string;
	reviewMaxRounds?: string;
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
	if (flags.provider === 'github' || flags.provider === 'none') {
		overrides.provider = flags.provider;
	}
	// The harness/adapter flags (--agent-cmd/--model/--harness/--pi-bin) map via
	// the SHARED per-key mapping `do` also reuses (do-config.harnessFlagOverrides),
	// so there is exactly ONE override path for them.
	Object.assign(overrides, harnessFlagOverrides(flags));
	// Gate 2 (PR/code review) flags ride the SAME flag-override path so
	// `--review`/`--auto-merge`/`--review-model`/`--review-max-rounds` resolve
	// flag > env > per-repo > global > default — mirroring the `do` command (the
	// fleet inherits the review gate via the converged `performIntegration` core).
	Object.assign(overrides, reviewFlagOverrides(flags));
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

interface StartFlags {
	arbiter?: string;
	resume?: boolean;
	ignoreNotReady?: boolean;
}

interface WorkOnFlags {
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
	switch?: boolean;
	ignoreDivergedMain?: boolean;
	skipVerify?: boolean;
	type?: string;
	message?: string;
	review?: boolean;
	autoMerge?: boolean;
	reviewModel?: string;
	reviewMaxRounds?: string;
}

interface DoFlags {
	config?: string;
	arbiter?: string;
	remote?: string;
	merge?: boolean;
	propose?: boolean;
	ignoreDivergedMain?: boolean;
	agentCmd?: string;
	model?: string;
	harness?: string;
	piBin?: string;
	sessionsDir?: string;
	watch?: boolean;
	review?: boolean;
	autoMerge?: boolean;
	reviewModel?: string;
	reviewMaxRounds?: string;
}

interface GcFlags {
	config?: string;
	workspace?: string;
	force?: boolean;
	yes?: boolean;
	json?: boolean;
}

interface StatusFlags {
	config?: string;
	workspace?: string;
	arbiterRemote?: string;
	noArbiter?: boolean;
	json?: boolean;
}

interface RequeueFlags {
	config?: string;
	cwd?: string;
	arbiter?: string;
	reset?: boolean;
	message?: string;
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
	const result = await performStart({
		slug,
		cwd: process.cwd(),
		arbiter: flags.arbiter ?? 'origin',
		// `resume` (the verb) always asserts ownership; `start` honours --resume.
		resume: resume || flags.resume === true,
		override: flags.ignoreNotReady === true,
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
			'--allow-agents',
			'allow agents to claim undeclared (not humanOnly) slices',
		)
		.option(
			'--no-allow-agents',
			'forbid agents from claiming undeclared slices (default)',
		)
		.option('--json', 'output the raw report as JSON')
		.action(async (flags: ScanFlags, command: Commander) => {
			const fileConfig = loadConfig(flags.config);
			const config = resolveGlobalConfig(
				fileConfig,
				flagOverrides(flags, command),
			);
			const report = await scan(config, {
				warn: (message) => console.error(`>> ${message}`),
			});
			if (flags.json) {
				console.log(
					JSON.stringify(
						report,
						(_key, value) => (value instanceof Set ? [...value] : value),
						2,
					),
				);
			} else {
				console.log(formatReport(report));
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
			'--allow-agents',
			'allow agents to claim undeclared (not humanOnly) slices',
		)
		.option(
			'--no-allow-agents',
			'forbid agents from claiming undeclared slices (default)',
		)
		.option('--max-parallel <n>', 'global cap on items claimed+run this tick')
		.option('--per-repo-max <n>', 'per-repo cap on concurrent claims')
		.option('--arbiter <remote>', 'name of the arbiter git remote')
		.option(
			'--integration <mode>',
			'integration mode: propose (default) or merge',
		)
		.option(
			'--provider <name>',
			'propose-mode review-request provider: github (gh pr create) or none (push-only). Default: auto-detect from the arbiter URL (a GitHub remote => github, else none).',
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
			'--auto-merge',
			'on a Gate-2 approve, let a resolved merge proceed autonomously (overrides config; repo policy only). Default off.',
		)
		.option(
			'--no-auto-merge',
			'do NOT auto-merge on approve (a human merges; --propose semantics)',
		)
		.option(
			'--review-model <id>',
			'model the Gate-2 review agent runs on (de-correlated from the builder; routing intent). Resolved flag > env > per-repo > global > default.',
		)
		.option(
			'--review-max-rounds <n>',
			'bound the revise/review loop; on exhaustion force needs-attention (default 2)',
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
			if (config.harness !== 'pi' && config.agentCmd.trim() === '') {
				throw new Error(
					'no agentCmd configured — set `agentCmd` in config or pass --agent-cmd.',
				);
			}
			const workspace = flags.workspace ?? config.workspacesDir;
			// Gate 2 (PR/code review): wire the PRODUCTION harness-backed gate ONLY when
			// `config.review` resolves on (mirror the `do`/`complete` commands). The
			// per-repo review flags are resolved per-item inside `runOneItem`; only the
			// gate SEAM is threaded here. Off ⇒ undefined ⇒ no review (the default).
			const reviewGate = config.review ? harnessReviewGate() : undefined;
			const onWarn = (message: string) => console.error(`>> ${message}`);

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
				const result = await runOnce({
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
			const result = await performClaim({
				slug,
				cwd: process.cwd(),
				arbiter: flags.arbiter ?? 'origin',
				retries:
					flags.retries !== undefined ? Number(flags.retries) : undefined,
				dryRun: flags.dryRun,
				humanPath: true,
				override: flags.ignoreNotReady === true,
				note: (message) => console.error(`>> ${message}`),
			});
			if (result.exitCode !== 0) {
				console.error(`error: ${result.message}`);
			}
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
		.option(
			'--arbiter <remote>',
			'name of the arbiter git remote (default: origin)',
			'origin',
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
			'--no-switch',
			'stay on the work/<slug> branch (and keep it) instead of switching back to main',
		)
		.option(
			'--ignore-diverged-main',
			'override the merge-mode divergence guard: complete --merge even when local main is ahead of <arbiter>/main (unpushed). The work still lands on the arbiter; local main is left for you to `git rebase`. Loud, never default.',
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
			'--auto-merge',
			'on a Gate-2 approve, let a resolved merge proceed autonomously (overrides config; repo policy only). Default off.',
		)
		.option(
			'--no-auto-merge',
			'do NOT auto-merge on approve (a human merges; --propose semantics)',
		)
		.option(
			'--review-model <id>',
			'model the Gate-2 review agent runs on (de-correlated from the builder; routing intent). Resolved flag > env > per-repo > global > default.',
		)
		.option(
			'--review-max-rounds <n>',
			'bound the revise/review loop; on exhaustion force needs-attention (default 2)',
		)
		.action(async (rawSlug: string | undefined, flags: CompleteFlags) => {
			// Slice-only command (§3a): accept bare + `slice:`, reject `prd:`.
			const slug = resolveSliceOnlySlug(rawSlug);
			const cwd = process.cwd();
			const global = loadConfig(flags.config);
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
				provider: config.provider,
				noSwitch: flags.switch === false,
				ignoreDivergedMain: flags.ignoreDivergedMain === true,
				verify: config.verify,
				skipVerify: flags.skipVerify,
				// Gate 2 (PR/code review): when `review` resolves on, run the `review`
				// SKILL as a fresh-context agent (the production harness-backed gate)
				// AFTER the green verify and BEFORE the done-move. The `reviewModel`
				// override flows to the launch through the existing harness seam.
				review: config.review,
				autoMerge: config.autoMerge,
				reviewModel: config.reviewModel,
				reviewMaxRounds: config.reviewMaxRounds,
				reviewGate: config.review ? harnessReviewGate() : undefined,
				type: flags.type,
				message: flags.message,
				// Color the propose-mode next-step block only on an interactive
				// stdout TTY (and not under NO_COLOR); plain when piped/redirected.
				color: shouldUseColor(process.stdout),
				note: (message) => console.error(`>> ${message}`),
				// The propose next-step block is printed verbatim (no `>> ` prefix)
				// so its blank lines + heading stand out as the human call-to-action.
				noteBlock: (message) => console.error(message),
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
			'The per-repo WORKER (the CI command): claim + onboard onto work/<slug>, run the agent, gate, integrate, and exit. In the CURRENT checkout by default (refuses on a dirty tree, integrates in-place). With --remote <r>: against a REGISTERED repo with NO checkout — materialise a hub mirror + job worktree in the agents\u2019 area, run the same pipeline there, then reap. do <slug> | do slice:<slug> | do prd:<slug> (the slicing path, not yet wired). --propose (default) / --merge resolved at integrate-time. Supersedes ar-run.sh. (auto-pick / -n is do-autopick.)',
		)
		// EXTENSIBLE argument grammar (the three do-* slices grow this one block): a
		// single named item here, optional so do-autopick can widen it to variadic /
		// auto-pick without tearing it up. This slice uses EXACTLY one arg.
		.argument(
			'[slug]',
			'the item to do: bare (= the slice), slice:<slug>, or prd:<slug> (slice the PRD)',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--arbiter <remote>',
			'name of the arbiter git remote (default: per-repo/global defaultArbiter)',
		)
		.option(
			'--remote <r>',
			'run against a REGISTERED repo with NO checkout: materialise a hub mirror + job worktree in the agents\u2019 area (auto-registers an unknown remote), run the pipeline there, then reap (never touches the human area)',
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
			'--auto-merge',
			'on a Gate-2 approve, let a resolved merge proceed autonomously (overrides config; repo policy only). Default off.',
		)
		.option(
			'--no-auto-merge',
			'do NOT auto-merge on approve (a human merges; --propose semantics)',
		)
		.option(
			'--review-model <id>',
			'model the Gate-2 review agent runs on (de-correlated from the builder; routing intent). Resolved flag > env > per-repo > global > default.',
		)
		.option(
			'--review-max-rounds <n>',
			'bound the revise/review loop; on exhaustion force needs-attention (default 2)',
		)
		.action(async (rawSlug: string | undefined, flags: DoFlags) => {
			if (rawSlug === undefined) {
				// Auto-pick (no arg) is the do-autopick slice; this slice is the
				// single-named-item, in-place path only.
				console.error(
					'error: `do` needs an item to do (a <slug>). Auto-pick (no arg) ' +
						'is not yet wired (the do-autopick slice).',
				);
				process.exit(1);
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

			// `do --remote <r>`: run against a REGISTERED repo with NO checkout. There
			// is no per-repo `.agent-runner.json` to layer (the registered repo is a
			// bare mirror), so config resolves from global + the SAME `do` flag
			// overrides (flag > env > global > default). The worktree + mirror live in
			// the agents' area (`workspacesDir`); the human area is NEVER touched.
			if (flags.remote !== undefined) {
				const remoteConfig = resolveGlobalConfig(
					global,
					doFlagOverrides(flags, flagMode),
				);
				if (doNeedsAgentCmd(remoteConfig)) {
					console.error(
						'error: no agentCmd configured — set `agentCmd` in config or pass --agent-cmd.',
					);
					process.exit(1);
				}
				const remoteHarness = createHarness({
					harness: remoteConfig.harness,
					piBin: remoteConfig.piBin,
				});
				const remoteResult = await performDoRemote({
					arg: rawSlug,
					remote: flags.remote,
					workspacesDir: remoteConfig.workspacesDir,
					arbiter: flags.arbiter ?? remoteConfig.defaultArbiter,
					integration: remoteConfig.integration,
					verify: remoteConfig.verify,
					provider: remoteConfig.provider,
					harness: remoteHarness,
					agentCmd: remoteConfig.agentCmd,
					model: remoteConfig.model,
					sessionsDir: remoteConfig.sessionsDir,
					review: remoteConfig.review,
					autoMerge: remoteConfig.autoMerge,
					reviewModel: remoteConfig.reviewModel,
					reviewMaxRounds: remoteConfig.reviewMaxRounds,
					reviewGate: remoteConfig.review
						? harnessReviewGate({
								harness: remoteHarness,
								agentCmd: remoteConfig.agentCmd,
							})
						: undefined,
					watch: flags.watch === true,
					color: shouldUseColor(process.stdout),
					note: (message) => console.error(`>> ${message}`),
					noteBlock: (message) => console.error(message),
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
				console.error(
					'error: no agentCmd configured — set `agentCmd` in config or pass --agent-cmd.',
				);
				process.exit(1);
			}
			const harness = createHarness({
				harness: config.harness,
				piBin: config.piBin,
			});
			const result = await performDo({
				arg: rawSlug,
				cwd,
				arbiter: flags.arbiter ?? config.defaultArbiter,
				integration: config.integration,
				// In-place divergence guard override (mirrors --ignore-not-ready).
				ignoreDivergedMain: flags.ignoreDivergedMain === true,
				verify: config.verify,
				provider: config.provider,
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
				autoMerge: config.autoMerge,
				reviewModel: config.reviewModel,
				reviewMaxRounds: config.reviewMaxRounds,
				reviewGate: config.review
					? harnessReviewGate({harness, agentCmd: config.agentCmd})
					: undefined,
				// `--watch`: tail the pi session log live (pi harness only; the
				// performDo guard errors clearly on any other adapter). READ-ONLY.
				watch: flags.watch === true,
				color: shouldUseColor(process.stdout),
				note: (message) => console.error(`>> ${message}`),
				noteBlock: (message) => console.error(message),
			});
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
		.option('--json', 'output the raw result as JSON')
		.action((flags: GcFlags) => {
			const config = resolveGlobalConfig(loadConfig(flags.config), {});
			const workspacesDir = flags.workspace ?? config.workspacesDir;

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
		.option('--json', 'output the raw report as JSON')
		.action(async (flags: StatusFlags) => {
			const config = resolveGlobalConfig(loadConfig(flags.config), {});
			const workspacesDir = flags.workspace ?? config.workspacesDir;
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
			const report = await status({
				workspacesDir,
				mirrorPaths,
				arbiter,
				warn: (message) => console.error(`>> ${message}`),
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
			'Requeue a needs-attention item to the backlog for re-claiming (ADR §12/§14). DEFAULT = keep + continue: git mv work/needs-attention/<slug>.md → work/backlog/<slug>.md and commit it, leaving the work/<slug> branch UNTOUCHED so the next claim CONTINUES from its tip (rebased onto fresh main at onboard-time). --reset = discard + fresh: delete the remote work/<slug> branch FIRST (then the move) so the next claim starts fresh (guarded; never the default). -m/--message appends a dated handoff note to the item body (both modes; append-only). The recorded reason stays in the body as a durable note.',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--cwd <dir>',
			'the repo/working clone whose work/ tree holds the item (default: cwd)',
		)
		.option(
			'--arbiter <remote>',
			'also push the transition to this arbiter remote (like the done-move); REQUIRED with --reset (the branch to delete lives there)',
		)
		.option(
			'--reset',
			'DISCARD the kept work: delete the remote work/<slug> branch FIRST, then move to backlog so the next claim starts FRESH (guarded; a deliberate departure from the never-delete-the-remote-branch invariant). Never the default.',
		)
		.option(
			'-m, --message <note>',
			'append a dated handoff note to the item body for the next agent (append-only; applies to both default and --reset)',
		)
		.action((rawSlug: string, flags: RequeueFlags) => {
			// Slice-only command (§3a): accept bare + `slice:`, reject `prd:`.
			const slug = resolveSliceOnlySlug(rawSlug) as string;
			const cwd = flags.cwd ?? process.cwd();
			// Route the requeue (default keep+continue / --reset discard / -m handoff)
			// THROUGH the ledger write seam's transition (same seam the needs-attention
			// move uses), not the helper.
			const result = ledgerWrite.applyReturnToBacklogTransition({
				cwd,
				slug,
				arbiter: flags.arbiter,
				reset: flags.reset,
				message: flags.message,
				note: (message) => console.error(`>> ${message}`),
			});
			if (!result.moved) {
				console.error(`error: ${result.reasonNotMoved}`);
				process.exit(1);
			}
			const how = result.deletedRemoteBranch
				? ` (--reset: deleted the remote work/${slug} branch; next claim starts fresh)`
				: ' (kept the work branch; next claim continues from its tip)';
			console.log(`Requeued '${slug}' to backlog for re-claiming.${how}`);
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
			'Register a target by creating its hub mirror (idempotent). <target> is the arbiter URL; with --local it is a WORKING REPO whose bare arbiter is provisioned under arbitersDir (~/git, precious DATA, NEVER ~/.agent-runner) and THAT arbiter is registered (absorbing `arbiter init`). The transport guard refuses registering one project (same host/org/name) under a second transport unless --force.',
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
			'register even though the same project is already registered under a different transport (anti-stranding guard override)',
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

	return program;
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
