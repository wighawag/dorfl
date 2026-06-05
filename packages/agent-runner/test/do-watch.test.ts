import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {performDo} from '../src/do.js';
import {NullHarness} from '../src/harness.js';
import {
	PiHarness,
	piSessionDir,
	PI_SESSION_DIRNAME,
} from '../src/pi-harness.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `do --watch` tests (slice `do-watch`) — the live observer that tails the pi
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
beforeEach(() => {
	scratch = makeScratch('agent-runner-do-watch-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * An executable pi-CLI stub for the watch path. Honours `--session-dir`: it
 * EDITS a file in the worktree (so the completion commit is non-empty) and
 * writes a small session `.jsonl` event log (tool_start + assistant message_end
 * + agent_end) into the session dir — exactly what the tailer surfaces.
 */
function writeWatchPiStub(): string {
	const bin = join(scratch.root, 'pi-watch-stub.sh');
	const script = [
		'#!/usr/bin/env bash',
		'cat > /dev/null', // consume the prompt on stdin.
		'session_dir=""',
		'prev=""',
		'for a in "$@"; do',
		'  if [ "$prev" = "--session-dir" ]; then session_dir="$a"; fi',
		'  prev="$a"',
		'done',
		// Edit a file so the runner has something to commit.
		"printf 'work done\\n' > agent-output.txt",
		// Write the session .jsonl the observer tails.
		'if [ -n "$session_dir" ]; then',
		'  mkdir -p "$session_dir"',
		'  log="$session_dir/session.jsonl"',
		`  printf '%s\\n' '{"type":"tool_start","tool":"edit"}' >> "$log"`,
		`  printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"all set"}]}}' >> "$log"`,
		`  printf '%s\\n' '{"type":"agent_end"}' >> "$log"`,
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
		// The session dir still exists (pi wrote it) — but it was NOT tailed.
		expect(piSessionDir(repo)).toContain(PI_SESSION_DIRNAME);
	});
});
