import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {performDo} from '../src/do.js';
import {PiHarness} from '../src/pi-harness.js';
import {parseSidecar} from '../src/sidecar.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	heldLockOnArbiter,
	sidecarSurfacedOnArbiterMain,
	needsAnswersOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * Task `a-truncated-agent-turn-routes-as-agent-failed` (observation
 * `a-truncated-model-turn-is-read-as-nothing-to-do-and-defaults-to-cancel`): a
 * build whose FINAL model turn was cut off (`stopReason: "length"`, the per-turn
 * output-token cap; or `"error"`) and that left no source change is a HARNESS
 * failure, so it routes `agent-failed` (the failure route: WIP save, surfaced,
 * lock released, requeue-able), never the empty-diff STOP whose surfaced
 * question defaults to CANCELLING the task. A normal end of turn with an empty
 * diff still takes the empty-diff route.
 *
 * Driven end-to-end through the REAL pi adapter with a stubbed pi CLI that makes
 * no change and writes a FAKE session log at the `--session` path: the signal is
 * read off that log exactly as production reads it. Real git against a `--bare`
 * arbiter that writes main, so this file runs in the sequential vitest project.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('dorfl-cut-off-turn-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * A pi-CLI stub that changes NOTHING in the worktree and writes a session log
 * whose FINAL assistant record is `finalMessage` (pi's session-log shape: a
 * header, the user prompt, an earlier text turn that called a tool, then the
 * final turn). Exits 0, as pi's `--print` run does when a turn is cut off.
 */
function writePiStub(finalMessage: Record<string, unknown>): string {
	const records = [
		{
			type: 'session',
			version: 3,
			id: 'abc',
			timestamp: '2026-09-28T08:00:00.000Z',
			cwd: '.',
		},
		{
			type: 'message',
			message: {role: 'user', content: [{type: 'text', text: 'the prompt'}]},
		},
		{
			type: 'message',
			message: {
				role: 'assistant',
				content: [
					{type: 'text', text: 'Let me read the code first.'},
					{type: 'toolCall', name: 'read', arguments: {path: 'src/x.ts'}},
				],
				stopReason: 'toolUse',
				usage: {output: 120},
			},
		},
		{type: 'message', message: {role: 'assistant', ...finalMessage}},
	];
	const lines = records.map(
		(r) => `  printf '%s\\n' ${shellQuote(JSON.stringify(r))} >> "$log"`,
	);
	const bin = join(scratch.root, 'pi-cut-off-stub.sh');
	const script = [
		'#!/usr/bin/env bash',
		'cat > /dev/null',
		'session_file=""',
		'prev=""',
		'for a in "$@"; do',
		'  if [ "$prev" = "--session" ]; then session_file="$a"; fi',
		'  prev="$a"',
		'done',
		'if [ -n "$session_file" ]; then',
		'  mkdir -p "$(dirname "$session_file")"',
		'  log="$session_file"',
		...lines,
		'fi',
		'exit 0',
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return bin;
}

function shellQuote(text: string): string {
	return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** The surfaced sidecar's entries, read off `<arbiter>/main`. */
function sidecarEntries(repo: string, slug: string) {
	const body = gitIn(
		['show', `${ARBITER}/main:work/questions/task-${slug}.md`],
		repo,
	);
	return parseSidecar(body).entries;
}

async function doWith(repo: string, piBin: string) {
	return performDo({
		arg: 'alpha',
		cwd: repo,
		arbiter: ARBITER,
		integration: 'merge',
		verify: 'exit 0',
		harness: new PiHarness({piBin}),
		env: gitEnv(),
	});
}

/** The failure-route observables, and the absence of the dispose question. */
function expectAgentFailedNotDisposed(repo: string): void {
	// Surfaced on main, lock released (the failure route after PR-2b).
	expect(sidecarSurfacedOnArbiterMain(repo, 'alpha')).toBe(true);
	expect(needsAnswersOnArbiterMain(repo, 'alpha')).toBe(true);
	expect(stuckLockOnArbiter(repo, 'alpha')).toBe(false);
	expect(heldLockOnArbiter(repo, 'alpha')).toBe(false);
	expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
	// NO engine-authored dispose-defaulted "Cancel this item?" question.
	for (const entry of sidecarEntries(repo, 'alpha')) {
		expect(entry.question).not.toMatch(/cancel this item\?/i);
		expect(entry.default ?? '').not.toMatch(/dispose/i);
	}
}

describe('a cut-off final model turn with an empty diff routes agent-failed (in-place do, real pi adapter)', () => {
	it('stopReason `length` (a thinking-only turn that hit the output-token cap) → agent-failed, naming the truncated turn', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const piBin = writePiStub({
			content: [{type: 'thinking', thinking: 'deliberating at length'}],
			stopReason: 'length',
			usage: {output: 16384},
		});

		const result = await doWith(repo, piBin);

		expect(result.outcome).toBe('agent-failed');
		expect(result.routedToNeedsAttention).toBe(true);
		expect(result.message).toMatch(/final model turn was cut off/);
		expect(result.message).toMatch(/stopReason 'length'/);
		expect(result.message).toMatch(/output-token cap/);
		expectAgentFailedNotDisposed(repo);
	});

	it('stopReason `error` → agent-failed, naming the provider error', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const piBin = writePiStub({
			content: [],
			stopReason: 'error',
			errorMessage: 'upstream returned an invalid response body',
			usage: {output: 0},
		});

		const result = await doWith(repo, piBin);

		expect(result.outcome).toBe('agent-failed');
		expect(result.message).toMatch(/stopReason 'error'/);
		expect(result.message).toMatch(/invalid response body/);
		expectAgentFailedNotDisposed(repo);
	});

	it('a NORMAL end of turn (stopReason `stop`) with an empty diff still takes the empty-diff route (unchanged)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const piBin = writePiStub({
			content: [{type: 'text', text: 'There is nothing to build here.'}],
			stopReason: 'stop',
			usage: {output: 40},
		});

		const result = await doWith(repo, piBin);

		expect(result.outcome).toBe('agent-stopped');
		expect(result.message).toMatch(/empty diff/);
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(false);
		const entries = sidecarEntries(repo, 'alpha');
		expect(entries[0].question).toMatch(/cancel this item\?/i);
		expect(entries[0].default).toMatch(/dispose/i);
	});

	it('a cut-off turn with a STOP sentinel in the text still honours the sentinel (the agent did report a deliberate STOP)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const piBin = writePiStub({
			content: [
				{
					type: 'text',
					text: '=== TASK-STOP ===\nthe premise drifted\n=== END TASK-STOP ===',
				},
			],
			stopReason: 'length',
			usage: {output: 16384},
		});

		const result = await doWith(repo, piBin);

		expect(result.outcome).toBe('agent-stopped');
		expect(result.message).toMatch(/the premise drifted/);
	});
});
