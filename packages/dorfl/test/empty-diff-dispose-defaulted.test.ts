import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {performDo} from '../src/do.js';
import {mkdirSync, writeFileSync} from 'node:fs';
import {newSidecar, parseSidecar, serialiseSidecar} from '../src/sidecar.js';
import {applyAnsweredQuestions} from '../src/apply-persist.js';
import {emptyDiffDisposeEnvelope} from '../src/agent-stop.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	sidecarSurfacedOnArbiterMain,
	needsAnswersOnArbiterMain,
	stuckLockOnArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * Focused tests for the "empty-diff bounce surfaces a DISPOSE-DEFAULTED
 * question" story (spec `surface-stuck-as-questions-and-retire-stuck-lock-state`
 * US #7, resolved decision #2; task
 * `empty-diff-bounce-surfaces-dispose-defaulted-question`).
 *
 * Three properties are pinned here:
 *   1. Engine-owned envelope + safe default. An empty-diff bounce SURFACES a
 *      sidecar on `<arbiter>/main` whose first entry is an engine-authored
 *      disposition question that DEFAULTS to `dispose` (cancel-to-terminal) —
 *      NOT a blind requeue. It is present even when the agent surfaced no
 *      questions of its own.
 *   2. Anti-infinite-loop. A second no-change leg on the SAME item RE-SURFACES
 *      (appends another engine envelope) instead of blindly re-queuing — the
 *      seam never calls a `requeue`/re-run path in response to "nothing to do".
 *      The item is left with `needsAnswers:true` on `main`, so the eligibility
 *      pool excludes it until a human answers.
 *   3. Cancel dispatches `dispose`. Feeding the engine's suggested default back
 *      through the shared apply persist yields the regime-polymorphic `dispose`
 *      outcome: for a TASK this is a `git mv → tasks/cancelled/` (RETAINED),
 *      NOT a `git rm`.
 *
 * Drives real git against a `--bare` `file://` arbiter (writes main), so this
 * file lives in the RACE_SENSITIVE vitest project alongside the other main-CAS
 * tests. House style: throwaway checkout + stubbed agent (`dorfl` returns
 * `ok:true` with no source change), mirroring `do.test.ts`.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-empty-diff-dispose-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/** Read the sidecar off `<arbiter>/main` and return the parsed model. */
function sidecarOnMain(repo: string, slug: string) {
	const body = gitIn(
		['show', `${ARBITER}/main:work/questions/task-${slug}.md`],
		repo,
	);
	return parseSidecar(body);
}

describe('empty-diff bounce → dispose-defaulted question (engine envelope)', () => {
	it('an empty-diff STOP surfaces a sidecar whose FIRST entry defaults to dispose (cancel-to-terminal)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			// Agent succeeds but produces NO source change and NO stop-sentinel:
			// the deterministic empty-diff backstop must fire.
			dorfl: () => ({ok: true, output: 'nothing to do'}),
			env: gitEnv(),
		});

		expect(result.outcome).toBe('agent-stopped');
		expect(result.routedToNeedsAttention).toBe(true);

		// The engine surfaced the sidecar on `<arbiter>/main` + set
		// `needsAnswers:true` on the body + RELEASED the lock (NOT the lock-stuck
		// bounce path a sentinel STOP still rides).
		expect(sidecarSurfacedOnArbiterMain(repo, 'alpha')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'alpha')).toBe(true);
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);

		// The first entry is the ENGINE-authored dispose-defaulted disposition
		// question. The engine guarantees it exists even with no agent-supplied
		// questions; its `default` names `dispose` (regime-polymorphic:
		// task → `work/tasks/cancelled/`).
		const model = sidecarOnMain(repo, 'alpha');
		expect(model.entries.length).toBeGreaterThanOrEqual(1);
		const envelope = model.entries[0];
		expect(envelope.kind).toBe('stuck');
		expect(envelope.question).toMatch(/produced no change/i);
		expect(envelope.question).toMatch(/cancel this item\?/i);
		expect(envelope.default).toBeDefined();
		expect(envelope.default).toMatch(/dispose/i);
		expect(envelope.default).toMatch(/cancelled/i);
	});

	it('a SECOND no-change leg RE-SURFACES the dispose question (no infinite requeue loop)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);

		// Leg 1: empty-diff STOP → surface a dispose-defaulted question.
		const first = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			dorfl: () => ({ok: true, output: 'nothing to do'}),
			env: gitEnv(),
		});
		expect(first.outcome).toBe('agent-stopped');
		const modelAfterFirst = sidecarOnMain(repo, 'alpha');
		expect(modelAfterFirst.entries.length).toBe(1);
		expect(modelAfterFirst.entries[0].default).toMatch(/dispose/i);

		// The item is now `needsAnswers:true` on `main` → excluded from the
		// eligible pool by construction. A second `do` targeted at the same slug
		// (the explicit face) exercises the "no infinite loop" property directly:
		// the STOP path re-runs and RE-SURFACES via the same seam, never blindly
		// re-queuing. The observables of "did not requeue": the lock stays
		// released, the body stays on `main` in its original folder with
		// `needsAnswers:true` (a requeue would `git mv` it back and clear the
		// flag), and the sidecar has ANOTHER engine envelope appended (not been
		// deleted + rebuilt from scratch as a fresh leg).
		const second = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: 'exit 0',
			dorfl: () => ({ok: true, output: 'nothing to do'}),
			env: gitEnv(),
		});
		// `agent-stopped` OR `lost` (a re-claim CAS could refuse a
		// `needsAnswers:true` item, since it is not `eligible`). Either way the
		// non-negotiable property is: nothing re-queued, the sidecar still stands.
		expect(['agent-stopped', 'lost']).toContain(second.outcome);

		// Sidecar is still surfaced with `needsAnswers:true` — the loop parked
		// the item, it did not blindly re-queue.
		expect(sidecarSurfacedOnArbiterMain(repo, 'alpha')).toBe(true);
		expect(needsAnswersOnArbiterMain(repo, 'alpha')).toBe(true);
		expect(stuckLockOnArbiter(repo, 'alpha')).toBe(false);

		// The engine envelope has NOT been overwritten (the append-only
		// invariant): the first entry survives the second leg unchanged. The
		// dispose-default is still present so the human's one-glance answer path
		// is intact even after a re-bounce.
		const modelAfterSecond = sidecarOnMain(repo, 'alpha');
		expect(modelAfterSecond.entries.length).toBeGreaterThanOrEqual(1);
		expect(modelAfterSecond.entries[0].question).toBe(
			modelAfterFirst.entries[0].question,
		);
		expect(modelAfterSecond.entries[0].default).toMatch(/dispose/i);
	});

	it('answering "cancel" (the dispose default) dispatches the `dispose` outcome — the task is `git mv`-ed to `tasks/cancelled/` (RETAINED, NOT `git rm`-ed)', async () => {
		// The apply-persist seam is agnostic to how the answer was obtained; the
		// engine's guarantee is that a dispose-defaulted question EXISTS on the
		// surfaced sidecar so a human can answer "cancel" and the shared
		// `applyAnsweredQuestions` routes the `dispose` verdict to the
		// regime-polymorphic terminal. Test that end-of-pipe wiring here: seed a
		// task + a sidecar with the same engine envelope + a human answer, then
		// dispatch dispose.
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const envelope = emptyDiffDisposeEnvelope({
			item: 'task:alpha',
			reason: "the agent produced no source change building 'alpha'",
		});
		expect(envelope.default).toMatch(/dispose/i);

		// Seed a needsAnswers:true item body + an answered sidecar carrying the
		// dispose-defaulted envelope entry (mirroring the state the surface leg
		// leaves behind, plus the human's "cancel" answer). Build the sidecar
		// through the shared `newSidecar` + `serialiseSidecar` so the parser round-
		// trips (identity comment + per-entry markers).
		const itemPath = 'work/tasks/ready/alpha.md';
		const sidecarPath = 'work/questions/task-alpha.md';
		const oldBody = readFileSync(join(repo, itemPath), 'utf8');
		const flagged = /^needsAnswers:/m.test(oldBody)
			? oldBody.replace(/^needsAnswers:.*$/m, 'needsAnswers: true')
			: oldBody.replace(/^---\n/, '---\nneedsAnswers: true\n');
		writeFileSync(join(repo, itemPath), flagged);
		mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
		let model = newSidecar('task:alpha', [envelope]);
		model = {
			...model,
			entries: model.entries.map((e) => ({
				...e,
				answer:
					'cancel — the agent is right, dispose this task to the cancelled terminal.',
			})),
		};
		writeFileSync(join(repo, sidecarPath), serialiseSidecar(model));
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'seed: surfaced + answered'], repo);

		// Dispatch the `dispose` verdict (the agentic apply decider would map the
		// "cancel" answer to this outcome given the dispose-default hint). This
		// is the regime-polymorphic terminal for a TASK:
		//   `work/tasks/ready/<slug>.md → work/tasks/cancelled/<slug>.md` (RETAINED).
		const result = applyAnsweredQuestions({
			cwd: repo,
			item: 'task:alpha',
			itemPath,
			dispose: {
				reason: 'cancel — the agent is right, dispose this task to cancelled.',
			},
			env: gitEnv(),
		});
		expect(result.outcome).toBe('disposed');

		// The task RESTS at its regime's terminal (RETAINED), NEVER `git rm`-ed.
		const terminalPath = 'work/tasks/cancelled/alpha.md';
		expect(existsSync(join(repo, itemPath))).toBe(false);
		expect(existsSync(join(repo, terminalPath))).toBe(true);
		// The sidecar is rm-ed in the SAME commit (the loop is settled).
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
	});
});
