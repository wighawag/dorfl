import {describe, it, expect, beforeEach, afterEach} from 'vitest';
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
	DEFAULT_VERIFY_COMMAND,
} from '../src/verify.js';

describe('resolveVerifyCommands', () => {
	it('uses the sensible pnpm -r default when unset', () => {
		expect(resolveVerifyCommands(undefined)).toEqual([DEFAULT_VERIFY_COMMAND]);
		expect(DEFAULT_VERIFY_COMMAND).toBe(
			'pnpm -r build && pnpm -r test && pnpm -r format:check',
		);
	});

	it('wraps a single configured string command into a one-element list', () => {
		expect(resolveVerifyCommands('make check')).toEqual(['make check']);
	});

	it('keeps an ordered list of commands as-is', () => {
		expect(resolveVerifyCommands(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
	});

	it('drops blank entries and falls back to the default if nothing remains', () => {
		expect(resolveVerifyCommands(['', '   '])).toEqual([
			DEFAULT_VERIFY_COMMAND,
		]);
		expect(resolveVerifyCommands('')).toEqual([DEFAULT_VERIFY_COMMAND]);
	});
});

describe('runVerify — gate status propagation', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'agent-runner-verify-'));
	});
	afterEach(() => {
		rmSync(dir, {recursive: true, force: true});
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

	it('runs the default gate when verify is unset (and reports the default command)', async () => {
		// Stub `pnpm` on PATH so the default `pnpm -r ...` gate runs without a
		// real workspace; the point is that "unset" resolves to the default.
		const binDir = join(dir, 'bin');
		mkdirSync(binDir);
		const pnpm = join(binDir, 'pnpm');
		writeFileSync(pnpm, '#!/usr/bin/env bash\nexit 0\n', {mode: 0o755});
		const result = await runVerify({
			cwd: dir,
			verify: undefined,
			env: {...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}`},
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.commands).toEqual([DEFAULT_VERIFY_COMMAND]);
		expect(result.exitCode).toBe(0);
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
		writeFileSync(join(workInProgress, 'slice.md'), '# slice');

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
		expect(before.inProgress).toEqual(['slice.md']);
		expect(before.done).toEqual([]);
	});
});
