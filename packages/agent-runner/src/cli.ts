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
import {tmpdir} from 'node:os';
import {join} from 'node:path';

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
	isolation?: string;
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
		.option('--isolation <mode>', 'isolation: clone (default) or worktree')
		.option('--workspace <dir>', 'directory for isolated clones/worktrees')
		.option('--json', 'output the raw result as JSON')
		.action((flags: RunFlags, command: Commander) => {
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
			const isolation = flags.isolation === 'worktree' ? 'worktree' : 'clone';
			const workspace =
				flags.workspace ?? join(tmpdir(), 'agent-runner-workspace');
			const result = runOnce({
				config,
				workspace,
				isolation,
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

	return program;
}

const program = buildProgram();
program.parseAsync(process.argv).catch((err: unknown) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
