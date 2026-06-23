import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	writeFileSync,
	chmodSync,
	mkdirSync,
	readdirSync,
	existsSync,
} from 'node:fs';
import {join} from 'node:path';
import {performDo} from '../src/do.js';
import {PiHarness} from '../src/pi-harness.js';
import {harnessReviewGate} from '../src/review-gate.js';
import {launchWithOptionalWatch} from '../src/agent-launch.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	stuckLockOnArbiter,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `--watch` ALSO tails the REVIEW gate's session (task `watch-review-session`).
 *
 * Today `do --watch` tails only the BUILD agent's session; the Gate-2 review
 * launches a SEPARATE agent with its own session `.jsonl` that nothing tailed —
 * so the reviewer's reasoning/verdict was invisible live. This proves the fix:
 * ONE shared `launchWithOptionalWatch` helper, exercised by BOTH the build launch
 * (`do.ts`) and the review launch (`harnessReviewGate`), with the review stream
 * surfaced AFTER the build stream and a build→review boundary banner between them.
 *
 * House style (mirrors `do-watch.test.ts` + `review-gate-pr.test.ts`): a
 * throwaway checkout + a local `--bare` arbiter + a STUBBED pi CLI that edits a
 * file AND writes a real session-log-shaped `.jsonl`, no real model/network;
 * `isolatePiAgentDir` keeps the developer's real `~/.pi/agent/sessions/`
 * untouched. It drives real git + writes `main`, so it lives in the sequential
 * project (see `vitest.config.ts`).
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-watch-review-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/**
 * A pi-CLI stub that serves BOTH the build launch AND the Gate-2 review launch
 * from the SAME binary, deciding which by sniffing the prompt on stdin:
 *
 *   - the BUILD prompt → edit a file (non-empty completion commit) + write a
 *     session log whose assistant turn says `building <slug>` and calls `edit`;
 *   - the REVIEW prompt (recognised by the `FRESH-CONTEXT reviewer` framing
 *     `buildReviewPrompt` emits) → write a session log whose assistant turn IS
 *     the `{verdict: "approve"|"block", findings}` JSON (so the pi adapter reads
 *     it as `LaunchResult.output` and the gate parses the verdict) and surfaces a
 *     distinct `reviewing <slug>` text + a `read` tool call for the watcher.
 *
 * The verdict the review stub emits is taken from `VERDICT_MARKER` in the env so
 * a single stub can be driven approve OR block per test.
 */
function writeBuildAndReviewPiStub(): string {
	const bin = join(scratch.root, 'pi-build-review-stub.sh');
	const script = [
		'#!/usr/bin/env bash',
		'prompt="$(cat)"', // consume + capture the prompt on stdin.
		'session_file=""',
		'prev=""',
		'for a in "$@"; do',
		'  if [ "$prev" = "--session" ]; then session_file="$a"; fi',
		'  prev="$a"',
		'done',
		'verdict="${VERDICT_MARKER:-approve}"',
		'mkdir -p "$(dirname "$session_file")"',
		'log="$session_file"',
		// A well-formed session header (valid timestamp — see do-watch stub).
		`printf '%s\\n' '{"type":"session","version":3,"id":"x","timestamp":"2026-06-05T18:21:30.000Z","cwd":"."}' >> "$log"`,
		// Branch on the prompt: the review prompt carries the reviewer framing.
		'if printf "%s" "$prompt" | grep -q "FRESH-CONTEXT reviewer"; then',
		// REVIEW launch: edit nothing; the assistant turn surfaces a `reviewing` text
		// + a `read` tool call (for the watcher), then a SECOND assistant turn whose
		// `text` value IS the verdict JSON (so the pi adapter reads it as
		// `LaunchResult.output` and the gate parses it). That verdict JSON lives
		// INSIDE a session-log `text` string, so its quotes are escaped as \\" — we
		// emit the whole record with single-quotes around it (no bash interpolation),
		// branching on the verdict word so the escaping is written out literally.
		`  printf '%s\\n' '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"reviewing the task"},{"type":"toolCall","name":"read","arguments":{}}]}}' >> "$log"`,
		'  if [ "$verdict" = "block" ]; then',
		`    printf '%s\\n' '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"{\\"verdict\\":\\"block\\",\\"findings\\":[{\\"severity\\":\\"blocking\\",\\"question\\":\\"misses it\\"}]}"}]}}' >> "$log"`,
		'  else',
		`    printf '%s\\n' '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"{\\"verdict\\":\\"approve\\",\\"findings\\":[]}"}]}}' >> "$log"`,
		'  fi',
		'else',
		// BUILD launch: edit a file so the runner has something to commit, and
		// write a build-flavoured assistant turn + an `edit` tool call.
		"  printf 'work done\\n' > agent-output.txt",
		`  printf '%s\\n' '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"building the task"},{"type":"toolCall","name":"edit","arguments":{}}]}}' >> "$log"`,
		'fi',
		'exit 0',
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return bin;
}

describe('do --review --watch — the review gate session is tailed too', () => {
	it('surfaces the build stream, THEN a build→review boundary, THEN the review stream — via the SAME helper', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const piBin = writeBuildAndReviewPiStub();
		const harness = new PiHarness({piBin});

		const surfaced: string[] = [];
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			harness,
			// The PRODUCTION gate, harness-backed — the SAME pi harness the build
			// uses, so its review session is tailed by the same shared helper.
			review: true,
			// One review round: this test asserts exactly one build stream + one review
			// stream is tailed (the corroborated two-round approve is covered elsewhere).
			reviewMaxRounds: 1,
			reviewGate: harnessReviewGate({harness}),
			watch: true,
			watchSink: (line) => surfaced.push(line),
			color: false,
			env: {...gitEnv(), VERDICT_MARKER: 'approve'},
		});

		// The run completed normally (approve + merge ⇒ landed).
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);

		// The BUILD stream was surfaced (the build agent's text + tool call), then
		// finished, then the REVIEW stream — the reviewer's reasoning is now LIVE.
		expect(surfaced).toContain('building the task');
		expect(surfaced).toContain('▶ edit');
		expect(surfaced).toContain('reviewing the task');
		expect(surfaced).toContain('▶ read');

		// The build→review BOUNDARY banner sits BETWEEN the two streams.
		const boundaryIdx = surfaced.findIndex((l) => /review gate/.test(l));
		expect(boundaryIdx).toBeGreaterThanOrEqual(0);
		expect(surfaced[boundaryIdx]).toMatch(/reviewing alpha/);

		// Ordering: build text BEFORE the boundary; review text AFTER it.
		const buildIdx = surfaced.indexOf('building the task');
		const reviewIdx = surfaced.indexOf('reviewing the task');
		expect(buildIdx).toBeGreaterThanOrEqual(0);
		expect(buildIdx).toBeLessThan(boundaryIdx);
		expect(boundaryIdx).toBeLessThan(reviewIdx);

		// Two `✓ agent finished` lines — one per tailed stream (build + review).
		expect(surfaced.filter((l) => l === '✓ agent finished')).toHaveLength(2);
	});

	it('the review agent uses a KNOWN, DISTINCT session path (no collision with the build)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const piBin = writeBuildAndReviewPiStub();
		const harness = new PiHarness({piBin});
		const sessionsRoot = join(scratch.root, 'sessions');

		await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			harness,
			review: true,
			reviewGate: harnessReviewGate({harness}),
			sessionsDir: sessionsRoot,
			watch: true,
			watchSink: () => {},
			color: false,
			env: {...gitEnv(), VERDICT_MARKER: 'approve'},
		});

		// Two distinct session files landed under the override root: the BUILD
		// (`alpha-…`) and the REVIEW (`alpha-review-…`) — a distinct, known stem so
		// the review tailer follows the exact file, never the build's.
		const files = readdirSync(sessionsRoot).filter((f) => f.endsWith('.jsonl'));
		expect(files.some((f) => f.startsWith('alpha-review-'))).toBe(true);
		// A build session that is NOT the review one (distinct path, no collision).
		expect(
			files.some(
				(f) => f.startsWith('alpha-') && !f.startsWith('alpha-review-'),
			),
		).toBe(true);
	});
});

describe('do --review WITHOUT --watch — no review tailer, behaviour unchanged', () => {
	it('surfaces nothing (no build stream, no boundary, no review stream) and still completes', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const piBin = writeBuildAndReviewPiStub();
		const harness = new PiHarness({piBin});

		const surfaced: string[] = [];
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			harness,
			review: true,
			reviewGate: harnessReviewGate({harness}),
			// no watch flag — the review path must be byte-for-byte unchanged.
			watchSink: (line) => surfaced.push(line),
			env: {...gitEnv(), VERDICT_MARKER: 'approve'},
		});

		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		// No --watch ⇒ no tailer (build OR review) ⇒ nothing surfaced, and in
		// particular NO build→review boundary banner.
		expect(surfaced).toEqual([]);
		expect(surfaced.some((l) => /review gate/.test(l))).toBe(false);
		// Nothing pinned into the checkout.
		expect(existsSync(join(repo, '.agent-runner-pi-session'))).toBe(false);
	});
});

describe('the gate DECISION is identical with watch on vs off (observability only)', () => {
	it('an approve completes+merges the SAME way; a block routes to needs-attention the SAME way', async () => {
		const piBin = writeBuildAndReviewPiStub();

		async function run(slug: string, watch: boolean, verdict: string) {
			// A DISTINCT root per run (seedRepoWithArbiter pins `project`/`*.git`
			// paths, which would collide across four seeds in one test).
			const sub = join(scratch.root, slug);
			mkdirSync(sub, {recursive: true});
			const {repo} = seedRepoWithArbiter(sub, [slug]);
			const harness = new PiHarness({piBin});
			return performDo({
				arg: slug,
				cwd: repo,
				arbiter: ARBITER,
				integration: 'merge',
				verify: 'exit 0',
				harness,
				review: true,
				reviewGate: harnessReviewGate({harness}),
				watch,
				watchSink: () => {},
				color: false,
				env: {...gitEnv(), VERDICT_MARKER: verdict},
			}).then((result) => ({repo, result}));
		}

		// APPROVE: identical outcome (completed) watch on vs off.
		const approveOff = await run('a-off', false, 'approve');
		const approveOn = await run('a-on', true, 'approve');
		expect(approveOff.result.outcome).toBe('completed');
		expect(approveOn.result.outcome).toBe(approveOff.result.outcome);
		expect(approveOn.result.exitCode).toBe(approveOff.result.exitCode);
		expect(existsOnArbiterMain(approveOn.repo, 'done', 'a-on')).toBe(true);

		// BLOCK: identical outcome (needs-attention, NOT merged) watch on vs off.
		const blockOff = await run('b-off', false, 'block');
		const blockOn = await run('b-on', true, 'block');
		expect(blockOff.result.outcome).toBe('needs-attention');
		expect(blockOn.result.outcome).toBe(blockOff.result.outcome);
		expect(blockOn.result.exitCode).toBe(blockOff.result.exitCode);
		expect(stuckLockOnArbiter(blockOn.repo, 'b-on')).toBe(true);
		expect(existsOnArbiterMain(blockOn.repo, 'done', 'b-on')).toBe(false);
	});
});

describe('launchWithOptionalWatch — the ONE shared helper both callers use', () => {
	it('tails the pi session when watch is on (the build + review paths share THIS)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const piBin = writeBuildAndReviewPiStub();
		const harness = new PiHarness({piBin});

		const surfaced: string[] = [];
		const launched = await launchWithOptionalWatch({
			harness,
			dir: repo,
			slug: 'alpha',
			command: '',
			// The build prompt branch of the stub (no reviewer framing).
			prompt: 'build the task',
			sessionId: 'alpha',
			watch: true,
			watchSink: (line) => surfaced.push(line),
			color: false,
			env: gitEnv(),
		});

		expect(launched.ok).toBe(true);
		// The helper started a tailer that surfaced the session's high-signal lines.
		expect(surfaced).toContain('building the task');
		expect(surfaced).toContain('▶ edit');
		expect(surfaced).toContain('✓ agent finished');
	});

	it('does a plain sync launch (no tailer) when watch is off — byte-identical', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const piBin = writeBuildAndReviewPiStub();
		const harness = new PiHarness({piBin});

		const surfaced: string[] = [];
		const launched = await launchWithOptionalWatch({
			harness,
			dir: repo,
			slug: 'alpha',
			command: '',
			prompt: 'build the task',
			sessionId: 'alpha',
			// watch off
			watchSink: (line) => surfaced.push(line),
			env: gitEnv(),
		});

		expect(launched.ok).toBe(true);
		// No tailer ⇒ nothing surfaced (the sink is never touched).
		expect(surfaced).toEqual([]);
	});
});
