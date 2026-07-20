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
	VERIFY_OUTPUT_TAIL_LINES,
} from '../src/verify.js';
import {formatGateFailureContext} from '../src/integration-core.js';

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

	it('captures the FAILED command + its output tail (the surfaced-question context)', async () => {
		const result = await runVerify({
			cwd: dir,
			verify: [
				'echo build-ok',
				'echo "no changesets were found" 1>&2; exit 1',
				'echo never-runs',
			],
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.passed).toBe(false);
		// It names the SPECIFIC command that failed (not the first, not the whole gate).
		expect(result.failedCommand).toBe(
			'echo "no changesets were found" 1>&2; exit 1',
		);
		// The tail carries the ACTUAL error text (stderr is captured too).
		expect(result.outputTail).toContain('no changesets were found');
		// Only the FAILING command's output is retained (not the prior green step).
		expect(result.outputTail).not.toContain('build-ok');
	});

	it('bounds the captured tail to VERIFY_OUTPUT_TAIL_LINES non-empty lines', async () => {
		const result = await runVerify({
			cwd: dir,
			verify: `for i in $(seq 1 100); do echo line-$i; done; exit 1`,
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.passed).toBe(false);
		const lines = (result.outputTail ?? '').split('\n');
		expect(lines.length).toBeLessThanOrEqual(VERIFY_OUTPUT_TAIL_LINES);
		// It keeps the LAST lines (the most recent, where errors usually are).
		expect(result.outputTail).toContain('line-100');
		expect(result.outputTail).not.toContain('line-1\n');
	});

	it('leaves failedCommand/outputTail unset on a passing gate', async () => {
		const result = await runVerify({
			cwd: dir,
			verify: ['true', 'true'],
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.passed).toBe(true);
		expect(result.failedCommand).toBeUndefined();
		expect(result.outputTail).toBeUndefined();
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

describe('formatGateFailureContext — the enriched bounce-reason tail', () => {
	it('names the failed command and quotes its output tail', () => {
		const ctx = formatGateFailureContext({
			failedCommand: 'pnpm changeset status --since=main',
			outputTail: 'error Some packages have been changed but no changesets…',
		});
		expect(ctx).toContain('the failing step was:');
		expect(ctx).toContain('pnpm changeset status --since=main');
		expect(ctx).toContain('its last output was:');
		expect(ctx).toContain('no changesets');
		// It is an APPENDABLE tail (starts with the em-dash separator).
		expect(ctx.startsWith(' — ')).toBe(true);
	});

	it('degrades to an empty string when nothing is known (older result / prepare failure)', () => {
		expect(formatGateFailureContext({})).toBe('');
		expect(
			formatGateFailureContext({failedCommand: '   ', outputTail: ''}),
		).toBe('');
	});

	it('includes just the command when the tail is empty', () => {
		const ctx = formatGateFailureContext({failedCommand: 'pnpm test'});
		expect(ctx).toContain('pnpm test');
		expect(ctx).not.toContain('its last output was:');
	});
});
