import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {isAbsolute, join} from 'node:path';
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
	piSessionExists,
	DEFAULT_PI_BIN,
} from '../src/pi-harness.js';
import {generateSessionPath} from '../src/session-path.js';
import {NullHarness, resolveHarness} from '../src/harness.js';
import {
	makeScratch,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-pi-');
	// Isolate pi's session storage to a scratch dir (see do-watch.test.ts) so the
	// default-path launches do not pollute the real ~/.pi/agent/sessions/.
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
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
		// Honour --session <file> by creating it (real pi creates+writes the file).
		'session_file=""',
		'prev=""',
		'for a in "$@"; do',
		'  if [ "$prev" = "--session" ]; then session_file="$a"; fi',
		'  prev="$a"',
		'done',
		'if [ -n "$session_file" ]; then mkdir -p "$(dirname "$session_file")"; : > "$session_file"; fi',
		`exit ${exit}`,
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return {bin, argsFile, cwdFile, stdinFile};
}

/** Read back the `--session <path>` arg the stub recorded. */
function recordedSessionArg(argsFile: string): string | undefined {
	const args = readFileSync(argsFile, 'utf8').split('\n');
	const i = args.indexOf('--session');
	return i >= 0 ? args[i + 1] : undefined;
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

	it('invokes pi non-interactively (--print) with --session <abs .jsonl path>, NOT --session-dir', () => {
		const stub = writePiStub();
		const harness = new PiHarness({piBin: stub.bin});
		const dir = join(scratch.root, 'worktree');
		mkdirSync(dir, {recursive: true});

		// The caller generates the full session FILE path and threads it in.
		const session = generateSessionPath({cwd: dir, id: 'feat'});
		harness.launch({dir, slug: 'feat', command: '', prompt: 'p', session});

		const args = readFileSync(stub.argsFile, 'utf8').split('\n');
		expect(args).toContain('--print');
		// `--session <full-path>` is passed; `--session-dir` is GONE (it was
		// overridden + misleading; the fix removes it).
		expect(args).toContain('--session');
		expect(args).not.toContain('--session-dir');
		// The path-shape invariant: absolute + ends `.jsonl` (a bare id would make
		// pi treat it as a session-ID lookup and exit 1).
		const arg = recordedSessionArg(stub.argsFile);
		expect(arg).toBe(session);
		expect(isAbsolute(arg!)).toBe(true);
		expect(arg!.endsWith('.jsonl')).toBe(true);
	});

	it('generates a default session path (absolute, .jsonl) when the caller passes none', () => {
		const stub = writePiStub();
		const harness = new PiHarness({piBin: stub.bin});
		const dir = join(scratch.root, 'worktree');
		mkdirSync(dir, {recursive: true});

		harness.launch({dir, slug: 'feat', command: '', prompt: 'p'});

		const arg = recordedSessionArg(stub.argsFile);
		expect(arg).toBeDefined();
		expect(isAbsolute(arg!)).toBe(true);
		expect(arg!.endsWith('.jsonl')).toBe(true);
	});

	it('records adapter=pi, the PID, the command, and the EXACT session file path', () => {
		const stub = writePiStub();
		const harness = new PiHarness({piBin: stub.bin});
		const dir = join(scratch.root, 'worktree');
		mkdirSync(dir, {recursive: true});

		const session = generateSessionPath({cwd: dir, id: 'feat'});
		const result = harness.launch({
			dir,
			slug: 'feat',
			command: '',
			prompt: 'p',
			session,
		});

		expect(result.record.adapter).toBe('pi');
		expect(typeof result.record.pid).toBe('number');
		expect(result.record.command).toContain(stub.bin);
		expect(result.record.command).toContain('--print');
		// The session pointer (pi-native audit trail) records the EXACT path pi used.
		expect(result.record.session).toBe(session);
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

	it('records a session file that pi created at the exact path (the audit trail), NOT in the checkout', () => {
		const stub = writePiStub();
		const harness = new PiHarness({piBin: stub.bin});
		const dir = join(scratch.root, 'worktree');
		mkdirSync(dir, {recursive: true});

		// Generate the session path OUTSIDE the worktree (the default behaviour).
		const sessionsRoot = join(scratch.root, 'sessions-root');
		const session = generateSessionPath({
			sessionsDir: sessionsRoot,
			cwd: dir,
			id: 'feat',
		});
		const result = harness.launch({
			dir,
			slug: 'feat',
			command: '',
			prompt: 'p',
			session,
		});

		// pi created the session file at the exact recorded path.
		expect(result.record.session).toBe(session);
		expect(existsSync(session)).toBe(true);
		expect(piSessionExists(result.record)).toBe(true);
		// Nothing was written INTO the worktree (no checkout pollution).
		expect(existsSync(join(dir, '.agent-runner-pi-session'))).toBe(false);
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
	});
});
