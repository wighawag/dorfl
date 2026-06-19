import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolveEligibility, resolveGate} from '../src/eligibility.js';
import {
	resolveSliceGate,
	resolveSlicingEligibility,
} from '../src/slicing-eligibility.js';
import {scan} from '../src/scan.js';
import {mergeConfig} from '../src/config.js';
import {registerMirrorWithWork} from './helpers/gitRepo.js';
import {performSlice, type SliceAgentRunner} from '../src/slicing.js';
import {buildSliceReviewPrompt} from '../src/slicer-review-loop.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * Tests for the DE-OVERLOADED `humanOnly` model + the slicer heuristic shift
 * (slice `de-overload-humanonly-narrow-slice-guard-and-slicer-heuristic`, PRD
 * `staging-pool-position-gate-and-trust-model` US #8, #10, #11; governing ADR
 * `placement-is-runner-deterministic-humanonly-is-agent-judgement`).
 *
 * The three orthogonal axes, each meaning one thing:
 *   - POSITION (folder, runner-deterministic): `work/tasks/backlog/` (staging, not
 *     eligible) vs `work/tasks/todo/` (the agent pool). Carries "review before the
 *     agent acts".
 *   - NATURE (slice `humanOnly`, agent judgement, NARROWED): "never-by-nature"
 *     (secrets/release/security) — survives even when the slice resides in the
 *     pool `work/tasks/todo/`. PRD `humanOnly` UNCHANGED (gates auto-slicing).
 *   - DISCOVERED (`needsAnswers`): unchanged.
 */

// --- Unit predicates: the three axes are orthogonal, each means one thing --

describe('slice `humanOnly` (NARROWED) — never agent-eligible, even in the pool', () => {
	it('humanOnly:true is not agent-claimable regardless of autoBuild / pool residency', () => {
		// The predicate operates on already-read frontmatter — the caller reads it
		// from `work/tasks/todo/` (the pool). `autoBuild:true` simulates the pool path
		// (the strongest possible policy); `humanOnly:true` still refuses.
		expect(resolveGateInputs({humanOnly: true})).toBe(false);
		const e = resolveEligibility({
			humanOnly: true,
			needsAnswers: undefined,
			blockedBy: [],
			doneSlugs: new Set(),
			autoBuild: true,
		});
		expect(e.gatePass).toBe(false);
		expect(e.eligible).toBe(false);
	});

	it('an undeclared slice in the pool IS eligible (the de-overload moves review-first to position, not to humanOnly)', () => {
		const e = resolveEligibility({
			humanOnly: undefined,
			needsAnswers: undefined,
			blockedBy: [],
			doneSlugs: new Set(),
			autoBuild: true,
		});
		expect(e.eligible).toBe(true);
	});

	it('needsAnswers:true blocks INDEPENDENTLY of humanOnly (orthogonal axes)', () => {
		const e = resolveEligibility({
			humanOnly: undefined,
			needsAnswers: true,
			blockedBy: [],
			doneSlugs: new Set(),
			autoBuild: true,
		});
		expect(e.gatePass).toBe(false);
		expect(e.eligible).toBe(false);
	});
});

describe('PRD `humanOnly` (UNCHANGED) — still blocks auto-slicing', () => {
	it('PRD humanOnly:true blocks the slicing gate even when autoSlice is on', () => {
		expect(resolveSliceGate(true, undefined, true)).toBe(false);
		const r = resolveSlicingEligibility({
			humanOnly: true,
			needsAnswers: undefined,
			briefAfter: [],
			slicedSlugs: new Set(),
			autoSlice: true,
		});
		expect(r.gatePass).toBe(false);
		expect(r.sliceable).toBe(false);
	});

	it('PRD needsAnswers:true is unchanged (orthogonal to humanOnly)', () => {
		const r = resolveSlicingEligibility({
			humanOnly: undefined,
			needsAnswers: true,
			briefAfter: [],
			slicedSlugs: new Set(),
			autoSlice: true,
		});
		expect(r.gatePass).toBe(false);
	});
});

// --- Pool-residency on a real BARE mirror (`--bare file://`, house pattern) -

describe('pool residency — humanOnly slice in `work/tasks/todo/` (the pool) is NOT eligible', () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'humanonly-de-overload-'));
	});
	afterEach(() => {
		rmSync(root, {recursive: true, force: true});
	});

	it('scan reports a backlog `humanOnly` slice as not eligible; an undeclared neighbour is eligible (autoBuild on)', async () => {
		const workspacesDir = join(root, '.agent-runner');
		registerMirrorWithWork(workspacesDir, 'repo', {
			backlog: {
				// Lives in the AGENT POOL `work/tasks/todo/` — even there, the narrowed
				// `humanOnly: true` survives (never-by-nature guard).
				'never-by-nature.md': slice({
					slug: 'never-by-nature',
					humanOnly: 'true',
				}),
				// Undeclared neighbour in the SAME pool: eligible under autoBuild (the
				// review-first signal lives at POSITION, not on this flag).
				'ordinary.md': slice({slug: 'ordinary'}),
			},
		});
		const report = await scan(mergeConfig({workspacesDir, autoBuild: true}));
		const items = report.repos[0].items;
		const never = items.find((i) => i.slug === 'never-by-nature')!;
		const ordinary = items.find((i) => i.slug === 'ordinary')!;
		expect(never.eligibility.gatePass).toBe(false);
		expect(never.eligibility.eligible).toBe(false);
		expect(ordinary.eligibility.eligible).toBe(true);
	});
});

// --- Slicer heuristic: review-first → STAGING-BIRTH (not a `humanOnly` stamp)

describe('slicer heuristic — review-first is staging-birth, NOT a `humanOnly` stamp', () => {
	let scratch: Scratch;
	let restorePiAgentDir: () => void;
	beforeEach(() => {
		scratch = makeScratch('humanonly-de-overload-slicer-');
		restorePiAgentDir = isolatePiAgentDir(scratch.root);
	});
	afterEach(() => {
		restorePiAgentDir();
		scratch.cleanup();
	});

	it('the slicing brief tells the agent to BIRTH slices in STAGING (`work/tasks/backlog/`) and reserves `humanOnly` for never-by-nature', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		// Seed a PRD.
		run('git', ['fetch', '-q', 'arbiter', 'main'], repo, {env: gitEnv()});
		seedPrdRaw(repo, 'it');
		let capturedPrompt = '';
		const agentRunner: SliceAgentRunner = ({cwd, prompt}) => {
			capturedPrompt = prompt;
			// Honour the brief: birth in STAGING, do not stamp humanOnly for review.
			const dir = join(cwd, 'work', 'tasks', 'backlog');
			mkdirSync(dir, {recursive: true});
			writeFileSync(
				join(dir, 'it-first.md'),
				'---\ntitle: it-first\nslug: it-first\nprd: it\n---\n\n## What to build\n\nbody\n',
			);
			return {ok: true};
		};
		const result = await performSlice({
			slug: 'it',
			cwd: repo,
			arbiter: 'arbiter',
			autoSlice: true,
			integration: 'merge',
			agentRunner,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('sliced');
		// The brief carries the de-overloaded language: birth in staging, narrow
		// humanOnly to never-by-nature, do NOT stamp humanOnly for review.
		expect(capturedPrompt).toMatch(/work\/pre-backlog/);
		expect(capturedPrompt).toMatch(/never-for-agents BY NATURE/);
		expect(capturedPrompt).toMatch(/Do NOT stamp `humanOnly` to mean "a human/);
		expect(capturedPrompt).toMatch(/Review-first is the staging position/);
	});

	it('the slicer-review-loop prompt carries the same narrowed `humanOnly` guidance', () => {
		const prompt = buildSliceReviewPrompt({
			slug: 'it',
			cwd: '/tmp/x',
			candidateSlices: ['work/tasks/backlog/it-a.md'],
			pass: 1,
			execution: 1,
		});
		expect(prompt).toMatch(/SLICE `humanOnly` IS NARROW/);
		expect(prompt).toMatch(/never-for-agents BY NATURE/);
		expect(prompt).toMatch(/Review-first is the staging position/);
	});
});

// --- Helpers ---------------------------------------------------------------

function resolveGateInputs(input: {humanOnly?: boolean}): boolean {
	return resolveGate(input.humanOnly, undefined, true);
}

function slice(frontmatter: Record<string, string>): string {
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', 'body');
	return lines.join('\n');
}

function seedPrdRaw(repo: string, slug: string): void {
	const dir = join(repo, 'work', 'briefs', 'ready');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		[
			'---',
			`title: ${slug}`,
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
	run('git', ['commit', '-q', '-m', `brief: ${slug}`], repo, {env: gitEnv()});
	run('git', ['push', '-q', 'arbiter', 'main'], repo, {env: gitEnv()});
}
