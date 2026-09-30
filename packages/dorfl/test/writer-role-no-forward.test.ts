import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {
	buildSetupArtifacts,
	dorflPackageVersion,
	generateSetupAction,
	generateWriterSetupAction,
	loadCapabilityRegistry,
	WRITER_PIN_CHECK_SCRIPT,
	WRITER_SETUP_ACTION_USES,
	SETUP_ACTION_USES,
	type ResolvedCIConfig,
} from '../src/install-ci-core.js';
import {
	maybeForward,
	FORWARDED_ENV_MARKER,
	NO_FORWARD_ENV,
	type ForwardSpawn,
} from '../src/bootstrap-forward.js';
import {gitEnv, rmrf} from './helpers/gitRepo.js';
import {localActionFile, runCompositeActionEnv} from './helpers/ci-job-sim.js';

/**
 * WRITER-ROLE JOBS MUST NOT FORWARD (0.15.0 regression). A consumer that pins
 * dorfl through its dependencies declares `"dorflCmd": "node_modules/.bin/dorfl"`.
 * The writer-role setup action (`dorfl-setup-writer`) installs dorfl globally
 * and, by design, never installs the project's dependencies (no project code
 * next to a write token). In 0.15.0 the global dorfl then forwarded to the
 * absent `node_modules/.bin/dorfl` and every writer job (close-job, enumerate,
 * reap-merged-branches, surface-merge-questions, lock, apply) exited 1.
 *
 * The fix: the writer action exports `DORFL_NO_FORWARD=1` to `$GITHUB_ENV`, so
 * every later step of the job runs the pinned global. The agent-role
 * `dorfl-setup` installs dependencies and keeps forwarding.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const TSX_BIN = join(HERE, '..', 'node_modules', '.bin', 'tsx');
const CLI_TS = join(HERE, '..', 'src', 'cli.ts');
/** A consumer that pins dorfl through a devDependency, with no node_modules. */
const FIXTURE = join(HERE, 'fixtures', 'consumer-dorfl-cmd');

const BASE: ResolvedCIConfig = {
	authMode: 'models-json',
	providers: [
		{
			name: 'anthropic',
			apiKeyEnvVar: 'ANTHROPIC_API_KEY',
			models: [{id: 'claude-sonnet-4-20250514'}],
			builtin: true,
		},
	],
	defaultProvider: 'anthropic',
	defaultModel: 'claude-sonnet-4-20250514',
	harness: 'pi',
	installSource: 'registry',
	maxParallel: 2,
};
const WORKSPACE: ResolvedCIConfig = {...BASE, installSource: 'workspace'};

/**
 * The ambient environment minus the two bootstrap-forward variables, so a
 * developer shell (or a forwarded dorfl running the suite) that has either set
 * cannot change what these tests observe.
 */
function baseEnv(): NodeJS.ProcessEnv {
	const env = {...process.env};
	delete env[NO_FORWARD_ENV];
	delete env[FORWARDED_ENV_MARKER];
	return env;
}

interface Step {
	name?: string;
	uses?: string;
	run?: string;
	env?: Record<string, string>;
}

function compositeSteps(actionYaml: string): Step[] {
	return (parse(actionYaml) as {runs: {steps: Step[]}}).runs.steps;
}

/** Copy the fixture consumer into a scratch git checkout (no node_modules). */
function scratchConsumer(): string {
	const dir = mkdtempSync(join(tmpdir(), 'dorfl-consumer-dorfl-cmd-'));
	cpSync(FIXTURE, dir, {recursive: true});
	const env = gitEnv();
	for (const args of [
		['init', '-q', '-b', 'main'],
		['add', '-A'],
		['commit', '-q', '-m', 'consumer'],
	]) {
		const r = spawnSync('git', args, {cwd: dir, env, encoding: 'utf8'});
		if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr}`);
	}
	return dir;
}

// ─── 1. the generated writer action sets DORFL_NO_FORWARD for later steps ────

describe('the writer-role setup action turns the bootstrap forward off for the rest of the job', () => {
	for (const [label, config] of [
		['registry', BASE],
		['workspace', WORKSPACE],
	] as const) {
		it(`${label}: a step after the dorfl install appends ${NO_FORWARD_ENV}=1 to $GITHUB_ENV`, () => {
			const steps = compositeSteps(generateWriterSetupAction(config));
			const setIdx = steps.findIndex(
				(s) =>
					typeof s.run === 'string' &&
					s.run.includes(`echo "${NO_FORWARD_ENV}=1" >> "$GITHUB_ENV"`),
			);
			expect(setIdx).toBeGreaterThanOrEqual(0);
			// It runs after dorfl is installed (or built and linked).
			const installIdx = steps.findIndex(
				(s) =>
					typeof s.run === 'string' &&
					/npm install -g|pnpm link --global/.test(s.run),
			);
			expect(installIdx).toBeGreaterThanOrEqual(0);
			expect(setIdx).toBeGreaterThan(installIdx);
			// It is set through $GITHUB_ENV, not a step-local env: that is what
			// makes it hold for every later step of every job using the action.
			expect(steps[setIdx].env).toBeUndefined();
		});

		it(`${label}: executing the action exports ${NO_FORWARD_ENV}=1 to the job environment`, () => {
			const cwd = scratchConsumer();
			try {
				const {exported} = runCompositeActionEnv({
					actionYaml: generateWriterSetupAction(config),
					cwd,
					env: baseEnv(),
				});
				expect(exported[NO_FORWARD_ENV]).toBe('1');
			} finally {
				rmrf(cwd);
			}
		});
	}

	it('the agent-role dorfl-setup does NOT set it (it installs dependencies and keeps forwarding)', () => {
		for (const config of [BASE, WORKSPACE]) {
			expect(generateSetupAction(config)).not.toContain(NO_FORWARD_ENV);
			expect(
				generateSetupAction(
					config,
					'    - name: Install project deps\n' +
						'      shell: bash\n' +
						'      run: pnpm install --frozen-lockfile\n',
				),
			).not.toContain(NO_FORWARD_ENV);
		}
	});
});

// ─── 2. a simulated writer job in a dorflCmd consumer runs the real CLI ──────

describe('a writer job in a consumer with dorflCmd "node_modules/.bin/dorfl" and no node_modules', () => {
	let consumer: string;
	beforeEach(() => {
		consumer = scratchConsumer();
	});
	afterEach(() => {
		rmrf(consumer);
	});

	/** Run the real CLI entry (forwarding logic included) in the consumer. */
	function runDorfl(env: NodeJS.ProcessEnv, ...args: string[]) {
		return spawnSync(TSX_BIN, [CLI_TS, ...args], {
			cwd: consumer,
			env,
			encoding: 'utf8',
			timeout: 60_000,
		});
	}

	it('runs `dorfl scan --json --here` (the enumerate job) with the env the writer action leaves behind, instead of failing', () => {
		const {exported, stdout} = runCompositeActionEnv({
			actionYaml: generateWriterSetupAction(BASE),
			cwd: consumer,
			env: baseEnv(),
		});
		// The fixture pins dorfl 0.0.1 as a devDependency, so the generated
		// pin-check step (run through YAML, bash and node -e) must warn.
		expect(stdout).toContain(
			'::warning title=dorfl-setup-writer::package.json (the dorflCmd node_modules/.bin/dorfl) pins dorfl@0.0.1 but the writer-role jobs run dorfl@' +
				dorflPackageVersion(),
		);
		const result = runDorfl(
			{...baseEnv(), ...exported},
			'scan',
			'--json',
			'--here',
		);
		expect(result.stderr).not.toContain('could NOT run the repo-declared');
		expect(result.stderr).not.toContain('forwarding to');
		expect(result.status).toBe(0);
		const json = JSON.parse(result.stdout) as {cwd: {path: string}};
		expect(typeof json.cwd.path).toBe('string');
	}, 60_000);

	it('control: the same job WITHOUT the exported variable (the 0.15.0 action) fails on the absent dorflCmd', () => {
		// Proves the fixture really forwards: this is the exact 0.15.0 failure.
		const result = runDorfl(baseEnv(), 'scan', '--json', '--here');
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			'could NOT run the repo-declared dorflCmd `node_modules/.bin/dorfl`',
		);
	}, 60_000);
});

// ─── the version-disagreement warning (registry mode only) ──────────────────

describe('the writer role warns when the repository pins another dorfl version', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'dorfl-pin-check-'));
	});
	afterEach(() => {
		rmrf(dir);
	});

	function check(files: Record<string, unknown>, pinned = '0.15.0'): string {
		for (const [name, content] of Object.entries(files)) {
			writeFileSync(join(dir, name), JSON.stringify(content));
		}
		const r = spawnSync('node', ['-e', WRITER_PIN_CHECK_SCRIPT, pinned], {
			cwd: dir,
			encoding: 'utf8',
		});
		expect(r.status).toBe(0);
		return r.stdout;
	}

	it('the script can live inside a single-quoted bash string', () => {
		expect(WRITER_PIN_CHECK_SCRIPT).not.toContain("'");
	});

	it('only registry mode carries the check (workspace builds dorfl from the checkout)', () => {
		const registry = generateWriterSetupAction(BASE);
		expect(registry).toContain(
			'Warn if the repository pins another dorfl version',
		);
		expect(registry).toContain(`' "${dorflPackageVersion()}"`);
		expect(generateWriterSetupAction(WORKSPACE)).not.toContain(
			'Warn if the repository pins another dorfl version',
		);
	});

	it('warns on `npx dorfl@<other>` and on an exact devDependency behind node_modules/.bin/dorfl', () => {
		expect(check({'dorfl.json': {dorflCmd: 'npx dorfl@0.16.0'}})).toContain(
			'::warning title=dorfl-setup-writer::dorfl.json dorflCmd pins dorfl@0.16.0 but the writer-role jobs run dorfl@0.15.0',
		);
		rmrf(join(dir, 'dorfl.json'));
		expect(
			check({
				'dorfl.json': {dorflCmd: 'node_modules/.bin/dorfl'},
				'package.json': {devDependencies: {dorfl: '0.14.2'}},
			}),
		).toContain('pins dorfl@0.14.2 but the writer-role jobs run dorfl@0.15.0');
	});

	it('escapes the message so a newline in dorflCmd cannot start another workflow command', () => {
		// Only the node_modules branch quotes dorflCmd in the message.
		const out = check({
			'dorfl.json': {dorflCmd: 'node_modules/.bin/dorfl\n::error::x'},
			'package.json': {devDependencies: {dorfl: '0.14.2'}},
		});
		expect(out.trim().split('\n')).toHaveLength(1);
		expect(out).toContain('%0A::error::x');
	});

	it('is silent when the versions agree, for a range, for an unversioned dorflCmd, and without dorfl.json', () => {
		expect(check({})).toBe('');
		expect(check({'dorfl.json': {dorflCmd: 'mise exec dorfl@0.15.0 --'}})).toBe(
			'',
		);
		expect(
			check({
				'dorfl.json': {dorflCmd: 'node_modules/.bin/dorfl'},
				'package.json': {devDependencies: {dorfl: '^0.14.0'}},
			}),
		).toBe('');
		expect(check({'dorfl.json': {dorflCmd: './bin/dorfl'}})).toBe('');
	});
});

// ─── 3. every generated job, against the dorflCmd fixture consumer ──────────

/** Config shapes that change the generated jobs (mirrors workflow-guard). */
const SHAPES: {name: string; config: ResolvedCIConfig; hook?: string}[] = [
	{name: 'registry', config: BASE},
	{name: 'workspace', config: WORKSPACE},
	{name: 'public', config: {...BASE, repoVisibility: 'public'}},
	{
		name: 'with project-setup hook',
		config: BASE,
		hook:
			'    - name: Install project deps\n' +
			'      shell: bash\n' +
			'      run: pnpm install --frozen-lockfile --ignore-scripts\n',
	},
];

/** A `run:` that invokes the dorfl CLI (not a path or a slot name). */
const DORFL_INVOCATION = /(?:^|[\s;&|(`$"])dorfl\s+[a-z-]/m;

interface Job {
	env?: Record<string, string>;
	steps?: Step[];
}

describe('every generated job that runs dorfl, in a consumer whose dorfl.json has a dorflCmd', () => {
	it('writer-role jobs run the installed dorfl; agent-role jobs forward to dorflCmd', async () => {
		const caps = await loadCapabilityRegistry();
		const consumer = scratchConsumer();
		const seen = {writer: new Set<string>(), agent: new Set<string>()};
		const problems: string[] = [];
		try {
			for (const {name, config, hook} of SHAPES) {
				const files = new Map(
					buildSetupArtifacts(config, caps, {projectSetupSteps: hook}).map(
						(f) => [f.path.split('\\').join('/'), f.content],
					),
				);
				// What each local setup action leaves in the job environment.
				const writerExported = runCompositeActionEnv({
					actionYaml: files.get(localActionFile(WRITER_SETUP_ACTION_USES)!)!,
					cwd: consumer,
					env: baseEnv(),
				}).exported;
				const agentAction = files.get(localActionFile(SETUP_ACTION_USES)!)!;
				expect(agentAction).not.toContain(NO_FORWARD_ENV);

				for (const [path, content] of files) {
					if (!path.startsWith('workflows/')) continue;
					const doc = parse(content) as {
						env?: Record<string, string>;
						jobs?: Record<string, Job>;
					};
					for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
						let role: 'writer' | 'agent' | undefined;
						let exported: Record<string, string> = {};
						for (const step of job.steps ?? []) {
							if (step.uses === WRITER_SETUP_ACTION_USES) {
								role = 'writer';
								exported = writerExported;
								continue;
							}
							if (step.uses === SETUP_ACTION_USES) {
								role = 'agent';
								exported = {};
								continue;
							}
							if (
								typeof step.run !== 'string' ||
								!DORFL_INVOCATION.test(step.run)
							) {
								continue;
							}
							const where = `[${name}] ${path} ${jobId} "${step.name ?? step.run.split('\n')[0]}"`;
							if (role === undefined) {
								problems.push(
									`${where}: runs dorfl before any dorfl setup action`,
								);
								continue;
							}
							seen[role].add(`${path} ${jobId}`);
							const calls: string[] = [];
							const spawn: ForwardSpawn = ({cmd}) => {
								calls.push(cmd);
								return {
									kind: 'spawn-error',
									message: `command not found: ${cmd}`,
								};
							};
							// The real decision against the fixture's real dorfl.json,
							// with the environment the job would give this step.
							const outcome = maybeForward({
								argv: ['node', 'dorfl', 'scan'],
								env: {
									...baseEnv(),
									...(doc.env ?? {}),
									...(job.env ?? {}),
									...exported,
									...(step.env ?? {}),
								},
								cwd: consumer,
								spawn,
								writeNotice: () => {},
							});
							if (role === 'writer' && outcome.kind !== 'run-self') {
								problems.push(
									`${where}: writer job forwards to ${calls.join(', ')} and fails`,
								);
							}
							if (role === 'agent' && calls[0] !== 'node_modules/.bin/dorfl') {
								problems.push(
									`${where}: agent job no longer forwards to dorflCmd`,
								);
							}
						}
					}
				}
			}
		} finally {
			rmrf(consumer);
		}
		expect(problems).toEqual([]);
		// Guard against checking nothing: the writer jobs named in the 0.15.0
		// report, and the agent job, were all visited.
		for (const job of [
			'workflows/close-job.yml close-merged-issues',
			'workflows/advance-lifecycle.yml enumerate',
			'workflows/advance-lifecycle.yml reap-merged-branches',
			'workflows/advance-lifecycle.yml surface-merge-questions',
			'workflows/dorfl-item.yml lock',
			'workflows/dorfl-item.yml apply',
		]) {
			expect([...seen.writer]).toContain(job);
		}
		expect([...seen.agent]).toContain('workflows/dorfl-item.yml agent');
	}, 60_000);
});
