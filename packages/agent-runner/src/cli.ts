#!/usr/bin/env node
import {Command} from 'commander';
import {
	loadConfig,
	mergeConfig,
	defaultConfigPath,
	type PartialConfig,
} from './config.js';
import {scan} from './scan.js';
import {formatReport} from './format.js';

interface ScanFlags {
	config?: string;
	root?: string[];
	include?: string[];
	exclude?: string[];
	allowUnspecifiedGate?: boolean;
	json?: boolean;
}

/** Build the overrides a user supplied via CLI flags. */
function flagOverrides(flags: ScanFlags): PartialConfig {
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
	if (flags.allowUnspecifiedGate !== undefined) {
		overrides.allowUnspecifiedGate = flags.allowUnspecifiedGate;
	}
	return overrides;
}

function collect(value: string, previous: string[]): string[] {
	return previous.concat([value]);
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
			'--allow-unspecified-gate',
			'treat items with no afk gate as eligible',
		)
		.option('--json', 'output the raw report as JSON')
		.action((flags: ScanFlags) => {
			const fileConfig = loadConfig(flags.config);
			const config = mergeConfig({...fileConfig, ...flagOverrides(flags)});
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

	return program;
}

const program = buildProgram();
program.parseAsync(process.argv).catch((err: unknown) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
