import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, readFileSync, chmodSync, existsSync} from 'node:fs';
import {join, isAbsolute, dirname} from 'node:path';
import {performDo} from '../src/do.js';
import {PiHarness} from '../src/pi-harness.js';
import {piDefaultSessionsDir} from '../src/session-path.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `do` session-path tests (slice `session-path-pi-default`) — proving the pi
 * adapter passes `--session <full-absolute-.jsonl-path>` (NOT `--session-dir`),
 * that the resolved `sessionsDir` actually redirects that arg (the silent-no-op
 * guard), that the default lands under pi's default per-cwd root, and that the
 * in-place checkout stays CLEAN (no `.agent-runner-pi-session/` pollution).
 *
 * House style: a throwaway checkout + a local `--bare` arbiter + a STUBBED pi
 * CLI that RECORDS the `--session` arg it received (and edits a file so the
 * completion commit is non-empty + creates the session file at that path). Drives
 * real git + writes `main`, so it lives in the non-parallel project.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-do-session-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * A pi-CLI stub that captures the value of the `--session` arg it was called
 * with (to `sessionArgFile`), edits a file in the worktree (non-empty commit),
 * and creates the session `.jsonl` at exactly that path (as real pi does).
 */
function writePiSessionStub(sessionArgFile: string): string {
	const bin = join(scratch.root, 'pi-session-stub.sh');
	const script = [
		'#!/usr/bin/env bash',
		'cat > /dev/null', // consume the prompt on stdin.
		'session_file=""',
		'prev=""',
		'for a in "$@"; do',
		'  if [ "$prev" = "--session" ]; then session_file="$a"; fi',
		'  prev="$a"',
		'done',
		`printf '%s' "$session_file" > ${JSON.stringify(sessionArgFile)}`,
		"printf 'work done\\n' > agent-output.txt",
		'if [ -n "$session_file" ]; then',
		'  mkdir -p "$(dirname "$session_file")"',
		'  : > "$session_file"',
		'fi',
		'exit 0',
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return bin;
}

describe('do — pi --session <path> generation + sessionsDir override', () => {
	it('passes an ABSOLUTE .jsonl --session path and leaves the checkout clean (default root)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const sessionArgFile = join(scratch.root, 'session-arg.txt');
		const piBin = writePiSessionStub(sessionArgFile);

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			harness: new PiHarness({piBin}),
			env: gitEnv(),
		});

		expect(result.outcome).toBe('completed');
		const sessionArg = readFileSync(sessionArgFile, 'utf8');
		// Path-shape invariant (#1): absolute + ends `.jsonl` (a bare id ⇒ pi exit 1).
		expect(isAbsolute(sessionArg)).toBe(true);
		expect(sessionArg.endsWith('.jsonl')).toBe(true);
		// Default (unset sessionsDir) ⇒ pi's default per-cwd dir (dashboard-visible).
		expect(dirname(sessionArg)).toBe(piDefaultSessionsDir(repo));
		// NO checkout pollution: nothing landed in the working tree.
		expect(existsSync(join(repo, '.agent-runner-pi-session'))).toBe(false);
		expect(gitIn(['status', '--porcelain'], repo).trim()).toBe('');
	});

	it('the resolved sessionsDir REDIRECTS the actual --session arg (not a no-op)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const sessionArgFile = join(scratch.root, 'session-arg.txt');
		const piBin = writePiSessionStub(sessionArgFile);
		const fleetDir = join(scratch.root, 'fleet-sessions');

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			harness: new PiHarness({piBin}),
			sessionsDir: fleetDir,
			env: gitEnv(),
		});

		expect(result.outcome).toBe('completed');
		const sessionArg = readFileSync(sessionArgFile, 'utf8');
		expect(isAbsolute(sessionArg)).toBe(true);
		expect(sessionArg.endsWith('.jsonl')).toBe(true);
		// The override redirected the file under the arbitrary fleet folder.
		expect(dirname(sessionArg)).toBe(fleetDir);
		expect(existsSync(sessionArg)).toBe(true);
	});

	it('two runs in the same checkout get DISTINCT session paths (no resume+append)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha', 'beta']);
		const argFileA = join(scratch.root, 'arg-a.txt');
		const argFileB = join(scratch.root, 'arg-b.txt');

		const r1 = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			harness: new PiHarness({piBin: writePiSessionStub(argFileA)}),
			env: gitEnv(),
		});
		expect(r1.outcome).toBe('completed');

		const r2 = await performDo({
			arg: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			harness: new PiHarness({piBin: writePiSessionStub(argFileB)}),
			env: gitEnv(),
		});
		expect(r2.outcome).toBe('completed');

		const a = readFileSync(argFileA, 'utf8');
		const b = readFileSync(argFileB, 'utf8');
		expect(a).not.toBe(b);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'beta')).toBe(true);
	});
});
