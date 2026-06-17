import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
import {performAdvance} from '../src/advance.js';
import {
	newSidecar,
	serialiseSidecar,
	type SidecarModel,
	type SidecarDisposition,
} from '../src/sidecar.js';
import {parseFrontmatter} from '../src/frontmatter.js';
import type {
	ApplyAnsweredQuestionsOptions,
	ApplyAnsweredQuestionsResult,
} from '../src/apply-persist.js';
import {makeScratch, gitEnv, gitIn, type Scratch} from './helpers/gitRepo.js';
import type {
	AcquireAdvancingLockResult,
	ReleaseAdvancingLockResult,
} from '../src/advancing-lock.js';

/**
 * `advance-rung-apply` slice — the APPLY rung WIRED through the engine tick: on
 * `classify=apply` (ALL sidecar entries answered), under the `advancing` lock, the
 * engine applies the HUMAN's answers ATOMICALLY (delegating to the engine-owned
 * apply persist). The slice's acceptance criteria pinned at the engine seam:
 *
 *   - all-answered → the tick CLASSIFIES `apply` and runs the persist (winner);
 *   - applying is ALWAYS allowed (no gate) — proven with NO autonomy flags;
 *   - the expensive work is POST-lock, winner-only (a CAS loser never applies);
 *   - a subset-answered sidecar is NOT classified `apply` (the classifier NO-OPs)
 *     — the boundary asserted at the tick.
 *
 * House CAS-seam style: the apply persist + the lock acquire/release are injected
 * (the persist itself is exercised over a throwaway repo in apply-persist.test.ts).
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-advance-apply-');
});
afterEach(() => {
	scratch.cleanup();
});

const ACQUIRED: AcquireAdvancingLockResult = {
	exitCode: 0,
	outcome: 'acquired',
	message: 'locked',
};
const LOST: AcquireAdvancingLockResult = {
	exitCode: 2,
	outcome: 'lost',
	message: 'someone holds the borrow',
};
const RELEASED: ReleaseAdvancingLockResult = {
	exitCode: 0,
	outcome: 'released',
	message: 'released',
};

/**
 * A throwaway repo with one backlog slice (needsAnswers:true) + a FULLY-answered
 * sidecar — exactly the `classify=apply` cell. `answeredCount` < questions ⇒ a
 * subset (pending) sidecar for the NO-OP boundary test.
 */
function seedAnsweredItem(opts: {
	slug?: string;
	questions?: string[];
	answeredCount?: number;
	dispositions?: (SidecarDisposition | undefined)[];
}): {repo: string; itemPath: string; sidecarPath: string} {
	const slug = opts.slug ?? 'foo';
	const questions = opts.questions ?? ['A?', 'B?'];
	const answeredCount = opts.answeredCount ?? questions.length;
	const repo = join(scratch.root, 'project');
	mkdirSync(repo, {recursive: true});
	gitIn(['init', '-q', '-b', 'main'], repo);

	const itemPath = `work/backlog/${slug}.md`;
	mkdirSync(join(repo, 'work', 'backlog'), {recursive: true});
	writeFileSync(
		join(repo, itemPath),
		[
			'---',
			`title: ${slug}`,
			`slug: ${slug}`,
			'needsAnswers: true',
			'blockedBy: []',
			'---',
			'',
			'## What to build',
			'',
			'a thing',
			'',
		].join('\n'),
	);

	let model: SidecarModel = newSidecar(
		`slice:${slug}`,
		questions.map((q, i) => ({
			question: q,
			disposition: opts.dispositions?.[i],
		})),
	);
	model = {
		...model,
		entries: model.entries.map((e, i) => ({
			...e,
			answer: i < answeredCount ? `answer-${e.id}` : '',
		})),
	};
	const sidecarPath = `work/questions/slice-${slug}.md`;
	mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
	writeFileSync(join(repo, sidecarPath), serialiseSidecar(model));

	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', 'seed answered item'], repo);
	return {repo, itemPath, sidecarPath};
}

/** A persist spy that records the call + returns a canned result. */
function spyApply(result: ApplyAnsweredQuestionsResult): {
	persist: (o: ApplyAnsweredQuestionsOptions) => ApplyAnsweredQuestionsResult;
	calls: ApplyAnsweredQuestionsOptions[];
} {
	const calls: ApplyAnsweredQuestionsOptions[] = [];
	const persist = (o: ApplyAnsweredQuestionsOptions) => {
		calls.push(o);
		return result;
	};
	return {persist, calls};
}

describe('advance — the APPLY rung applies the human answers through the engine', () => {
	it('classify=apply (all answered) → engine runs the apply persist (winner), the REAL apply resolves', async () => {
		const {repo, itemPath, sidecarPath} = seedAnsweredItem({});

		const result = await performAdvance({
			arg: 'foo',
			cwd: repo,
			arbiter: 'origin',
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
			// Use the REAL apply persist (no spy) — proving end-to-end the tick
			// classifies `apply` from on-disk state and resolves atomically.
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(result.rung).toBe('apply');
		// The real apply resolved: sidecar deleted + needsAnswers cleared.
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		expect(
			parseFrontmatter(readFileSync(join(repo, itemPath), 'utf8')).needsAnswers,
		).toBe(false);
	});

	it('applying is ALWAYS allowed — no gate, proven with NO autonomy flags threaded', async () => {
		const {repo} = seedAnsweredItem({slug: 'bar'});
		const {persist, calls} = spyApply({
			outcome: 'resolved',
			sidecarPath: 'work/questions/slice-bar.md',
			itemPath: 'work/backlog/bar.md',
			message: 'resolved',
		});
		const result = await performAdvance({
			arg: 'bar',
			cwd: repo,
			applyPersist: persist,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		expect(result.rung).toBe('apply');
		expect(calls).toHaveLength(1);
		expect(calls[0].item).toBe('slice:bar');
	});

	it('a re-pause (appended new questions) reports a no-op outcome (the item idles, awaiting human)', async () => {
		const {repo} = seedAnsweredItem({slug: 'rep'});
		const {persist} = spyApply({
			outcome: 'repaused',
			sidecarPath: 'work/questions/slice-rep.md',
			itemPath: 'work/backlog/rep.md',
			message: 're-paused',
		});
		const result = await performAdvance({
			arg: 'rep',
			cwd: repo,
			applyPersist: persist,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('no-op');
		expect(result.rung).toBe('apply');
	});

	it('the expensive apply is POST-lock, winner-only — a CAS LOSER never applies', async () => {
		const {repo, sidecarPath} = seedAnsweredItem({slug: 'foo'});
		const {persist, calls} = spyApply({
			outcome: 'resolved',
			sidecarPath,
			itemPath: 'work/backlog/foo.md',
			message: 'resolved',
		});
		let released = false;
		const result = await performAdvance({
			arg: 'foo',
			cwd: repo,
			applyPersist: persist,
			acquireLock: async () => LOST,
			releaseLock: async () => {
				released = true;
				return RELEASED;
			},
		});
		expect(result.exitCode).toBe(2);
		expect(result.outcome).toBe('lost');
		expect(result.rung).toBe('apply'); // it DID classify (free, read-only)
		// …but the loser NEVER applied + NEVER released (it never held the lock).
		expect(calls).toEqual([]);
		expect(released).toBe(false);
		// The sidecar is untouched (no apply happened).
		expect(existsSync(join(repo, sidecarPath))).toBe(true);
	});

	it('a SUBSET-answered sidecar is NOT classified apply (the classifier NO-OPs) — boundary asserted', async () => {
		// q2 unanswered → pending → NO-OP, never reaches the apply persist.
		const {repo} = seedAnsweredItem({
			slug: 'subset',
			questions: ['A?', 'B?'],
			answeredCount: 1,
		});
		const {persist, calls} = spyApply({
			outcome: 'resolved',
			sidecarPath: 'work/questions/slice-subset.md',
			itemPath: 'work/backlog/subset.md',
			message: 'resolved',
		});
		let acquired = false;
		const result = await performAdvance({
			arg: 'subset',
			cwd: repo,
			applyPersist: persist,
			acquireLock: async () => {
				acquired = true;
				return ACQUIRED;
			},
			releaseLock: async () => RELEASED,
		});
		expect(result.outcome).toBe('no-op');
		expect(result.rung).toBe('no-op');
		// The classifier NO-OP'd: no lock taken, no apply, no mutation.
		expect(acquired).toBe(false);
		expect(calls).toEqual([]);
	});

	it('a disposition terminal (dropped) flows through the engine end-to-end', async () => {
		const {repo, itemPath, sidecarPath} = seedAnsweredItem({
			slug: 'oos',
			questions: ['ship?'],
			dispositions: ['dropped'],
		});
		const result = await performAdvance({
			arg: 'oos',
			cwd: repo,
			acquireLock: async () => ACQUIRED,
			releaseLock: async () => RELEASED,
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('advanced');
		expect(existsSync(join(repo, sidecarPath))).toBe(false);
		expect(existsSync(join(repo, itemPath))).toBe(false);
		expect(existsSync(join(repo, 'work', 'dropped', 'oos.md'))).toBe(true);
	});
});
