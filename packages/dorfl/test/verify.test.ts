import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {rmrf} from './helpers/gitRepo.js';
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	readdirSync,
	rmSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	runVerify,
	resolveVerifyCommands,
	VerifyNotConfiguredError,
	VERIFY_NOT_CONFIGURED_MESSAGE,
} from '../src/verify.js';

describe('resolveVerifyCommands', () => {
	it('THROWS VerifyNotConfiguredError when unset (there is NO default gate)', () => {
		expect(() => resolveVerifyCommands(undefined)).toThrow(
			VerifyNotConfiguredError,
		);
		expect(() => resolveVerifyCommands(undefined)).toThrow(
			VERIFY_NOT_CONFIGURED_MESSAGE,
		);
	});

	it('wraps a single configured string command into a one-element list', () => {
		expect(resolveVerifyCommands('make check')).toEqual(['make check']);
	});

	it('keeps an ordered list of commands as-is', () => {
		expect(resolveVerifyCommands(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
	});

	it('THROWS when the config is empty / all-blank (no silent default fallback)', () => {
		expect(() => resolveVerifyCommands(['', '   '])).toThrow(
			VerifyNotConfiguredError,
		);
		expect(() => resolveVerifyCommands('')).toThrow(VerifyNotConfiguredError);
		expect(() => resolveVerifyCommands([])).toThrow(VerifyNotConfiguredError);
	});
});

describe('runVerify — gate status propagation', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'dorfl-verify-'));
	});
	afterEach(() => {
		rmrf(dir);
	});

	it('exits 0 when the gate passes', async () => {
		const result = await runVerify({
			cwd: dir,
			verify: 'exit 0',
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.exitCode).toBe(0);
		expect(result.passed).toBe(true);
	});

	it('exits non-zero when the gate fails, propagating its code', async () => {
		const result = await runVerify({
			cwd: dir,
			verify: 'exit 7',
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.exitCode).toBe(7);
		expect(result.passed).toBe(false);
	});

	it('runs a custom configured command (string)', async () => {
		const marker = join(dir, 'ran.txt');
		const result = await runVerify({
			cwd: dir,
			verify: `echo configured > ${JSON.stringify(marker)}`,
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.exitCode).toBe(0);
		expect(readFileSync(marker, 'utf8').trim()).toBe('configured');
	});

	it('returns a FAILING notConfigured result when verify is unset (never runs a default, never throws)', async () => {
		let err = '';
		const result = await runVerify({
			cwd: dir,
			verify: undefined,
			onStdout: () => {},
			onStderr: (chunk) => {
				err += chunk;
			},
		});
		expect(result.passed).toBe(false);
		expect(result.exitCode).toBe(1);
		expect(result.notConfigured).toBe(true);
		expect(result.commands).toEqual([]);
		// The precise, actionable reason is streamed to stderr for the human.
		expect(err).toContain('no `verify` gate is configured');
	});

	it('returns notConfigured for an all-blank list too (no vacuous green)', async () => {
		const result = await runVerify({
			cwd: dir,
			verify: ['', '   '],
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.passed).toBe(false);
		expect(result.notConfigured).toBe(true);
	});

	it('runs an ordered list in sequence and short-circuits on the first failure', async () => {
		const log = join(dir, 'order.log');
		const result = await runVerify({
			cwd: dir,
			verify: [
				`echo one >> ${JSON.stringify(log)}`,
				`echo two >> ${JSON.stringify(log)}; exit 3`,
				`echo three >> ${JSON.stringify(log)}`,
			],
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.exitCode).toBe(3);
		expect(result.passed).toBe(false);
		// The third command must NOT have run (short-circuit on failure).
		expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
			'one',
			'two',
		]);
	});

	it('passes only when every command in the list passes', async () => {
		const result = await runVerify({
			cwd: dir,
			verify: ['true', 'true', 'true'],
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.exitCode).toBe(0);
		expect(result.passed).toBe(true);
	});

	it('streams stdout and stderr to the provided sinks', async () => {
		let out = '';
		let err = '';
		const result = await runVerify({
			cwd: dir,
			verify: 'echo to-out; echo to-err 1>&2',
			onStdout: (chunk) => {
				out += chunk;
			},
			onStderr: (chunk) => {
				err += chunk;
			},
		});
		expect(result.exitCode).toBe(0);
		expect(out).toContain('to-out');
		expect(err).toContain('to-err');
	});

	it('runs the gate in the given cwd', async () => {
		let out = '';
		await runVerify({
			cwd: dir,
			verify: 'pwd',
			onStdout: (chunk) => {
				out += chunk;
			},
			onStderr: () => {},
		});
		// macOS /tmp is a symlink to /private/tmp; compare on the basename tail.
		expect(out).toContain(dir.split('/').pop() as string);
	});

	it('does not move or commit anything under work/ (read-only gate)', async () => {
		// Seed a work/ tree; a passing AND a failing gate must both leave it intact.
		const workInProgress = join(dir, 'work', 'in-progress');
		const workDone = join(dir, 'work', 'tasks', 'done');
		mkdirSync(workInProgress, {recursive: true});
		mkdirSync(workDone, {recursive: true});
		writeFileSync(join(workInProgress, 'task.md'), '# task');

		const snapshot = () => ({
			inProgress: readdirSync(workInProgress).sort(),
			done: readdirSync(workDone).sort(),
		});
		const before = snapshot();

		await runVerify({
			cwd: dir,
			verify: 'exit 0',
			onStdout: () => {},
			onStderr: () => {},
		});
		await runVerify({
			cwd: dir,
			verify: 'exit 1',
			onStdout: () => {},
			onStderr: () => {},
		});

		expect(snapshot()).toEqual(before);
		expect(before.inProgress).toEqual(['task.md']);
		expect(before.done).toEqual([]);
	});
});
