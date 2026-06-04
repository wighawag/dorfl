#!/usr/bin/env node
import {Command} from 'commander';
import type {Command as Commander} from 'commander';
import {createInterface} from 'node:readline';
import {
	loadConfig,
	mergeConfig,
	defaultConfigPath,
	type PartialConfig,
} from './config.js';
import {scan} from './scan.js';
import {formatReport} from './format.js';
import {runOnce, type ItemResult} from './run.js';
import {performClaim} from './claim-cas.js';
import {performStart} from './start.js';
import {
	performWorkOn,
	loadHumanWorktreesDir,
	persistHumanWorktreesDir,
} from './work-on.js';
import {performComplete, integrationFromFlags} from './complete.js';
import {shouldUseColor} from './output.js';
import {resolveRepoConfig} from './repo-config.js';
import {runVerify} from './verify.js';
import {renderPrompt} from './prompt.js';
import {gc, RETAIN_REASON_TEXT} from './gc.js';
import {status, formatStatus} from './status.js';
import {detectRepos} from './detect.js';
import {returnToBacklog} from './needs-attention.js';
import {
	arbiterInit,
	arbiterStatus,
	formatArbiterStatus,
	DEFAULT_ARBITER_REMOTE,
} from './arbiter.js';

interface ScanFlags {
	config?: string;
	root?: string[];
	include?: string[];
	exclude?: string[];
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

/** Build the overrides a user supplied via CLI flags. */
function flagOverrides(flags: ScanFlags, command?: Commander): PartialConfig {
	const overrides: PartialConfig = {};
	if (flags.root && flags.root.length > 0) {
		overrides.roots = flags.root;
	}
	if (flags.include && flags.include.length > 0) {
		overrides.include = flags.include;
	}
	if (flags.exclude && flags.exclude.length > 0) {
		overrides.exclude = flags.exclude;
	}
	const allowAgents = allowAgentsFromCli(command);
	if (allowAgents !== undefined) {
		overrides.allowAgents = allowAgents;
	}
	return overrides;
}

function collect(value: string, previous: string[]): string[] {
	return previous.concat([value]);
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
	maxParallel?: string;
	perRepoMax?: string;
	arbiter?: string;
	integration?: string;
	agentCmd?: string;
	harness?: string;
	piBin?: string;
	workspace?: string;
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
	if (flags.agentCmd !== undefined) {
		overrides.agentCmd = flags.agentCmd;
	}
	if (flags.harness === 'null' || flags.harness === 'pi') {
		overrides.harness = flags.harness;
	}
	if (flags.piBin !== undefined) {
		overrides.piBin = flags.piBin;
	}
	return overrides;
}

function formatItemLine(item: ItemResult): string {
	const extra = item.detail ? ` — ${item.detail}` : '';
	return `  [${item.status}] ${item.repoPath} :: ${item.slug}${extra}`;
}

interface ClaimFlags {
	arbiter?: string;
	by?: string;
	retries?: string;
	dryRun?: boolean;
	force?: boolean;
	ignoreNotReady?: boolean;
}

interface VerifyFlags {
	config?: string;
}

interface StartFlags {
	arbiter?: string;
	by?: string;
	resume?: boolean;
	force?: boolean;
	ignoreNotReady?: boolean;
}

interface WorkOnFlags {
	config?: string;
	arbiter?: string;
	by?: string;
	copy?: string;
	copyFrom?: string;
	force?: boolean;
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
	skipVerify?: boolean;
	type?: string;
	message?: string;
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
	json?: boolean;
}

interface ReturnFlags {
	config?: string;
	cwd?: string;
	arbiter?: string;
}

interface ArbiterInitFlags {
	config?: string;
	at?: string;
	remote?: string;
}

interface ArbiterStatusFlags {
	config?: string;
	remote?: string;
	json?: boolean;
}

export function buildProgram(): Command {
	const program = new Command();

	program
		.name('agent-runner')
		.description('Autonomous parallel agents over file-based work/ queues.');

	program
		.command('scan')
		.description(
			'Read-only: list the cross-repo queue of work items and whether each is runnable now.',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'-r, --root <path>',
			'root directory to scan (repeatable, overrides config roots)',
			collect,
			[],
		)
		.option(
			'--include <path>',
			'force-include a repo path (repeatable)',
			collect,
			[],
		)
		.option(
			'--exclude <path>',
			'exclude a repo path or basename (repeatable)',
			collect,
			[],
		)
		.option(
			'--allow-agents',
			'allow agents to claim undeclared (not humanOnly) slices',
		)
		.option(
			'--no-allow-agents',
			'forbid agents from claiming undeclared slices (default)',
		)
		.option('--json', 'output the raw report as JSON')
		.action((flags: ScanFlags, command: Commander) => {
			const fileConfig = loadConfig(flags.config);
			const config = mergeConfig({
				...fileConfig,
				...flagOverrides(flags, command),
			});
			const report = scan(config);
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
		.description(
			'Claim up to maxParallel eligible items, run the agent on each in isolation, integrate, then stop.',
		)
		.option('--once', 'run a single supervised tick then stop (increment B)')
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'-r, --root <path>',
			'root directory to scan (repeatable, overrides config roots)',
			collect,
			[],
		)
		.option(
			'--include <path>',
			'force-include a repo path (repeatable)',
			collect,
			[],
		)
		.option(
			'--exclude <path>',
			'exclude a repo path or basename (repeatable)',
			collect,
			[],
		)
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
		.option('--agent-cmd <cmd>', 'command to run one agent on a slice prompt')
		.option(
			'--harness <adapter>',
			'harness adapter that launches the agent + reports liveness: null (default, shells out to agentCmd) or pi (the pi CLI)',
		)
		.option(
			'--pi-bin <path>',
			'pi CLI binary the pi harness invokes (default: pi on PATH)',
		)
		.option(
			'--workspace <dir>',
			'execution working area for hub mirrors + job worktrees (default: workspacesDir / ~/.agent-runner)',
		)
		.option('--json', 'output the raw result as JSON')
		.action(async (flags: RunFlags, command: Commander) => {
			if (!flags.once) {
				throw new Error(
					'only `run --once` is implemented (increment B). Pass --once.',
				);
			}
			const fileConfig = loadConfig(flags.config);
			const config = mergeConfig({
				...fileConfig,
				...runFlagOverrides(flags, command),
			});
			// The null adapter shells out to agentCmd, so it is required there; the
			// pi adapter invokes the pi CLI directly and does not consume agentCmd.
			if (config.harness !== 'pi' && config.agentCmd.trim() === '') {
				throw new Error(
					'no agentCmd configured — set `agentCmd` in config or pass --agent-cmd.',
				);
			}
			const workspace = flags.workspace ?? config.workspacesDir;
			const result = await runOnce({
				config,
				workspace,
				onWarn: (message) => console.error(`>> ${message}`),
			});
			if (flags.json) {
				console.log(JSON.stringify(result, null, 2));
			} else {
				for (const item of result.items) {
					console.log(formatItemLine(item));
				}
				console.log(
					`Summary: ${result.claimedAndDone} done, ${result.skipped} skipped, ${result.failed} failed.`,
				);
			}
		});

	program
		.command('verify')
		.description(
			"Run the repo's declared acceptance gate (per-repo `verify` config) and exit with its status (0 = pass). Deterministic shell gate; no model. Read-only with respect to work/.",
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.action(async (flags: VerifyFlags) => {
			const config = loadConfig(flags.config);
			const result = await runVerify({
				cwd: process.cwd(),
				verify: config.verify,
			});
			process.exit(result.exitCode);
		});

	program
		.command('claim')
		.description(
			'Atomically claim a work/backlog/<slug>.md item via a compare-and-swap push to the arbiter (in-process; mirrors scripts/claim.sh).',
		)
		.argument('<slug>', 'the slug of the backlog item to claim')
		.option(
			'--arbiter <remote>',
			'name of the arbiter git remote (default: origin)',
			'origin',
		)
		.option('--by <who>', 'advisory claimer id (default: git user.name)')
		.option('--retries <n>', 'cap on push retries when main advances', '3')
		.option('--dry-run', 'show the intended push without mutating the arbiter')
		.option(
			'--force',
			'override the readiness guard: claim despite an unmet blockedBy, and silence the needsAnswers warning (loud, never default)',
		)
		.option(
			'--ignore-not-ready',
			'alias of --force for the readiness guard override',
		)
		.action(async (slug: string, flags: ClaimFlags) => {
			const result = await performClaim({
				slug,
				cwd: process.cwd(),
				arbiter: flags.arbiter ?? 'origin',
				by: flags.by,
				retries:
					flags.retries !== undefined ? Number(flags.retries) : undefined,
				dryRun: flags.dryRun,
				humanPath: true,
				override: flags.force === true || flags.ignoreNotReady === true,
				note: (message) => console.error(`>> ${message}`),
			});
			if (result.exitCode !== 0) {
				console.error(`error: ${result.message}`);
			}
			process.exit(result.exitCode);
		});

	program
		.command('start')
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
		.option('--by <who>', 'advisory claimer id forwarded to the claim CAS')
		.option(
			'--resume',
			'assert ownership of an already in-progress item: switch to its work branch without claiming',
		)
		.option(
			'--force',
			'override the readiness guard: claim despite an unmet blockedBy, and silence the needsAnswers warning (loud, never default)',
		)
		.option(
			'--ignore-not-ready',
			'alias of --force for the readiness guard override',
		)
		.action(async (slug: string | undefined, flags: StartFlags) => {
			const result = await performStart({
				slug,
				cwd: process.cwd(),
				arbiter: flags.arbiter ?? 'origin',
				by: flags.by,
				resume: flags.resume,
				override: flags.force === true || flags.ignoreNotReady === true,
				note: (message) => console.error(`>> ${message}`),
			});
			if (result.exitCode !== 0) {
				console.error(`error: ${result.message}`);
			}
			process.exit(result.exitCode);
		});

	program
		.command('work-on')
		.description(
			'HUMAN command: claim a slice and create an isolated worktree in a human-friendly location (under config humanWorktreesDir, NEVER ~/.agent-runner) for parallel work. Two forms: `work-on <slug>` (infer the arbiter from the current repo) and `work-on <remote> <slug>` (ensure a hub mirror via repo-mirror, creating if absent). BOTH claim, then always fetch + branch work/<slug> off the freshly-fetched <arbiter>/main — same claim, same starting commit; only the worktree LOCATION differs. --copy <patterns> copies named gitignored files (copy, not symlink; --copy-from required in remote mode) with a security notice. A binary cannot cd your shell: it prints the path + a cd hint; --print-dir emits the path only, for `work-on(){ cd "$(agent-runner work-on "$@" --print-dir)"; }`.',
		)
		.argument(
			'<remoteOrSlug>',
			'the slug (in-repo form) OR the remote (when a second slug arg follows)',
		)
		.argument(
			'[slug]',
			'the slug, when the first argument is a <remote> (remote form)',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--arbiter <remote>',
			'name of the arbiter git remote in the current repo (in-repo form; default: origin)',
			'origin',
		)
		.option('--by <who>', 'advisory claimer id forwarded to the claim CAS')
		.option(
			'--copy <patterns>',
			'comma-separated gitignored filenames to COPY into the worktree (e.g. .env.local,.env). In-repo: from the current repo; remote: requires --copy-from. Copy, not symlink.',
		)
		.option(
			'--copy-from <path>',
			'source dir for --copy in the remote form (required there; there is no implicit current repo)',
		)
		.option(
			'--print-dir',
			'print ONLY the worktree path to stdout (for a shell wrapper: work-on(){ cd "$(agent-runner work-on "$@" --print-dir)"; })',
		)
		.option(
			'--workspace <dir>',
			'execution working area for hub mirrors (default: workspacesDir / ~/.agent-runner)',
		)
		.option(
			'--force',
			'override the readiness guard: claim despite an unmet blockedBy, and silence the needsAnswers warning (loud, never default)',
		)
		.option(
			'--ignore-not-ready',
			'alias of --force for the readiness guard override',
		)
		.action(
			async (
				remoteOrSlug: string,
				slug: string | undefined,
				flags: WorkOnFlags,
			) => {
				// Disambiguate the two forms positionally: one arg ⇒ in-repo `<slug>`;
				// two args ⇒ remote `<remote> <slug>`.
				const remote = slug !== undefined ? remoteOrSlug : undefined;
				const theSlug = slug !== undefined ? slug : remoteOrSlug;

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
					by: flags.by,
					copy: flags.copy,
					copyFrom: flags.copyFrom,
					override: flags.force === true || flags.ignoreNotReady === true,
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
			},
		);

	program
		.command('prompt')
		.description(
			"Print to stdout the work-agent prompt for a slice: the canonical CLAIM-PROTOCOL wrapper + the slice's own ## Prompt (with <slug> and source PRD substituted). Resolves work/in-progress/<slug>.md then work/backlog/<slug>.md; infers <slug> from a work/<slug> branch when omitted. Read-only, stdout only — the same assembly the autonomous runner feeds agentCmd.",
		)
		.argument(
			'[slug]',
			'the slug to render (inferred from a work/<slug> branch if omitted)',
		)
		.action((slug: string | undefined) => {
			const output = renderPrompt({slug, cwd: process.cwd()});
			process.stdout.write(output);
		});

	program
		.command('complete')
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
			'--skip-verify',
			'skip the acceptance gate (human-only escape hatch; the runner never skips)',
		)
		.option('--type <type>', 'conventional-commit type for the commit', 'feat')
		.option(
			'--message <summary>',
			'commit summary (default: the slice title, minus a leading "slug \u2014 " prefix)',
		)
		.action(async (slug: string | undefined, flags: CompleteFlags) => {
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
				flags: flagMode ? {integration: flagMode} : {},
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
				noSwitch: flags.switch === false,
				verify: config.verify,
				skipVerify: flags.skipVerify,
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
		.command('gc')
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
			const config = loadConfig(flags.config);
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
		.description(
			'Read-only operational dashboard of JOBS (distinct from scan’s backlog queue): list every job under workspacesDir/work/* from its .agent-runner-job.json record + worktree state, grouped active (running + alive) vs failed/retained (needs-attention with its reason, a crashed running-but-dead job, or a done-but-un-reaped one). Liveness comes from the harness seam (PID/session), NOT mtime. Never claims/runs/moves/deletes (deletion is gc).',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--workspace <dir>',
			'execution working area to inspect (default: workspacesDir / ~/.agent-runner)',
		)
		.option('--json', 'output the raw report as JSON')
		.action((flags: StatusFlags) => {
			const config = loadConfig(flags.config);
			const workspacesDir = flags.workspace ?? config.workspacesDir;
			// Also surface the folder-native needs-attention set (ADR §12): the
			// `work/needs-attention/` folders of every participating repo.
			const repoRoots = detectRepos({
				roots: config.roots,
				include: config.include,
				exclude: config.exclude,
			});
			const report = status({workspacesDir, repoRoots});
			if (flags.json) {
				console.log(JSON.stringify(report, null, 2));
			} else {
				console.log(formatStatus(report));
			}
		});

	program
		.command('return <slug>')
		.description(
			'Return a resolved needs-attention item to the backlog for re-claiming (ADR §12): git mv work/needs-attention/<slug>.md → work/backlog/<slug>.md and commit it. The clean re-queue once a human has resolved the cause, so items do not rot. The recorded reason stays in the body as a durable note.',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--cwd <dir>',
			'the repo/working clone whose work/ tree holds the item (default: cwd)',
		)
		.option(
			'--arbiter <remote>',
			'also push the transition to this arbiter remote (like the done-move)',
		)
		.action((slug: string, flags: ReturnFlags) => {
			const cwd = flags.cwd ?? process.cwd();
			const result = returnToBacklog({
				cwd,
				slug,
				arbiter: flags.arbiter,
				note: (message) => console.error(`>> ${message}`),
			});
			if (!result.moved) {
				console.error(`error: ${result.reasonNotMoved}`);
				process.exit(1);
			}
			console.log(`Returned '${slug}' to backlog for re-claiming.`);
		});

	const arbiter = program
		.command('arbiter')
		.description(
			'Provision/inspect a local --bare arbiter (the offline source of truth the claim/integration protocols serialize on). Arbiters are precious DATA (ADR §7): they live under ~/git (config arbitersDir), hierarchical, NEVER under ~/.agent-runner.',
		);

	arbiter
		.command('init')
		.description(
			'Derive a bare arbiter from an existing working repo: git clone --bare it to the resolved ~/git/<host>/<org>/<name>.git path (or --at), then wire the repo’s arbiter remote to it. Idempotent (an existing arbiter is detected, not clobbered). Refuses the unsafe non-bare-with-main case (which would reject claim pushes).',
		)
		.argument('[repo]', 'the working repo to derive from (default: cwd)')
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--at <path>',
			'explicit arbiter location (overrides the resolved ~/git default)',
		)
		.option(
			'--remote <name>',
			`name of the arbiter remote to wire in the repo (default: ${DEFAULT_ARBITER_REMOTE})`,
		)
		.action((repo: string | undefined, flags: ArbiterInitFlags) => {
			const config = loadConfig(flags.config);
			const result = arbiterInit({
				repo,
				cwd: process.cwd(),
				at: flags.at,
				arbitersDir: config.arbitersDir,
				remote: flags.remote ?? DEFAULT_ARBITER_REMOTE,
				note: (message) => console.error(`>> ${message}`),
			});
			if (result.created) {
				console.log(`Provisioned bare arbiter at ${result.path}`);
			} else {
				console.log(`Arbiter already exists at ${result.path} (not clobbered)`);
			}
			console.log(`Wired remote '${result.remote}' -> ${result.url}`);
		});

	arbiter
		.command('status')
		.description(
			'Read-only report of the current repo’s arbiter: which remote it is, its URL/path, whether it exists and is bare, and whether main is reachable. Flags the unsafe non-bare-with-main case. Mutates nothing.',
		)
		.option('-c, --config <path>', 'config file path', defaultConfigPath())
		.option(
			'--remote <name>',
			`the arbiter remote name to report on (default: ${DEFAULT_ARBITER_REMOTE})`,
		)
		.option('--json', 'output the raw report as JSON')
		.action((flags: ArbiterStatusFlags) => {
			const report = arbiterStatus({
				cwd: process.cwd(),
				remote: flags.remote ?? DEFAULT_ARBITER_REMOTE,
			});
			if (flags.json) {
				console.log(JSON.stringify(report, null, 2));
			} else {
				console.log(formatArbiterStatus(report));
			}
		});

	return program;
}

const program = buildProgram();
program.parseAsync(process.argv).catch((err: unknown) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
