import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildProgram} from '../src/cli.js';
import {LOCK_OUTPUTS_ENV} from '../src/ci-lock-outputs.js';
import {acquireNotingOnce} from '../src/ci-phase-driver.js';
import {
	ciPhaseEnv,
	makeScratch,
	seedRepoWithArbiter,
	type Scratch,
	type SeededRepo,
} from './helpers/gitRepo.js';

/**
 * The CLI output of a CI phase run (task `ci-phase-logs-each-line-once`): the
 * phase's result line is printed ONCE, by the CLI, and not also noted by the
 * phase driver (the CI job logs showed most `>>` lines twice in a row).
 */

const TASK = 'add-thing';
const SPEC = 'big-feature';
/** The lock phase, as the item workflow runs it. */
const LOCK = ['--propose', '--phase', 'lock', '--arbiter', 'origin'];

let scratch: Scratch;
let seeded: SeededRepo;

class Exited extends Error {
	constructor(readonly code: number | undefined) {
		super(`process.exit(${code})`);
	}
}

/** Run the CLI in `cwd` and capture its stderr lines and exit code. */
async function runCli(
	argv: string[],
	cwd: string,
): Promise<{lines: string[]; code: number | undefined}> {
	vi.spyOn(process, 'cwd').mockReturnValue(cwd);
	const lines: string[] = [];
	vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
		lines.push(...args.join(' ').split('\n'));
	});
	vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		lines.push(...args.join(' ').split('\n'));
	});
	vi.spyOn(process, 'exit').mockImplementation((code) => {
		throw new Exited(code === undefined ? undefined : Number(code));
	});
	let code: number | undefined;
	try {
		await buildProgram().parseAsync(['node', 'dorfl', ...argv]);
	} catch (err) {
		if (!(err instanceof Exited)) throw err;
		code = err.code;
	} finally {
		vi.restoreAllMocks();
	}
	return {lines, code};
}

/** The result line (the last `>> ` or `error: ` line) and how often it appears. */
function resultLine(lines: string[]): {line: string; count: number} {
	const results = lines.filter(
		(l) => l.startsWith('>> ') || l.startsWith('error: '),
	);
	const line = results[results.length - 1];
	expect(line, lines.join('\n')).toBeDefined();
	const text = line.replace(/^(>> |error: )/, '');
	const count = lines.filter(
		(l) => l === `>> ${text}` || l === `error: ${text}`,
	).length;
	return {line, count};
}

beforeEach(() => {
	scratch = makeScratch('dorfl-phase-cli-output-');
	seeded = seedRepoWithArbiter(scratch.root, [TASK], {
		specs: [SPEC],
		// The CLI refuses a build/tasking run with nothing to launch; the lock
		// phase launches nothing and runs no gate.
		repoConfig: {harness: 'pi', verify: 'true'},
	});
	for (const [k, v] of Object.entries(ciPhaseEnv())) {
		if (v !== undefined) vi.stubEnv(k, v);
	}
	vi.stubEnv('GITHUB_ACTIONS', 'true');
	vi.stubEnv('GITHUB_OUTPUT', join(scratch.root, 'github-output'));
	writeFileSync(join(scratch.root, 'github-output'), '');
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	scratch.cleanup();
});

describe('a CI phase run prints its result line once', () => {
	it('build: the lock phase that backs off from a held lock', async () => {
		const first = await runCli(
			['advance', `task:${TASK}`, ...LOCK],
			seeded.clone('first'),
		);
		expect(first.code, first.lines.join('\n')).toBe(0);
		expect(resultLine(first.lines).count, first.lines.join('\n')).toBe(1);
		// The progress lines that are not the result line are still printed.
		expect(first.lines[0]).toMatch(/^>> CLAIMED 'add-thing'/);
		expect(first.lines[first.lines.length - 1]).toMatch(
			/^>> locked task:add-thing/,
		);

		const second = await runCli(
			['advance', `task:${TASK}`, ...LOCK],
			seeded.clone('second'),
		);
		expect(second.code, second.lines.join('\n')).toBe(2);
		const r = resultLine(second.lines);
		expect(r.line).toMatch(/already locked .*backing off/);
		expect(r.count, second.lines.join('\n')).toBe(1);
	});

	it('build: the lock phase of an item that is not claimable (no-op)', async () => {
		const run = await runCli(
			['advance', 'task:no-such-task', ...LOCK],
			seeded.clone('noop'),
		);
		expect(resultLine(run.lines).count, run.lines.join('\n')).toBe(1);
	});

	it('tasking: the lock phase, then one that backs off', async () => {
		const first = await runCli(
			['advance', `spec:${SPEC}`, ...LOCK],
			seeded.clone('first'),
		);
		expect(first.code, first.lines.join('\n')).toBe(0);
		expect(resultLine(first.lines).count, first.lines.join('\n')).toBe(1);

		const second = await runCli(
			['advance', `spec:${SPEC}`, ...LOCK],
			seeded.clone('second'),
		);
		expect(second.code, second.lines.join('\n')).not.toBe(0);
		expect(resultLine(second.lines).count, second.lines.join('\n')).toBe(1);
	});

	it('tree-less: the lock phase, then one that backs off', async () => {
		const seedClone = seeded.clone('seed-observation');
		const dir = join(seedClone, 'work', 'notes', 'observations');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, 'odd-thing.md'),
			'---\ntitle: odd thing\n---\n\nSomething odd.\n',
		);
		const env = ciPhaseEnv();
		const {git} = await import('../src/git.js');
		git(['add', '-A'], seedClone, {env});
		git(['commit', '-q', '-m', 'observation'], seedClone, {env});
		git(['push', '-q', 'origin', 'HEAD:main'], seedClone, {env});

		const first = await runCli(
			['advance', 'observation:odd-thing', ...LOCK],
			seeded.clone('first'),
		);
		expect(first.code, first.lines.join('\n')).toBe(0);
		expect(resultLine(first.lines).count, first.lines.join('\n')).toBe(1);

		const second = await runCli(
			['advance', 'observation:odd-thing', ...LOCK],
			seeded.clone('second'),
		);
		expect(second.code, second.lines.join('\n')).not.toBe(0);
		expect(resultLine(second.lines).count, second.lines.join('\n')).toBe(1);
	});

	it('intake: the agent phase the lock job said needs no agent', async () => {
		// As `toJSON(needs.lock.outputs)` renders it: every value a string.
		vi.stubEnv(
			LOCK_OUTPUTS_ENV,
			JSON.stringify({
				acquired: 'true',
				needsAgent: 'false',
				rung: 'intake',
				baseSha: '0'.repeat(40),
			}),
		);
		const handoff = join(scratch.root, 'handoff');
		mkdirSync(handoff);
		const run = await runCli(
			[
				'intake',
				'1',
				'--phase',
				'agent',
				'--handoff-out',
				handoff,
				'--arbiter',
				'origin',
			],
			seeded.clone('intake'),
		);
		expect(run.code, run.lines.join('\n')).toBe(0);
		const r = resultLine(run.lines);
		expect(r.line).toMatch(/no agent is needed/);
		expect(r.count, run.lines.join('\n')).toBe(1);
	});
});

describe('acquireNotingOnce', () => {
	it('passes every note of a successful acquire on, in order', async () => {
		const notes: string[] = [];
		const r = await acquireNotingOnce(
			(m) => notes.push(m),
			async (note) => {
				note('first');
				note('LOCKED');
				return {exitCode: 0, message: 'LOCKED'};
			},
		);
		expect(r.message).toBe('LOCKED');
		expect(notes).toEqual(['first', 'LOCKED']);
	});

	it("drops a refusal's own message (the result line) and keeps the rest", async () => {
		const notes: string[] = [];
		const r = await acquireNotingOnce(
			(m) => notes.push(m),
			async (note) => {
				note('fetching');
				note('lost the race');
				return {exitCode: 2, message: 'lost the race'};
			},
		);
		expect(r.exitCode).toBe(2);
		expect(notes).toEqual(['fetching']);
	});
});
