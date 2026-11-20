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
	detectEnvironmentalGateFailure,
} from '../src/verify.js';
import {formatGateFailureContext} from '../src/integration-core.js';
import {
	makeBashrcProbe,
	parseProbe,
	PATH_MARKER,
	PROBE_COMMAND,
	type BashrcProbe,
} from './helpers/bashrcProbe.js';

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
		// It is an APPENDABLE tail (starts with a colon separator; text dorfl
		// commits never carries an em dash).
		expect(ctx.startsWith(': ')).toBe(true);
		expect(ctx).not.toContain('\u2014');
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

/**
 * Regression (dorfl 0.15.1, NixOS): the gate's `bash -c` must NOT take bash's
 * "run by rshd/sshd" startup path. With piped (socketpair) stdin and no SHLVL,
 * bash sourced the system bashrc + ~/.bashrc, which on NixOS reset PATH, so
 * tools the caller had on PATH (openssl) vanished inside the gate.
 */
describe('runVerify: the gate shell keeps the caller env (no rc sourcing)', () => {
	let dir: string;
	let probe: BashrcProbe;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'dorfl-verify-rc-'));
		probe = makeBashrcProbe();
	});
	afterEach(() => {
		rmrf(dir);
		probe.cleanup();
	});

	it('does not source ~/.bashrc and keeps every caller PATH entry', async () => {
		let stdout = '';
		const result = await runVerify({
			cwd: dir,
			verify: PROBE_COMMAND,
			env: probe.env,
			onStdout: (c) => (stdout += c),
			onStderr: () => {},
		});
		expect(result.passed).toBe(true);
		const seen = parseProbe(stdout);
		expect(seen.rc).toBe('no');
		expect(seen.path.split(':')[0]).toBe(PATH_MARKER);
	});

	it('gives the gate an EOF stdin (a stdin-reading command cannot hang)', async () => {
		let stdout = '';
		const result = await runVerify({
			cwd: dir,
			verify: 'cat; echo eof-reached',
			onStdout: (c) => (stdout += c),
			onStderr: () => {},
		});
		expect(result.passed).toBe(true);
		expect(stdout).toContain('eof-reached');
	});
});

/**
 * Regression (dorfl 0.16.0, rocketh-playground): a gate that failed only because
 * another project's e2e run held the ports the Playwright suite binds was
 * surfaced as a question about the WORK. The gate now recognises an
 * address-in-use failure, retries the failing step after a wait, and reports a
 * persisting one as environmental.
 */
describe('runVerify: environmental (address-in-use) gate failures', () => {
	let dir: string;
	const sleeps: number[] = [];
	const sleep = async (ms: number) => {
		sleeps.push(ms);
	};
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'dorfl-verify-env-'));
		sleeps.length = 0;
	});
	afterEach(() => rmrf(dir));

	const PLAYWRIGHT =
		'Error: http://localhost:4273 is already used, make sure that nothing is ' +
		'running on the port/url or set reuseExistingServer:true in config.webServer.';

	it('recognises the address-in-use signatures, and nothing else', () => {
		expect(detectEnvironmentalGateFailure(PLAYWRIGHT)).toMatch(/4273/);
		expect(
			detectEnvironmentalGateFailure('Error: listen EADDRINUSE: :::3000'),
		).toMatch(/EADDRINUSE/);
		expect(
			detectEnvironmentalGateFailure(
				'OSError: [Errno 98] Address already in use',
			),
		).toMatch(/already in use/);
		expect(detectEnvironmentalGateFailure('Port 5173 is in use')).toMatch(
			/5173/,
		);
		expect(
			detectEnvironmentalGateFailure('AssertionError: expected 1 to be 2'),
		).toBeUndefined();
		expect(detectEnvironmentalGateFailure(undefined)).toBeUndefined();
	});

	it('retries the failing step after a wait and passes once the port is free', async () => {
		const counter = join(dir, 'count');
		// Fails with the Playwright message on the first run, passes on the second.
		const cmd =
			`n=$(cat ${counter} 2>/dev/null || echo 0); echo $((n+1)) > ${counter}; ` +
			`if [ "$n" = 0 ]; then echo '${PLAYWRIGHT}' >&2; exit 1; fi; exit 0`;
		const result = await runVerify({
			cwd: dir,
			verify: ['true', cmd],
			environmentalRetryDelaysMs: [5, 7],
			sleep,
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.passed).toBe(true);
		expect(sleeps).toEqual([5]);
		expect(readFileSync(counter, 'utf8').trim()).toBe('2');
	});

	it('reports a persisting address-in-use failure as environmental after the retries', async () => {
		const result = await runVerify({
			cwd: dir,
			verify: `echo '${PLAYWRIGHT}' >&2; exit 1`,
			environmentalRetryDelaysMs: [1, 2],
			sleep,
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.passed).toBe(false);
		expect(result.environmental).toMatch(/4273/);
		expect(result.environmentalRetries).toBe(2);
		expect(sleeps).toEqual([1, 2]);
		const ctx = formatGateFailureContext(result);
		expect(ctx).toMatch(/ENVIRONMENTAL, not the work/);
		expect(ctx).toMatch(/retried 2 times/);
	});

	it('never retries a genuine failure', async () => {
		const result = await runVerify({
			cwd: dir,
			verify: 'echo "expected 1 to be 2" >&2; exit 1',
			environmentalRetryDelaysMs: [1, 2],
			sleep,
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.passed).toBe(false);
		expect(result.environmental).toBeUndefined();
		expect(sleeps).toEqual([]);
	});

	it('DORFL_GATE_ENV_RETRY_DELAYS_MS= (empty) disables the retry but still classifies', async () => {
		const result = await runVerify({
			cwd: dir,
			verify: `echo '${PLAYWRIGHT}' >&2; exit 1`,
			env: {...process.env, DORFL_GATE_ENV_RETRY_DELAYS_MS: ''},
			sleep,
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.environmental).toMatch(/4273/);
		expect(result.environmentalRetries).toBe(0);
		expect(sleeps).toEqual([]);
	});
});
