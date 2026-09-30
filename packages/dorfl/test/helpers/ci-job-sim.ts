import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parse} from 'yaml';
import {rmrf} from './gitRepo.js';

/**
 * A small simulator of what a LOCAL composite action (`uses: ./.github/actions/x`)
 * leaves behind for the later steps of a GitHub Actions job: the variables its
 * steps append to `$GITHUB_ENV`. Used by the writer-role no-forward tests to run
 * a generated `dorfl-setup-writer` against a fixture consumer and then run a
 * writer command with the resulting environment, the way a real job would.
 *
 * It EXECUTES the action's `run:` steps with bash, in the consumer checkout,
 * with `GITHUB_ENV` / `GITHUB_PATH` / `GITHUB_OUTPUT` pointed at scratch files.
 * Steps that install or build something (`npm`, `pnpm`) or touch git are
 * skipped: they need the network or a real runner, and they do not export
 * environment variables. `uses:` steps (setup-node, pnpm/action-setup) are
 * skipped too. Only the simple `NAME=value` form of `$GITHUB_ENV` is understood;
 * the multi-line `NAME<<DELIM` form throws so a future step using it is noticed.
 */

/** One step of a composite action, as parsed from its YAML. */
interface CompositeStep {
	name?: string;
	uses?: string;
	run?: string;
	shell?: string;
	env?: Record<string, string>;
}

/** Steps the simulator does not execute (network, install, build, git). */
export function isSkippedStep(step: CompositeStep): boolean {
	if (typeof step.run !== 'string') return true;
	return /\b(?:npm|pnpm)\s|\bgit\s/.test(step.run);
}

/** Map `./.github/actions/<name>` to the generated `actions/<name>/action.yml`. */
export function localActionFile(uses: string): string | undefined {
	const m = /^\.\/\.github\/actions\/([^/@\s]+)\/?$/.exec(uses.trim());
	return m ? `actions/${m[1]}/action.yml` : undefined;
}

/** Parse the simple `NAME=value` lines a step appended to `$GITHUB_ENV`. */
export function parseGithubEnvFile(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of text.split('\n')) {
		if (line.trim() === '') continue;
		if (/^[A-Za-z_][A-Za-z0-9_]*<</.test(line)) {
			throw new Error(
				`ci-job-sim: multi-line $GITHUB_ENV entries are not simulated: ${line}`,
			);
		}
		const eq = line.indexOf('=');
		if (eq <= 0) {
			throw new Error(`ci-job-sim: malformed $GITHUB_ENV line: ${line}`);
		}
		out[line.slice(0, eq)] = line.slice(eq + 1);
	}
	return out;
}

/**
 * Run the executable steps of a composite action (its YAML text) in `cwd` and
 * return the variables they exported through `$GITHUB_ENV`, plus everything the
 * steps printed (so a test can assert on a `::warning` line).
 */
export function runCompositeActionEnv(options: {
	actionYaml: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}): {exported: Record<string, string>; stdout: string; ran: string[]} {
	const doc = parse(options.actionYaml) as {
		runs?: {using?: string; steps?: CompositeStep[]};
	};
	if (doc.runs?.using !== 'composite') {
		throw new Error('ci-job-sim: not a composite action');
	}
	const scratch = mkdtempSync(join(tmpdir(), 'dorfl-ci-job-sim-'));
	const githubEnv = join(scratch, 'github_env');
	writeFileSync(githubEnv, '');
	let stdout = '';
	const ran: string[] = [];
	try {
		for (const step of doc.runs.steps ?? []) {
			if (isSkippedStep(step)) continue;
			if (step.shell !== undefined && step.shell !== 'bash') {
				throw new Error(`ci-job-sim: unsupported shell ${step.shell}`);
			}
			// Actions re-reads $GITHUB_ENV between steps, so a later step sees
			// what an earlier one exported.
			const soFar = parseGithubEnvFile(readFileSync(githubEnv, 'utf8'));
			const result = spawnSync(
				'bash',
				['--noprofile', '--norc', '-eo', 'pipefail', '-c', step.run!],
				{
					cwd: options.cwd,
					env: {
						...options.env,
						...soFar,
						...(step.env ?? {}),
						GITHUB_ENV: githubEnv,
						GITHUB_PATH: join(scratch, 'github_path'),
						GITHUB_OUTPUT: join(scratch, 'github_output'),
						RUNNER_TEMP: scratch,
					},
					encoding: 'utf8',
					timeout: 30_000,
				},
			);
			if (result.status !== 0) {
				throw new Error(
					`ci-job-sim: step "${step.name ?? '(unnamed)'}" exited ` +
						`${result.status}: ${result.stderr}`,
				);
			}
			stdout += result.stdout;
			ran.push(step.name ?? '(unnamed)');
		}
		return {
			exported: parseGithubEnvFile(readFileSync(githubEnv, 'utf8')),
			stdout,
			ran,
		};
	} finally {
		rmrf(scratch);
	}
}
