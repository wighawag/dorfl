import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	decideForward,
	performForward,
	maybeForward,
	defaultRepoCmdReader,
	forwardNotice,
	FORWARDED_ENV_MARKER,
	NO_FORWARD_ENV,
	NO_FORWARD_FLAG,
	stripNoForwardFlag,
	type ForwardSpawn,
	type ForwardSpawnResult,
	type RepoCmdReader,
} from '../src/bootstrap-forward.js';
import {REPO_CONFIG_FILENAME} from '../src/repo-config.js';
import {runPrepare} from '../src/prepare.js';
import {rmrf} from './helpers/gitRepo.js';

/**
 * The bootstrap SELF-FORWARD (spec `dorfl-self-version-pinning-and-bootstrap-forward`
 * §2/§4; task `dorfl-bootstrap-self-forward`, stories 1/4/5). The global `dorfl`
 * is a thin bootstrap: at startup, BEFORE dispatch, it reads the nearest repo
 * `dorfl.json`; a declared `dorflCmd` (that is not us) is exec'd verbatim with the
 * ORIGINAL argv + env, after a one-line STDERR notice, and its exit code becomes
 * ours.
 *
 * Every test drives the exec via an INJECTABLE seam (a stubbed spawn) + an
 * injected repo-cmd reader — NO real re-exec of a second dorfl, no network. The
 * few filesystem tests isolate `dorfl.json` in a fresh mkdtemp scratch dir (no
 * shared location written).
 */

/** A spawn stub that records every invocation and returns a scripted result. */
function recordingSpawn(result: ForwardSpawnResult): {
	spawn: ForwardSpawn;
	calls: Array<{cmd: string; forwardedArgs: string[]; env: NodeJS.ProcessEnv}>;
} {
	const calls: Array<{
		cmd: string;
		forwardedArgs: string[];
		env: NodeJS.ProcessEnv;
	}> = [];
	const spawn: ForwardSpawn = ({cmd, forwardedArgs, env}) => {
		calls.push({cmd, forwardedArgs: [...forwardedArgs], env});
		return result;
	};
	return {spawn, calls};
}

/** A reader stub returning a fixed cmd/configPath (no filesystem). */
function readerReturning(
	cmd: string | undefined,
	configPath = '/scratch/dorfl.json',
): RepoCmdReader {
	return () => ({cmd, configPath});
}

const ARGV = (...userArgs: string[]): string[] => [
	'/usr/bin/node',
	'/global/bin/dorfl',
	...userArgs,
];

describe('decideForward — the pure startup decision', () => {
	it('FORWARDS when a dorflCmd is declared and we are a fresh bootstrap', () => {
		const decision = decideForward({
			argv: ARGV('status', '--json'),
			env: {},
			cwd: '/repo',
			readRepoCmd: readerReturning('npx dorfl@0.7.0', '/repo/dorfl.json'),
		});
		expect(decision).toEqual({
			kind: 'forward',
			cmd: 'npx dorfl@0.7.0',
			configPath: '/repo/dorfl.json',
		});
	});

	it('runs SELF when NO dorflCmd is declared (onboarding-safe)', () => {
		const decision = decideForward({
			argv: ARGV('setup'),
			env: {},
			cwd: '/repo',
			readRepoCmd: readerReturning(undefined),
		});
		expect(decision).toEqual({kind: 'run-self', reason: 'no-cmd'});
	});

	it('runs SELF (loop-safe) when the FORWARDED env marker is already set', () => {
		const decision = decideForward({
			argv: ARGV('status'),
			env: {[FORWARDED_ENV_MARKER]: '1'},
			cwd: '/repo',
			// Even with a dorflCmd pointing back at dorfl, the child must NOT re-forward.
			readRepoCmd: readerReturning('node_modules/.bin/dorfl'),
		});
		expect(decision).toEqual({kind: 'run-self', reason: 'already-forwarded'});
	});

	it('runs SELF (opted out) on --no-forward even with a dorflCmd', () => {
		const decision = decideForward({
			argv: ARGV('status', NO_FORWARD_FLAG),
			env: {},
			cwd: '/repo',
			readRepoCmd: readerReturning('npx dorfl@0.7.0'),
		});
		expect(decision).toEqual({kind: 'run-self', reason: 'opted-out'});
	});

	it('runs SELF (opted out) on DORFL_NO_FORWARD=1 even with a dorflCmd', () => {
		const decision = decideForward({
			argv: ARGV('status'),
			env: {[NO_FORWARD_ENV]: '1'},
			cwd: '/repo',
			readRepoCmd: readerReturning('npx dorfl@0.7.0'),
		});
		expect(decision).toEqual({kind: 'run-self', reason: 'opted-out'});
	});

	it('treats DORFL_NO_FORWARD="" / "0" as NOT opted out (still forwards)', () => {
		for (const value of ['', '0']) {
			const decision = decideForward({
				argv: ARGV('status'),
				env: {[NO_FORWARD_ENV]: value},
				cwd: '/repo',
				readRepoCmd: readerReturning('npx dorfl@0.7.0'),
			});
			expect(decision.kind).toBe('forward');
		}
	});
});

describe('performForward — acting on the decision (forward happens)', () => {
	it('execs the dorflCmd with the USER argv + FORWARDED marker, returns exit code', () => {
		const {spawn, calls} = recordingSpawn({kind: 'exited', code: 0});
		const notices: string[] = [];
		const outcome = performForward({
			decision: {
				kind: 'forward',
				cmd: 'npx dorfl@0.7.0',
				configPath: '/repo/dorfl.json',
			},
			argv: ARGV('do', 'task:foo', '--json'),
			env: {PATH: '/bin', SOME: 'value'},
			spawn,
			writeNotice: (line) => notices.push(line),
		});

		expect(outcome).toEqual({kind: 'forwarded', exitCode: 0});
		expect(calls).toHaveLength(1);
		// ORIGINAL user argv (index 2+) passed through — NOT node/script.
		expect(calls[0].forwardedArgs).toEqual(['do', 'task:foo', '--json']);
		expect(calls[0].cmd).toBe('npx dorfl@0.7.0');
		// env inherited + the loop-safe marker SET on the child.
		expect(calls[0].env.SOME).toBe('value');
		expect(calls[0].env.PATH).toBe('/bin');
		expect(calls[0].env[FORWARDED_ENV_MARKER]).toBe('1');
	});

	it('propagates the child exit code verbatim (transparent passthrough)', () => {
		for (const code of [0, 1, 2, 42]) {
			const {spawn} = recordingSpawn({kind: 'exited', code});
			const outcome = performForward({
				decision: {kind: 'forward', cmd: 'x', configPath: 'p'},
				argv: ARGV('status'),
				env: {},
				spawn,
				writeNotice: () => {},
			});
			expect(outcome).toEqual({kind: 'forwarded', exitCode: code});
		}
	});

	it('does NOT mutate the parent env object when setting the marker', () => {
		const {spawn} = recordingSpawn({kind: 'exited', code: 0});
		const parentEnv: NodeJS.ProcessEnv = {PATH: '/bin'};
		performForward({
			decision: {kind: 'forward', cmd: 'x', configPath: 'p'},
			argv: ARGV('status'),
			env: parentEnv,
			spawn,
			writeNotice: () => {},
		});
		expect(parentEnv[FORWARDED_ENV_MARKER]).toBeUndefined();
	});
});

describe('the notice goes to STDERR only (stdout uncorrupted for --json)', () => {
	it('emits the notice via writeNotice (stderr sink) and nothing to stdout', () => {
		// stdout is modelled as a sink the forward NEVER writes: only the child's
		// inherited stdout carries command output. Here we assert the notice text is
		// the ONLY thing the forward emits, through the stderr sink.
		const {spawn} = recordingSpawn({kind: 'exited', code: 0});
		const stderr: string[] = [];
		performForward({
			decision: {
				kind: 'forward',
				cmd: 'node_modules/.bin/dorfl',
				configPath: './dorfl.json',
			},
			argv: ARGV('status', '--json'),
			env: {},
			spawn,
			writeNotice: (line) => stderr.push(line),
		});
		expect(stderr).toEqual([
			forwardNotice('node_modules/.bin/dorfl', './dorfl.json'),
		]);
		// The notice mentions the cmd + the config path, never machine stdout.
		expect(stderr[0]).toContain('forwarding to');
		expect(stderr[0]).toContain('node_modules/.bin/dorfl');
		expect(stderr[0]).toContain('./dorfl.json');
	});

	it('the opt-out branch emits NO notice at all', () => {
		const {spawn, calls} = recordingSpawn({kind: 'exited', code: 0});
		const stderr: string[] = [];
		const outcome = performForward({
			decision: {kind: 'run-self', reason: 'opted-out'},
			argv: ARGV('status', NO_FORWARD_FLAG),
			env: {},
			spawn,
			writeNotice: (line) => stderr.push(line),
		});
		expect(outcome.kind).toBe('run-self');
		expect(stderr).toEqual([]);
		expect(calls).toHaveLength(0);
	});
});

describe('FAIL LOUD — declared-but-ABSENT dorflCmd (before dependency install)', () => {
	it('a spawn error (target absent) becomes a clear, actionable error + non-zero exit', () => {
		const {spawn} = recordingSpawn({
			kind: 'spawn-error',
			message: 'command not found: node_modules/.bin/dorfl',
		});
		const outcome = performForward({
			decision: {
				kind: 'forward',
				cmd: 'node_modules/.bin/dorfl',
				configPath: '/repo/dorfl.json',
			},
			argv: ARGV('status'),
			env: {},
			spawn,
			writeNotice: () => {},
		});
		expect(outcome.kind).toBe('error');
		if (outcome.kind !== 'error') return;
		expect(outcome.exitCode).not.toBe(0);
		// names the dorflCmd value + the dorfl.json path + the FIX + the bypass.
		expect(outcome.message).toContain('node_modules/.bin/dorfl');
		expect(outcome.message).toContain('/repo/dorfl.json');
		expect(outcome.message).toMatch(/install/i);
		expect(outcome.message).toContain(NO_FORWARD_FLAG);
		expect(outcome.message).toContain(NO_FORWARD_ENV);
		// It is NOT a silent degrade: the outcome is an error, never a run-self.
		expect(outcome.kind).not.toBe('run-self');
	});
});

describe('FAIL LOUD — PRESENT but exec-fails dorflCmd (broken pin)', () => {
	it('a present binary that spawn-errors yields the SAME clear, actionable error', () => {
		const {spawn} = recordingSpawn({
			kind: 'spawn-error',
			message: 'spawn EACCES',
		});
		const outcome = performForward({
			decision: {
				kind: 'forward',
				cmd: './bin/dorfl',
				configPath: '/repo/dorfl.json',
			},
			argv: ARGV('run'),
			env: {},
			spawn,
			writeNotice: () => {},
		});
		expect(outcome.kind).toBe('error');
		if (outcome.kind !== 'error') return;
		expect(outcome.exitCode).not.toBe(0);
		expect(outcome.message).toContain('./bin/dorfl');
		expect(outcome.message).toContain('/repo/dorfl.json');
		expect(outcome.message).toContain(NO_FORWARD_FLAG);
	});

	it('a NON-zero clean exit from a working forward is passthrough, NOT the error', () => {
		// A forwarded dorfl that ran fine but the COMMAND failed (e.g. verify red)
		// must pass its exit code through — that is the pin working, not broken.
		const {spawn} = recordingSpawn({kind: 'exited', code: 1});
		const outcome = performForward({
			decision: {kind: 'forward', cmd: 'npx dorfl@0.7.0', configPath: 'p'},
			argv: ARGV('verify'),
			env: {},
			spawn,
			writeNotice: () => {},
		});
		expect(outcome).toEqual({kind: 'forwarded', exitCode: 1});
	});
});

describe('re-entrancy — the forwarded process does NOT forward again (single hop)', () => {
	it('the child (marker set) reading the SAME dorfl.json runs in-process', () => {
		// Hop 1: the bootstrap forwards, setting the marker on the child env.
		const {spawn, calls} = recordingSpawn({kind: 'exited', code: 0});
		const readRepoCmd = readerReturning('node_modules/.bin/dorfl');
		const first = decideForward({
			argv: ARGV('status'),
			env: {},
			cwd: '/repo',
			readRepoCmd,
		});
		expect(first.kind).toBe('forward');
		performForward({
			decision: first,
			argv: ARGV('status'),
			env: {},
			spawn,
			writeNotice: () => {},
		});
		const childEnv = calls[0].env;
		expect(childEnv[FORWARDED_ENV_MARKER]).toBe('1');

		// Hop 2: the forwarded dorfl decides again with the SAME dorfl.json + the
		// child env — it must run SELF, not forward a second time.
		const second = decideForward({
			argv: ARGV('status'),
			env: childEnv,
			cwd: '/repo',
			readRepoCmd,
		});
		expect(second).toEqual({kind: 'run-self', reason: 'already-forwarded'});
	});
});

describe('both opt-outs disable AND silence the forward', () => {
	it('--no-forward: run-self, no spawn, no notice, and the flag stripped for commander', () => {
		const {spawn, calls} = recordingSpawn({kind: 'exited', code: 0});
		const stderr: string[] = [];
		const outcome = maybeForward({
			argv: ARGV('status', NO_FORWARD_FLAG, '--json'),
			env: {},
			cwd: '/repo',
			readRepoCmd: readerReturning('npx dorfl@0.7.0'),
			spawn,
			writeNotice: (line) => stderr.push(line),
		});
		expect(outcome.kind).toBe('run-self');
		if (outcome.kind !== 'run-self') return;
		// the bootstrap flag is removed so commander (which does not declare it) is clean.
		expect(outcome.argv).toEqual(ARGV('status', '--json'));
		expect(calls).toHaveLength(0);
		expect(stderr).toEqual([]);
	});

	it('DORFL_NO_FORWARD=1: run-self, no spawn, no notice', () => {
		const {spawn, calls} = recordingSpawn({kind: 'exited', code: 0});
		const stderr: string[] = [];
		const outcome = maybeForward({
			argv: ARGV('status'),
			env: {[NO_FORWARD_ENV]: '1'},
			cwd: '/repo',
			readRepoCmd: readerReturning('npx dorfl@0.7.0'),
			spawn,
			writeNotice: (line) => stderr.push(line),
		});
		expect(outcome.kind).toBe('run-self');
		expect(calls).toHaveLength(0);
		expect(stderr).toEqual([]);
	});
});

describe('stripNoForwardFlag', () => {
	it('removes every --no-forward token, preserving order + other args', () => {
		expect(
			stripNoForwardFlag(['do', NO_FORWARD_FLAG, 'task:x', NO_FORWARD_FLAG]),
		).toEqual(['do', 'task:x']);
		expect(stripNoForwardFlag(['status', '--json'])).toEqual([
			'status',
			'--json',
		]);
	});
});

describe('maybeForward — end-to-end run-self when NO dorflCmd (bootstrap runs itself)', () => {
	it('returns run-self with the argv unchanged and never spawns', () => {
		const {spawn, calls} = recordingSpawn({kind: 'exited', code: 0});
		const stderr: string[] = [];
		const outcome = maybeForward({
			argv: ARGV('setup'),
			env: {},
			cwd: '/repo',
			readRepoCmd: readerReturning(undefined),
			spawn,
			writeNotice: (line) => stderr.push(line),
		});
		expect(outcome).toEqual({kind: 'run-self', argv: ARGV('setup')});
		expect(calls).toHaveLength(0);
		expect(stderr).toEqual([]);
	});

	it('a malformed dorfl.json (reader throws) FAILS LOUD, never a silent run-self', () => {
		const throwing: RepoCmdReader = () => {
			throw new Error('Invalid JSON in /repo/dorfl.json: boom');
		};
		const outcome = maybeForward({
			argv: ARGV('status'),
			env: {},
			cwd: '/repo',
			readRepoCmd: throwing,
			spawn: recordingSpawn({kind: 'exited', code: 0}).spawn,
			writeNotice: () => {},
		});
		expect(outcome.kind).toBe('error');
		if (outcome.kind !== 'error') return;
		expect(outcome.message).toContain(REPO_CONFIG_FILENAME);
		expect(outcome.message).toContain(NO_FORWARD_FLAG);
	});
});

describe('the forward is NOT recursive — gate-worktree prepare runs via bash, not a new dorfl', () => {
	let worktree: string;
	beforeEach(() => {
		worktree = mkdtempSync(join(tmpdir(), 'dorfl-worktree-'));
	});
	afterEach(() => {
		rmrf(worktree);
	});

	it('runPrepare spawns bash -c (argv0 = bash), NEVER a new dorfl bin', async () => {
		// This is the load-bearing NON-RECURSION fact (spec §2 / task): the gate
		// worktree that needs prepare is prepared by the ALREADY-RUNNING dorfl, which
		// runs the repo command via spawn('bash', ['-c', cmd]) in the worktree — it
		// NEVER launches a new dorfl. So a fresh worktree's empty node_modules never
		// re-triggers the forward hook (which fires once, at bare-dorfl entry). We
		// prove it by capturing the child's argv0 + its argv, which are bash's, and
		// asserting the dorfl bin name never appears as the process launched.
		const out = join(worktree, 'argv0.txt');
		const result = await runPrepare({
			cwd: worktree,
			// `$0` inside `bash -c` is 'bash' (or the interpreter path) — NOT dorfl.
			prepare: `printf '%s\\n' "$0" > ${JSON.stringify(out).slice(1, -1)}`,
			onStdout: () => {},
			onStderr: () => {},
		});
		expect(result.passed).toBe(true);
		const argv0 = (await import('node:fs')).readFileSync(out, 'utf8').trim();
		// The interpreter that ran the repo command is bash — not the dorfl bin.
		expect(argv0.endsWith('bash') || argv0 === 'bash').toBe(true);
		expect(argv0).not.toContain('dorfl');
	});
});

describe('defaultRepoCmdReader — reads the cwd dorfl.json (isolated fixture)', () => {
	let repo: string;
	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), 'dorfl-forward-'));
	});
	afterEach(() => {
		rmrf(repo);
	});

	it('returns the trimmed dorflCmd + the dorfl.json path when declared', () => {
		writeFileSync(
			join(repo, REPO_CONFIG_FILENAME),
			JSON.stringify({dorflCmd: '  node_modules/.bin/dorfl  '}),
		);
		const {cmd, configPath} = defaultRepoCmdReader(repo);
		expect(cmd).toBe('node_modules/.bin/dorfl');
		expect(configPath).toBe(join(repo, REPO_CONFIG_FILENAME));
	});

	it('returns undefined cmd when NO dorflCmd is declared (onboarding case)', () => {
		writeFileSync(
			join(repo, REPO_CONFIG_FILENAME),
			JSON.stringify({verify: 'true'}),
		);
		expect(defaultRepoCmdReader(repo).cmd).toBeUndefined();
	});

	it('returns undefined cmd when there is NO dorfl.json at all', () => {
		expect(defaultRepoCmdReader(repo).cmd).toBeUndefined();
	});

	it('isolates the fixture under a scratch dir (no shared location written)', () => {
		expect(repo.startsWith(tmpdir())).toBe(true);
	});
});
