import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {existsSync, readdirSync} from 'node:fs';
import {performDo} from '../src/do.js';
import {NullHarness} from '../src/harness.js';
import {PiHarness} from '../src/pi-harness.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `do --watch` tests (task `do-watch`) — the live observer that tails the pi
 * session `.jsonl`. Two concerns proven here against REAL git + a stubbed pi
 * CLI (house style: throwaway checkout + local `--bare` arbiter + a pi stub that
 * edits a file AND writes a session log, no real model):
 *
 *   - `--watch` + the NULL harness ERRORS clearly (it requires pi) BEFORE any
 *     git transition;
 *   - `--watch` is a READ-ONLY OBSERVER: the run's outcome is identical to a
 *     non-watch run, AND the tailed high-signal events are surfaced live.
 *
 * It drives real git against a `--bare` arbiter AND writes `main` (the
 * autonomous surfacing), so it lives in the non-parallel (sequential) project
 * alongside `do.test.ts`.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-do-watch-');
	// Isolate pi's session storage to a scratch dir so the default-path tests do
	// NOT write into the developer's real ~/.pi/agent/sessions/ (which leaks dirs
	// + crashed the pi-remote dashboard on the malformed fixture header).
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * An executable pi-CLI stub for the watch path. Honours `--session <file>` (the
 * full session-FILE path the adapter now passes, NOT `--session-dir`): it EDITS a
 * file in the worktree (so the completion commit is non-empty) and writes a small
 * REAL SESSION-LOG-shaped `.jsonl` AT THAT EXACT PATH — the `{type:"message",
 * message:{role, content[]}}` records pi's session-persistence log actually
 * carries (NOT the `--mode json` stream the watcher used to — wrongly — expect).
 * A preamble record + a user turn + a toolResult are interleaved so the test
 * proves the watcher SKIPS them and surfaces only the assistant text + tool
 * starts. "Finished" is emitted on process exit.
 */
function writeWatchPiStub(): string {
	const bin = join(scratch.root, 'pi-watch-stub.sh');
	const script = [
		'#!/usr/bin/env bash',
		'cat > /dev/null', // consume the prompt on stdin.
		'session_file=""',
		'prev=""',
		'for a in "$@"; do',
		'  if [ "$prev" = "--session" ]; then session_file="$a"; fi',
		'  prev="$a"',
		'done',
		// Edit a file so the runner has something to commit.
		"printf 'work done\\n' > agent-output.txt",
		// Write the session .jsonl the observer tails AT THE KNOWN PATH.
		'if [ -n "$session_file" ]; then',
		'  mkdir -p "$(dirname "$session_file")"',
		'  log="$session_file"',
		// A WELL-FORMED session header (version + ISO timestamp, like real pi). A
		// header missing `timestamp` makes any SessionManager.listAll() consumer
		// (e.g. the pi-remote dashboard) call new Date(undefined).toISOString() and
		// throw RangeError. Keep the fixture valid even now tests are isolated.
		`  printf '%s\\n' '{"type":"session","version":3,"id":"abc","timestamp":"2026-06-05T18:21:30.000Z","cwd":"."}' >> "$log"`,
		`  printf '%s\\n' '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"the prompt"}]}}' >> "$log"`,
		`  printf '%s\\n' '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"all set"},{"type":"toolCall","name":"edit","arguments":{}}]}}' >> "$log"`,
		`  printf '%s\\n' '{"type":"message","message":{"role":"toolResult","toolName":"edit","content":[{"type":"text","text":"ok"}]}}' >> "$log"`,
		'fi',
		'exit 0',
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return bin;
}

describe('do --watch — requires the pi harness (errors on null)', () => {
	it('errors CLEARLY when --watch is passed with the null harness, BEFORE any git transition', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: 'exit 0',
			harness: new NullHarness(),
			agentCmd: 'true',
			watch: true,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/--watch/);
		expect(result.message).toMatch(/pi/);
		// NO git transition happened: still in backlog, never claimed.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
	});
});

describe('do --watch — READ-ONLY observer (outcome unchanged, events surfaced)', () => {
	it('completes identically to a non-watch run AND surfaces the tailed high-signal events', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const piBin = writeWatchPiStub();

		const surfaced: string[] = [];
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			harness: new PiHarness({piBin}),
			watch: true,
			watchSink: (line) => surfaced.push(line),
			color: false,
			env: gitEnv(),
		});

		// Outcome is the SAME as a normal `do` run (observer changed nothing).
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);

		// The agent's edit landed (the runner committed it with the done-move).
		expect(
			existsOnArbiterMain(repo, 'done', 'alpha') && surfaced.includes('▶ edit'),
		).toBe(true);

		// The tailer surfaced the high-signal events from the session .jsonl,
		// skipping the rest (parity with ar-run.sh --watch).
		expect(surfaced).toContain('▶ edit');
		expect(surfaced).toContain('all set');
		expect(surfaced).toContain('✓ agent finished');
	});

	it('a do run WITHOUT --watch surfaces nothing (the observer is opt-in)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const piBin = writeWatchPiStub();

		const surfaced: string[] = [];
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			harness: new PiHarness({piBin}),
			// no watch flag
			watchSink: (line) => surfaced.push(line),
			env: gitEnv(),
		});

		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		// No --watch ⇒ no tailer ⇒ nothing surfaced (byte-identical behaviour).
		expect(surfaced).toEqual([]);
		// In-place `do` writes NOTHING into the checkout: no stray
		// `.agent-runner-pi-session/` dir (the session now lands under the pi-default
		// sessions root via `--session <path>`, not pinned into the worktree).
		expect(existsSync(join(repo, '.agent-runner-pi-session'))).toBe(false);
	});
});

describe('do --watch — the sessionsDir override redirects the actual --session path', () => {
	it('writes the session .jsonl UNDER the override root, and the watcher tails that KNOWN path', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const piBin = writeWatchPiStub();
		const sessionsRoot = join(scratch.root, 'fleet-sessions');

		const surfaced: string[] = [];
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			harness: new PiHarness({piBin}),
			sessionsDir: sessionsRoot,
			watch: true,
			watchSink: (line) => surfaced.push(line),
			color: false,
			env: gitEnv(),
		});

		expect(result.outcome).toBe('completed');
		// The session file landed UNDER the override root (the bridge from
		// config.sessionsDir → DoOptions → the generated --session path actually
		// reached pi; a no-op would have used the pi-default folder instead).
		const files = readdirSync(sessionsRoot);
		expect(files.some((f) => f.endsWith('.jsonl'))).toBe(true);
		expect(files.some((f) => f.startsWith('alpha-'))).toBe(true);
		// The watcher tailed THAT known path (the high-signal events surfaced).
		expect(surfaced).toContain('▶ edit');
		expect(surfaced).toContain('✓ agent finished');
		// Nothing was pinned into the checkout.
		expect(existsSync(join(repo, '.agent-runner-pi-session'))).toBe(false);
	});
});
