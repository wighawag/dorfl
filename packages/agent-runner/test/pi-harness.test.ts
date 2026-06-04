import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	chmodSync,
} from 'node:fs';
import {
	PiHarness,
	createHarness,
	piSessionDir,
	piSessionExists,
	PI_SESSION_DIRNAME,
	DEFAULT_PI_BIN,
} from '../src/pi-harness.js';
import {NullHarness, resolveHarness} from '../src/harness.js';
import {makeScratch, type Scratch} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-pi-');
});
afterEach(() => {
	scratch.cleanup();
});

/**
 * Write an executable shell STUB standing in for the `pi` CLI (running real pi
 * in CI is impractical — it needs a model/provider/network). The stub records
 * the args it was called with, the cwd, and the prompt it received on stdin, so
 * the test can assert the adapter invoked pi correctly. `exitCode` lets a test
 * simulate a failed agent run.
 */
function writePiStub(opts: {exitCode?: number} = {}): {
	bin: string;
	argsFile: string;
	cwdFile: string;
	stdinFile: string;
} {
	const bin = join(scratch.root, 'pi-stub.sh');
	const argsFile = join(scratch.root, 'pi-args.txt');
	const cwdFile = join(scratch.root, 'pi-cwd.txt');
	const stdinFile = join(scratch.root, 'pi-stdin.txt');
	const exit = opts.exitCode ?? 0;
	const script = [
		'#!/usr/bin/env bash',
		`printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
		`pwd > ${JSON.stringify(cwdFile)}`,
		`cat > ${JSON.stringify(stdinFile)}`,
		// Honour --session-dir by creating it (real pi writes session files there).
		'session_dir=""',
		'prev=""',
		'for a in "$@"; do',
		'  if [ "$prev" = "--session-dir" ]; then session_dir="$a"; fi',
		'  prev="$a"',
		'done',
		'if [ -n "$session_dir" ]; then mkdir -p "$session_dir"; fi',
		`exit ${exit}`,
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return {bin, argsFile, cwdFile, stdinFile};
}

describe('PiHarness — invocation (stubbed pi CLI)', () => {
	it('runs the pi CLI in the job worktree with the work-agent prompt on stdin', () => {
		const stub = writePiStub();
		const harness = new PiHarness({piBin: stub.bin});
		const dir = join(scratch.root, 'worktree');
		mkdirSync(dir, {recursive: true});

		const result = harness.launch({
			dir,
			slug: 'feat',
			command: 'ignored-by-pi',
			prompt: 'WRAPPER + slice ## Prompt body',
		});

		expect(result.ok).toBe(true);
		// pi ran in the JOB WORKTREE (cwd), not the runner's cwd.
		expect(readFileSync(stub.cwdFile, 'utf8').trim()).toBe(dir);
		// The standard work-agent prompt was fed on stdin.
		expect(readFileSync(stub.stdinFile, 'utf8')).toContain(
			'WRAPPER + slice ## Prompt body',
		);
	});

	it('invokes pi non-interactively (--print) with a session dir under the worktree', () => {
		const stub = writePiStub();
		const harness = new PiHarness({piBin: stub.bin});
		const dir = join(scratch.root, 'worktree');
		mkdirSync(dir, {recursive: true});

		harness.launch({dir, slug: 'feat', command: '', prompt: 'p'});

		const args = readFileSync(stub.argsFile, 'utf8').split('\n');
		expect(args).toContain('--print');
		expect(args).toContain('--session-dir');
		expect(args).toContain(piSessionDir(dir));
	});

	it('records adapter=pi, the PID, the command, and the session pointer', () => {
		const stub = writePiStub();
		const harness = new PiHarness({piBin: stub.bin});
		const dir = join(scratch.root, 'worktree');
		mkdirSync(dir, {recursive: true});

		const result = harness.launch({
			dir,
			slug: 'feat',
			command: '',
			prompt: 'p',
		});

		expect(result.record.adapter).toBe('pi');
		expect(typeof result.record.pid).toBe('number');
		expect(result.record.command).toContain(stub.bin);
		expect(result.record.command).toContain('--print');
		// The session pointer (pi-native audit trail) is recorded, NOT an mtime.
		expect(result.record.session).toBe(piSessionDir(dir));
	});

	it('passes operator extraArgs (e.g. a pinned model) through to pi', () => {
		const stub = writePiStub();
		const harness = new PiHarness({
			piBin: stub.bin,
			extraArgs: ['--model', 'anthropic/claude-sonnet-4'],
		});
		const dir = join(scratch.root, 'worktree');
		mkdirSync(dir, {recursive: true});

		harness.launch({dir, slug: 'feat', command: '', prompt: 'p'});

		const args = readFileSync(stub.argsFile, 'utf8');
		expect(args).toContain('--model');
		expect(args).toContain('anthropic/claude-sonnet-4');
	});

	it('reports a non-zero pi exit as not ok, with detail', () => {
		const stub = writePiStub({exitCode: 5});
		const harness = new PiHarness({piBin: stub.bin});
		const dir = join(scratch.root, 'worktree');
		mkdirSync(dir, {recursive: true});

		const result = harness.launch({
			dir,
			slug: 'feat',
			command: '',
			prompt: 'p',
		});

		expect(result.ok).toBe(false);
		expect(result.detail).toBeDefined();
	});

	it('creates the pi session dir/log under the worktree (the audit trail)', () => {
		const stub = writePiStub();
		const harness = new PiHarness({piBin: stub.bin});
		const dir = join(scratch.root, 'worktree');
		mkdirSync(dir, {recursive: true});

		const result = harness.launch({
			dir,
			slug: 'feat',
			command: '',
			prompt: 'p',
		});

		expect(existsSync(piSessionDir(dir))).toBe(true);
		expect(piSessionExists(result.record)).toBe(true);
	});
});

describe('PiHarness — liveness (PID + session pointer, NOT mtime)', () => {
	it('a finished synchronous pi run is not alive (PID gone, not mtime)', () => {
		const stub = writePiStub();
		const harness = new PiHarness({piBin: stub.bin});
		const dir = join(scratch.root, 'worktree');
		mkdirSync(dir, {recursive: true});

		const result = harness.launch({
			dir,
			slug: 'feat',
			command: '',
			prompt: 'p',
		});
		// pi ran synchronously to completion, so its process is gone.
		expect(harness.isAlive(result.record)).toBe(false);
	});

	it('liveness comes from the PID table, never filesystem mtime', () => {
		const harness = new PiHarness();
		// A PID we know is dead vs. our own live PID — distinguished by the OS
		// process table, never by an mtime (a thinking agent writes no files).
		expect(
			harness.isAlive({adapter: 'pi', pid: 2 ** 31 - 1, session: '/nope'}),
		).toBe(false);
		expect(
			harness.isAlive({adapter: 'pi', pid: process.pid, session: '/nope'}),
		).toBe(true);
	});

	it('surfaces the session dir/log pointer alongside PID liveness', () => {
		const harness = new PiHarness();
		const sessionDir = join(scratch.root, 'a-session');
		mkdirSync(sessionDir, {recursive: true});
		const record = {
			adapter: 'pi' as const,
			pid: process.pid,
			session: sessionDir,
		};
		expect(harness.sessionPointer(record)).toBe(sessionDir);
		expect(piSessionExists(record)).toBe(true);
	});

	it('a recorded-but-missing session is reported as not present (not mtime)', () => {
		const record = {
			adapter: 'pi' as const,
			pid: process.pid,
			session: join(scratch.root, 'gone'),
		};
		expect(piSessionExists(record)).toBe(false);
	});
});

describe('harness registry — status/watch resolve pi liveness to the pi adapter', () => {
	it('resolveHarness dispatches a pi record to the PiHarness', () => {
		const resolved = resolveHarness({adapter: 'pi', pid: 1});
		expect(resolved.adapter).toBe('pi');
	});

	it('resolveHarness falls back to the null adapter for unknown adapters', () => {
		const resolved = resolveHarness({adapter: 'something-else', pid: 1});
		expect(resolved.adapter).toBe('null');
	});

	it('a hung/dead pi job is detectable for watch rails (PID dead ⇒ not alive)', () => {
		const resolved = resolveHarness({adapter: 'pi', pid: 2 ** 31 - 1});
		// watch's failure rail asks the harness; a dead PID ⇒ not alive ⇒ act.
		expect(resolved.isAlive({adapter: 'pi', pid: 2 ** 31 - 1})).toBe(false);
	});
});

describe('createHarness — config selects the launch adapter', () => {
	it('builds the pi adapter when harness is "pi"', () => {
		const h = createHarness({harness: 'pi'});
		expect(h.adapter).toBe('pi');
		expect(h).toBeInstanceOf(PiHarness);
	});

	it('builds the null adapter by default / when harness is "null"', () => {
		expect(createHarness({}).adapter).toBe('null');
		expect(createHarness({harness: 'null'})).toBeInstanceOf(NullHarness);
	});

	it('exposes stable seam constants', () => {
		expect(DEFAULT_PI_BIN).toBe('pi');
		expect(PI_SESSION_DIRNAME).toContain('pi');
	});
});
