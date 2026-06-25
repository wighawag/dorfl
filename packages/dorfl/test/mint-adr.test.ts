import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {mintAdr, buildAdrBody, adrItemRel} from '../src/mint-adr.js';
import {
	newSidecar,
	serialiseSidecar,
	type SidecarModel,
} from '../src/sidecar.js';
import {
	makeScratch,
	gitEnv,
	gitIn,
	seedRepoWithArbiter,
	raceClone,
	existsOnArbiterMain,
	pathOnArbiterMain,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `agentic-apply-mint-adr-route` task (prd
 * `agentic-question-resolution-retire-disposition-vocabulary` US #2) — the
 * ADR-MINT route over a throwaway git repo (the house CAS-seam style, the SIBLING
 * of triage-persist.test.ts's `promoteObservation` tests). The task's acceptance
 * criteria pinned here:
 *
 *   - a `mint-adr` verdict creates a SELF-CONTAINED ADR in `docs/adr/` per
 *     ADR-FORMAT, built from the answer(s) + source item;
 *   - the source observation + its sidecar are DELETED in the SAME atomic commit
 *     as the ADR create (delete-on-promote);
 *   - a CAS-loser backs off leaving the source INTACT;
 *   - tests that mutate git ISOLATE their work in throwaway repos (no shared
 *     location is written).
 */

const MECHANISM_SIGNAL = 'MECHANISM-SIGNAL-carried-into-the-ADR-context';
const ANSWER_SIGNAL = 'ANSWER-SIGNAL-carried-into-the-ADR-why';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-mint-adr-');
});
afterEach(() => {
	scratch.cleanup();
});

/** Seed an answered observation (working tree) ready for the mint-adr route. */
function seedAnsweredObs(repo: string, slug: string): string {
	const itemPath = `work/notes/observations/${slug}.md`;
	mkdirSync(join(repo, 'work', 'notes', 'observations'), {recursive: true});
	writeFileSync(
		join(repo, itemPath),
		[
			'---',
			`title: ${slug}`,
			'date: 2026-06-11',
			'needsAnswers: true',
			'---',
			'',
			`A captured signal awaiting triage. ${MECHANISM_SIGNAL}`,
			'',
			'## Open questions',
			'',
			'1. Should this become a recorded decision?',
			'',
		].join('\n'),
	);
	let model: SidecarModel = newSidecar(`observation:${slug}`, [
		{question: 'What becomes of this signal?'},
	]);
	model = {
		...model,
		entries: model.entries.map((e) => ({...e, answer: ANSWER_SIGNAL})),
	};
	mkdirSync(join(repo, 'work', 'questions'), {recursive: true});
	writeFileSync(
		join(repo, `work/questions/observation-${slug}.md`),
		serialiseSidecar(model),
	);
	return itemPath;
}

describe('mintAdr — ADR creation through the CAS (the sibling of promoteObservation)', () => {
	it('creates a SELF-CONTAINED ADR in docs/adr/ on the arbiter + DELETES the observation + sidecar in the SAME commit (exit 0)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const itemPath = seedAnsweredObs(seeded.repo, 'adr');
		const sidecarPath = 'work/questions/observation-adr.md';
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'answered'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const result = await mintAdr({
			cwd: seeded.repo,
			item: 'observation:adr',
			itemPath,
			adrTitle: 'Record the settled decision',
			answers: [
				{question: 'What becomes of this signal?', answer: ANSWER_SIGNAL},
			],
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('minted');
		expect(result.exitCode).toBe(0);
		expect(result.adrPath).toBe('docs/adr/adr.md');

		// The ADR landed in docs/adr/ (OUTSIDE the work board) on arbiter/main.
		expect(pathOnArbiterMain(seeded.repo, 'docs/adr/adr.md')).toBe(true);
		const adr = gitIn(['show', 'arbiter/main:docs/adr/adr.md'], seeded.repo);
		// ADR-FORMAT shape: a frontmatter fence + a `# ADR: {title}` heading + the
		// context/decision/why sections.
		expect(adr).toContain('# ADR: Record the settled decision');
		expect(adr).toContain('status: accepted');
		expect(adr).toContain('## Context');
		expect(adr).toContain('## Decision');
		expect(adr).toContain('## Why');
		// SELF-CONTAINMENT: the source context + the decision's WHY (the answer) are
		// carried IN, so the ADR reads alone (the precondition for the source delete).
		expect(adr).toContain(MECHANISM_SIGNAL);
		expect(adr).toContain(ANSWER_SIGNAL);

		// The observation + its sidecar are DELETED on the arbiter (delete-on-promote).
		expect(pathOnArbiterMain(seeded.repo, itemPath)).toBe(false);
		expect(pathOnArbiterMain(seeded.repo, sidecarPath)).toBe(false);

		// The create + the two deletions ride ONE atomic commit on arbiter/main.
		const touched = gitIn(
			['show', '--name-status', '--no-renames', '--format=', 'arbiter/main'],
			seeded.repo,
		)
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);
		expect(touched).toContain(`A\tdocs/adr/adr.md`);
		expect(touched).toContain(`D\t${itemPath}`);
		expect(touched).toContain(`D\t${sidecarPath}`);
	});

	it('an agent-drafted adrBody is used verbatim (wrapped in the ADR file shape)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const itemPath = seedAnsweredObs(seeded.repo, 'drafted');
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'answered'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const result = await mintAdr({
			cwd: seeded.repo,
			item: 'observation:drafted',
			itemPath,
			adrTitle: 'Drafted title',
			adrBody:
				'## Context\n\nDISTINCT-DRAFTED-ADR-BODY\n\n## Decision\n\nwe chose X.\n',
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('minted');
		const adr = gitIn(
			['show', 'arbiter/main:docs/adr/drafted.md'],
			seeded.repo,
		);
		expect(adr).toContain('# ADR: Drafted title');
		expect(adr).toContain('DISTINCT-DRAFTED-ADR-BODY');
	});

	it('honours an explicit adrSlug (the minted ADR identity, keyed by the new path)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const itemPath = seedAnsweredObs(seeded.repo, 'src');
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'answered'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const result = await mintAdr({
			cwd: seeded.repo,
			item: 'observation:src',
			itemPath,
			adrSlug: 'renamed-adr',
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('minted');
		expect(result.adrPath).toBe('docs/adr/renamed-adr.md');
		expect(pathOnArbiterMain(seeded.repo, 'docs/adr/renamed-adr.md')).toBe(
			true,
		);
	});

	it('an empty ADR slug is a usage error (cannot draft an ADR)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const itemPath = seedAnsweredObs(seeded.repo, 'empt');
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'answered'], seeded.repo);

		const result = await mintAdr({
			cwd: seeded.repo,
			item: 'observation:empt',
			itemPath,
			adrSlug: '   ',
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('usage-error');
		expect(result.exitCode).toBe(1);
		// Nothing deleted (the source + sidecar are INTACT).
		expect(existsSync(join(seeded.repo, itemPath))).toBe(true);
	});

	it('a same-slug ADR race ⇒ exactly one mint creates, the loser fails CAS (loser backs off, source intact)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		const a = raceClone(seeded, 'a');
		const b = raceClone(seeded, 'b');
		for (const dir of [a, b]) {
			seedAnsweredObs(dir, 'dupadr');
			gitIn(['add', '-A'], dir);
			gitIn(['commit', '-q', '-m', 'answered'], dir);
		}
		const [ra, rb] = await Promise.all([
			mintAdr({
				cwd: a,
				item: 'observation:dupadr',
				itemPath: 'work/notes/observations/dupadr.md',
				arbiter: 'arbiter',
				env: gitEnv(),
			}),
			mintAdr({
				cwd: b,
				item: 'observation:dupadr',
				itemPath: 'work/notes/observations/dupadr.md',
				arbiter: 'arbiter',
				env: gitEnv(),
			}),
		]);
		const won = [ra, rb].filter((r) => r.exitCode === 0);
		const lost = [ra, rb].filter((r) => r.exitCode === 2);
		expect(won).toHaveLength(1);
		expect(lost).toHaveLength(1);
		expect(won[0].outcome).toBe('minted');
		expect(lost[0].outcome).toBe('lost');
		expect(pathOnArbiterMain(seeded.repo, 'docs/adr/dupadr.md')).toBe(true);
	});

	it('a LOST race leaves the source UNDELETED for a retry (the loser backs off without deleting)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, []);
		// Pre-create the target ADR path on the arbiter so the mint always loses.
		const adrPath = adrItemRel('taken');
		mkdirSync(join(seeded.repo, 'docs', 'adr'), {recursive: true});
		writeFileSync(join(seeded.repo, adrPath), '# ADR: already here\n');
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'pre-existing adr'], seeded.repo);
		gitIn(['push', '-q', 'arbiter', 'main'], seeded.repo);

		const itemPath = seedAnsweredObs(seeded.repo, 'taken');
		gitIn(['add', '-A'], seeded.repo);
		gitIn(['commit', '-q', '-m', 'answered'], seeded.repo);

		const result = await mintAdr({
			cwd: seeded.repo,
			item: 'observation:taken',
			itemPath,
			arbiter: 'arbiter',
			env: gitEnv(),
		});
		expect(result.outcome).toBe('lost');
		expect(result.exitCode).toBe(2);
		// The loser DELETES nothing: the observation + its sidecar are STILL present.
		expect(existsSync(join(seeded.repo, itemPath))).toBe(true);
		expect(
			existsSync(join(seeded.repo, 'work/questions/observation-taken.md')),
		).toBe(true);
	});

	it('uses the existing slug-named docs/adr/ convention (NOT the NNNN- numeric prefix)', () => {
		expect(adrItemRel('my-decision')).toBe('docs/adr/my-decision.md');
	});
});

describe('buildAdrBody — self-contained ADR body from the answer(s) + source', () => {
	it('carries the source context + the answer WHY into the context/decision/why sections', () => {
		const body = buildAdrBody({
			slug: 'd',
			title: 'A decision',
			observation: [
				'---',
				'title: d',
				'---',
				'',
				`The source signal: ${MECHANISM_SIGNAL}`,
				'',
				'## Open questions',
				'',
				'1. open?',
				'',
			].join('\n'),
			answers: [{question: 'Decide?', answer: ANSWER_SIGNAL}],
		});
		expect(body).toContain('# ADR: A decision');
		expect(body).toContain('## Context');
		expect(body).toContain(MECHANISM_SIGNAL);
		expect(body).toContain('## Decision');
		expect(body).toContain('Decide?');
		expect(body).toContain('## Why');
		expect(body).toContain(ANSWER_SIGNAL);
		// An ADR records a SETTLED decision — the source's open-questions scoping is
		// deliberately NOT carried in (unlike a promoted task/prd).
		expect(body).not.toContain('open?');
	});

	it('is never empty even with no threaded answers (falls back to the source prose)', () => {
		const body = buildAdrBody({
			slug: 'd',
			title: 'A decision',
			observation: `Just some prose: ${MECHANISM_SIGNAL}`,
			answers: [],
		});
		expect(body).toContain(MECHANISM_SIGNAL);
		expect(body).toContain('## Decision');
	});
});
