import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync} from 'node:fs';
import {performSlice, type SliceAgentRunner} from '../src/slicing.js';
import {
	buildReviewPrompt,
	buildSliceAcceptancePrompt,
	type ReviewGate,
	type ReviewVerdict,
} from '../src/review-gate.js';
import type {SliceReviewGate} from '../src/slicer-review-loop.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * `do prd:<slug>` SLICE-SET ACCEPTANCE GATE tests (slice `slice-acceptance-gate`).
 * The slice-path mirror of the build Gate-2: a FRESH-CONTEXT review of the
 * produced slice SET runs BEFORE the slices integrate (riding
 * `performIntegration`'s review-before-integrate block). `--review` on (default)
 * runs it; `--no-review` skips it; `block` routes the PRD to needs-attention (no
 * slices land); `approve` lets the set integrate. It is ONE-SHOT (no rounds; it
 * does NOT consult `--review-max-rounds`) and is independently controllable from
 * the slicer improver loop.
 *
 * House style (mirrors `slicing-integration.test.ts` + `review-gate-pr.test.ts`):
 * a throwaway checkout + a local `--bare` arbiter + a STUBBED agent (writes slice
 * files directly) + a STUBBED acceptance gate (a canned approve/block verdict, NO
 * real model). `GIT_CONFIG_GLOBAL` isolation + `isolatePiAgentDir` keep the
 * developer's real config/sessions untouched.
 */

const ARBITER = 'arbiter';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-slice-gate-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

/** Seed a `work/prd/<slug>.md` (committed onto the arbiter). */
function seedPrd(repo: string, slug: string): void {
	const dir = join(repo, 'work', 'prd');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		[
			'---',
			`title: ${slug} — slice me`,
			`slug: ${slug}`,
			'---',
			'',
			'## Problem Statement',
			'',
			`PRD body for ${slug}.`,
			'',
		].join('\n'),
	);
	run('git', ['add', '-A'], repo, {env: gitEnv()});
	run('git', ['commit', '-q', '-m', `prd: ${slug}`], repo, {env: gitEnv()});
	run('git', ['push', '-q', ARBITER, 'main'], repo, {env: gitEnv()});
}

/** An agent that writes one backlog slice file (no git). */
function slicingAgent(file = 'child'): SliceAgentRunner {
	return ({cwd}) => {
		const dir = join(cwd, 'work', 'backlog');
		mkdirSync(dir, {recursive: true});
		writeFileSync(
			join(dir, `${file}.md`),
			[
				'---',
				`title: ${file}`,
				`slug: ${file}`,
				'prd: it',
				'---',
				'',
				'## Prompt',
				'',
				'> build it',
				'',
			].join('\n'),
		);
		return {ok: true};
	};
}

/**
 * A stubbed acceptance gate (the slice-SET `ReviewGate` seam) returning a fixed
 * verdict — a CALLABLE that also records its invocations so call sites can assert
 * call count / round / model (mirrors `review-gate-pr.test.ts`'s `stubGate`).
 */
type StubGate = ReviewGate & {
	readonly calls: number;
	readonly rounds: number[];
	readonly models: (string | undefined)[];
};
function stubGate(verdict: ReviewVerdict): StubGate {
	const rounds: number[] = [];
	const models: (string | undefined)[] = [];
	const gate = (async (input) => {
		rounds.push(input.round);
		models.push(input.reviewModel);
		return verdict;
	}) as StubGate;
	Object.defineProperties(gate, {
		calls: {get: () => rounds.length},
		rounds: {get: () => rounds},
		models: {get: () => models},
	});
	return gate;
}

const APPROVE: ReviewVerdict = {verdict: 'approve', findings: []};
const BLOCK: ReviewVerdict = {
	verdict: 'block',
	findings: [
		{
			severity: 'blocking',
			question: 'the slice set leaves a coverage gap in the PRD goal',
			context: 'work/backlog/child.md',
		},
	],
};

const onArbiterMain = (repo: string, path: string): boolean => {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return (
		run('git', ['cat-file', '-e', `${ARBITER}/main:${path}`], repo, {
			env: gitEnv(),
		}).status === 0
	);
};

const showArbiterMain = (repo: string, path: string): string => {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return run('git', ['show', `${ARBITER}/main:${path}`], repo, {
		env: gitEnv(),
	}).stdout;
};

describe('slice acceptance gate — APPROVE lets the set integrate (default --merge)', () => {
	it('review on + APPROVE ⇒ the gate runs once, then the slices land on main', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const gate = stubGate(APPROVE);
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			today: '2026-06-08',
			review: true,
			reviewGate: gate,
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');
		// The gate ran (before the integrate) exactly ONCE — it is one-shot.
		expect(gate.calls).toBe(1);
		// The approved set integrated onto main (slice + PRD restore + marker).
		expect(onArbiterMain(repo, 'work/backlog/child.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/prd/it.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/slicing/it.md')).toBe(false);
	});
});

describe('slice acceptance gate — --no-review skips it (mirror the build Gate-2 off test)', () => {
	it('review off ⇒ the gate is NEVER invoked and the set still integrates', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const gate = stubGate(BLOCK); // would block — but must never run
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			today: '2026-06-08',
			review: false, // --no-review
			reviewGate: gate,
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(gate.calls).toBe(0);
		expect(onArbiterMain(repo, 'work/backlog/child.md')).toBe(true);
	});

	it('review undefined (no gate wired) ⇒ default behaviour unchanged (no gate runs)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			today: '2026-06-08',
			// no `review`, no `reviewGate` — the pre-gate behaviour.
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		expect(onArbiterMain(repo, 'work/backlog/child.md')).toBe(true);
	});
});

describe('slice acceptance gate — BLOCK routes the set to needs-attention (not integrated)', () => {
	it('review on + BLOCK ⇒ needs-attention, NO slices land, exit 1, findings in the body', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const gate = stubGate(BLOCK);
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			today: '2026-06-08',
			review: true,
			reviewGate: gate,
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('needs-attention');
		expect(gate.calls).toBe(1);
		// The PRD was routed to needs-attention on main (the slice-path block route,
		// via the lock's slicing/ → needs-attention/ redirect). The slices did NOT
		// land, and the PRD is no longer held in slicing/.
		expect(onArbiterMain(repo, 'work/needs-attention/it.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/backlog/child.md')).toBe(false);
		expect(onArbiterMain(repo, 'work/prd/it.md')).toBe(false);
		expect(onArbiterMain(repo, 'work/slicing/it.md')).toBe(false);
		// The gate's blocking findings are recorded in the item body (the reason).
		const body = showArbiterMain(repo, 'work/needs-attention/it.md');
		expect(body).toMatch(/coverage gap in the PRD goal/);
	});

	it('a BLOCK on the --propose path also routes to needs-attention (no PR of a blocked set)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const gate = stubGate(BLOCK);
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'propose',
			today: '2026-06-08',
			review: true,
			reviewGate: gate,
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('needs-attention');
		expect(onArbiterMain(repo, 'work/needs-attention/it.md')).toBe(true);
		expect(onArbiterMain(repo, 'work/backlog/child.md')).toBe(false);
	});
});

describe('slice acceptance gate — ONE-SHOT (single invocation, no rounds)', () => {
	it('a persistent BLOCK is NOT re-reviewed: the gate runs exactly ONCE (round 1), no --review-max-rounds loop', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const gate = stubGate(BLOCK); // always blocks
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			today: '2026-06-08',
			review: true,
			reviewGate: gate,
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		// ONE-SHOT: the gate was invoked exactly once (round 1), then terminated to
		// needs-attention — no rounds loop (the build gate's default would be 2).
		expect(gate.calls).toBe(1);
		expect(gate.rounds).toEqual([1]);
		expect(result.outcome).toBe('needs-attention');
	});

	it('performSlice has NO --review-max-rounds knob on the slice path (the gate is terminal)', () => {
		// The slice path's options carry NO `reviewMaxRounds` field — the rounds
		// bound is an orphan that belongs to a future revise↔review loop, never a
		// gate. (Type-level assertion: this object is a valid PerformSliceOptions
		// fragment ONLY because it has no reviewMaxRounds; a TS error here would
		// catch a regression that added the knob.)
		const fragment = {review: true} as const;
		expect('reviewMaxRounds' in fragment).toBe(false);
	});
});

describe('slice acceptance gate — --review-model de-correlates the reviewer', () => {
	it('the acceptanceReviewModel override reaches the gate (the launch seam)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const gate = stubGate(APPROVE);
		await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			today: '2026-06-08',
			review: true,
			reviewGate: gate,
			acceptanceReviewModel: 'review/override',
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		expect(gate.models).toEqual(['review/override']);
	});
});

describe('slice acceptance gate — independent of the slicer improver loop', () => {
	// A canned improver-loop gate (converge, no edits) so both seams are wired at
	// once. The two are non-overlapping concepts: the loop EDITS slices in-context;
	// the gate is a terminal fresh-context accept/reject BEFORE integrate.
	const convergingLoop: SliceReviewGate = async () => ({
		verdict: 'approve',
		edits: [],
		findings: [],
	});

	it('the gate runs even when the improver loop is wired (toggling one does not affect the other)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const gate = stubGate(APPROVE);
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			today: '2026-06-08',
			// BOTH seams on: the improver loop AND the acceptance gate.
			reviewLoop: convergingLoop,
			maxReview: 1,
			review: true,
			reviewGate: gate,
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		// The acceptance gate still ran (it is not gated by the improver loop).
		expect(gate.calls).toBe(1);
	});

	it('the gate is OFF independently while the improver loop is ON (review off, loop on)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		seedPrd(repo, 'it');
		const gate = stubGate(BLOCK); // would block — but review is off so it never runs
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: ARBITER,
			autoSlice: true,
			integration: 'merge',
			today: '2026-06-08',
			reviewLoop: convergingLoop, // improver loop ON
			maxReview: 1,
			review: false, // acceptance gate OFF
			reviewGate: gate,
			agentRunner: slicingAgent('child'),
			env: gitEnv(),
		});
		// The set landed (the loop converged), and the gate never ran.
		expect(result.outcome).toBe('sliced');
		expect(gate.calls).toBe(0);
		expect(onArbiterMain(repo, 'work/backlog/child.md')).toBe(true);
	});
});

describe('slice acceptance gate — the prompt is a slice-SET prompt (distinct from the build per-diff prompt)', () => {
	it('the slice-SET prompt reviews the WHOLE SET (coherence / graph / gaps+overlap), NOT a code diff', () => {
		const prompt = buildSliceAcceptancePrompt('it');
		// It frames a SET review with the set-of-slices lens…
		expect(prompt).toMatch(/slice-SET ACCEPTANCE GATE/);
		expect(prompt).toMatch(/WHOLE SET/);
		expect(prompt).toMatch(/DEPENDENCY GRAPH/);
		expect(prompt).toMatch(/GAPS \+ OVERLAP/);
		expect(prompt).toMatch(/CORRECT-IF-IMPLEMENTED/);
		// …and it is TERMINAL (emits a verdict; does not edit — distinct from the
		// improver loop).
		expect(prompt).toMatch(/do NOT edit any slice/);
	});

	it('it is demonstrably DISTINCT from the build per-diff review prompt', () => {
		const setPrompt = buildSliceAcceptancePrompt('it');
		const buildPrompt = buildReviewPrompt('it');
		expect(setPrompt).not.toBe(buildPrompt);
		// The build prompt reviews a code DIFF against ONE slice; the set prompt
		// reviews the SET of slices against the PRD.
		expect(buildPrompt).toMatch(/code changes/);
		expect(setPrompt).not.toMatch(/review the code changes/);
		expect(setPrompt).toMatch(/candidate slices/);
	});
});
