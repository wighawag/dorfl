#!/usr/bin/env node
import {Command} from 'commander';
import type {Command as Commander} from 'commander';
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
import {performComplete} from './complete.js';
import {runVerify} from './verify.js';
import {renderPrompt} from './prompt.js';
import {gc, RETAIN_REASON_TEXT} from './gc.js';
import {status, formatStatus} from './status.js';
import {detectRepos} from './detect.js';
import {returnToBacklog} from './needs-attention.js';

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

interface RunFlags extends ScanFlags {
	once?: boolean;
	maxParallel?: string;
	perRepoMax?: string;
	arbiter?: string;
	integration?: string;
	agentCmd?: string;
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
}

interface VerifyFlags {
	config?: string;
}

interface StartFlags {
	arbiter?: string;
	by?: string;
	resume?: boolean;
}

interface CompleteFlags {
	config?: string;
	arbiter?: string;
	integration?: string;
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
			if (config.agentCmd.trim() === '') {
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
		.action(async (slug: string, flags: ClaimFlags) => {
			const result = await performClaim({
				slug,
				cwd: process.cwd(),
				arbiter: flags.arbiter ?? 'origin',
				by: flags.by,
				retries:
					flags.retries !== undefined ? Number(flags.retries) : undefined,
				dryRun: flags.dryRun,
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
			'Claim a backlog item (only if needed) and onboard onto its work/<slug> branch in the CURRENT checkout. Decides on the folder on <arbiter>/main, never on claimed_by. Launches no agent/editor.',
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
		.action(async (slug: string | undefined, flags: StartFlags) => {
			const result = await performStart({
				slug,
				cwd: process.cwd(),
				arbiter: flags.arbiter ?? 'origin',
				by: flags.by,
				resume: flags.resume,
				note: (message) => console.error(`>> ${message}`),
			});
			if (result.exitCode !== 0) {
				console.error(`error: ${result.message}`);
			}
			process.exit(result.exitCode);
		});

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
			'On a work/<slug> branch (slug inferred if omitted): run the gate, mark done (git mv in-progress\u2192done), commit (<type>(<slug>): <summary>; done) the agent\u2019s uncommitted work + the move, rebase onto <arbiter>/main, and integrate (merge\u2192main + local sync, or propose\u2192push branch). Never --force.',
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
			'--integration <mode>',
			'integration mode: propose (default) or merge (overrides config)',
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
			const config = loadConfig(flags.config);
			const integration =
				flags.integration === 'merge' || flags.integration === 'propose'
					? flags.integration
					: config.integration;
			const result = await performComplete({
				slug,
				cwd: process.cwd(),
				arbiter: flags.arbiter ?? config.defaultArbiter,
				integration,
				verify: config.verify,
				skipVerify: flags.skipVerify,
				type: flags.type,
				message: flags.message,
				note: (message) => console.error(`>> ${message}`),
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

	return program;
}

const program = buildProgram();
program.parseAsync(process.argv).catch((err: unknown) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
