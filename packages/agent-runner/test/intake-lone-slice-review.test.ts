import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
	performIntake,
	buildLoneSliceReviewPrompt,
	parseLoneSliceReviewVerdict,
	type IntakeVerdict,
	type LoneSliceReviewGate,
} from '../src/intake.js';
import {parseIntakeMarker} from '../src/intake-marker.js';
import {
	type Issue,
	type IssueComment,
	type IssueProvider,
	type PostIssueCommentInput,
	type CloseIssueInput,
} from '../src/issue-provider.js';
import {
	makeScratch,
	isolatePiAgentDir,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `intake-lone-slice-bounded-internal-review` (PRD `issue-intake`, observation
 * `intake-lone-slice-skips-adversarial-review-the-prd-path-gets`, rulings A/B/C):
 * intake's lone-SLICE outcome runs a BOUNDED (3-round, HARD-CAPPED) adversarial
 * self-review on the SINGLE drafted slice BEFORE emitting it. CONVERGE → emit the
 * (edited) slice + completion comment; NON-CONVERGE → flip SLICE→ASK carrying the
 * draft + open question(s) in the comment body (the EXISTING `asked` outcome,
 * `kind=ask` marker — no new outcome/marker/flag).
 *
 * House style mirrors `intake.test.ts`: a throwaway checkout + a `--bare` arbiter,
 * `gitEnv()` isolation, and the SEAMs STUBBED — the issue seam (no `gh`/network) +
 * a CANNED decision verdict + a CANNED review verdict through the new injectable
 * gate seam (no model). The review prompt's JUDGEMENT is never unit-tested — only
 * the bounded control flow + the convergence/flip dispatch.
 */

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('agent-runner-intake-review-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

const ARBITER = 'arbiter';

/** A stubbed issue seam (no `gh`/network): canned issue, in-memory labels/comments. */
function stubIssueProvider(
	opts: {issue?: Partial<Issue>; comments?: IssueComment[]} = {},
): IssueProvider & {
	readonly comments: PostIssueCommentInput[];
	readonly closes: CloseIssueInput[];
} {
	const comments: PostIssueCommentInput[] = [];
	const closes: CloseIssueInput[] = [];
	const labels: string[] = [];
	const provider: IssueProvider & {
		comments: PostIssueCommentInput[];
		closes: CloseIssueInput[];
	} = {
		name: 'stub',
		comments,
		closes,
		async getIssue({issueNumber}) {
			return {
				number: issueNumber,
				title: 'Add a --quiet flag to the CLI',
				body: 'It should suppress the progress notes.',
				author: 'octocat',
				state: 'open',
				...opts.issue,
			};
		},
		async listComments() {
			return opts.comments ?? [];
		},
		async postIssueComment(input) {
			comments.push(input);
			return {posted: true, instruction: `commented on #${input.issueNumber}`};
		},
		async closeIssue(input) {
			closes.push(input);
			return {closed: true, instruction: `closed #${input.issueNumber}`};
		},
		async getLabels() {
			return {
				outcome: 'ok' as const,
				supported: true,
				labels: [...labels],
				instruction: 'read labels',
			};
		},
		async addLabel({label}) {
			if (!labels.includes(label)) {
				labels.push(label);
			}
			return {
				outcome: 'applied' as const,
				applied: true,
				instruction: `added ${label}`,
			};
		},
		async removeLabel({label}) {
			const i = labels.indexOf(label);
			if (i !== -1) {
				labels.splice(i, 1);
			}
			return {
				outcome: 'applied' as const,
				applied: true,
				instruction: `removed ${label}`,
			};
		},
	};
	return provider;
}

/** A canned `slice` decision verdict (the STUBBED decision seam — no model/network). */
const SLICE_VERDICT: IntakeVerdict = {
	outcome: 'slice',
	sliceSlug: 'add-quiet-flag',
	sliceTitle: 'Add a --quiet flag to suppress progress notes',
	sliceBody: [
		'## What to build',
		'',
		'A --quiet flag on the CLI that suppresses the progress notes.',
		'',
		'## Acceptance criteria',
		'',
		'- [ ] --quiet suppresses the >> notes',
		'',
		'## Prompt',
		'',
		'> Add a --quiet flag.',
	].join('\n'),
};

/** A converging review gate: `approve` on the first round, no edit. */
const converge: LoneSliceReviewGate = async () => ({
	verdict: 'approve',
	findings: [],
});

describe('intake <N> — the lone-slice bounded internal review (stubbed review gate)', () => {
	it('CONVERGE: a `slice` verdict whose review converges writes the slice + posts the completion comment (outcome sliced)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider();
		let rounds = 0;
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => SLICE_VERDICT,
			reviewSlice: async () => {
				rounds++;
				return {verdict: 'approve', findings: []};
			},
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');
		expect(result.emitted).toBe('work/backlog/add-quiet-flag.md');
		// Exactly one review round ran (the natural terminator on the first approve).
		expect(rounds).toBe(1);
		// The slice rode the work/<slug> branch (propose default); main untouched.
		expect(existsOnArbiterMain(repo, 'backlog', 'add-quiet-flag')).toBe(false);
		gitIn(['fetch', '-q', ARBITER], repo);
		const onBranch = gitIn(
			['show', `${ARBITER}/work/add-quiet-flag:work/backlog/add-quiet-flag.md`],
			repo,
		);
		expect(onBranch).toMatch(/^issue: 42$/m);
		// The `slice created` completion comment was posted (the existing success path).
		expect(issueProvider.comments).toHaveLength(1);
		expect(issueProvider.comments[0].body).toContain('Created slice');
		// The success path used the existing `created` marker, NOT a new kind.
		const marker = parseIntakeMarker(issueProvider.comments[0].body);
		expect(marker?.kind).toBe('created');
	});

	it('CONVERGE WITH AN EDIT: a round proposes a replacement body applied IN MEMORY and re-reviewed; the EMITTED slice reflects the edit and NO work/backlog write happens before convergence', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider();
		const editedBody = [
			'## What to build',
			'',
			'A --quiet flag that suppresses ALL progress notes (refined by review).',
			'',
			'## Acceptance criteria',
			'',
			'- [ ] --quiet suppresses every >> note (REVIEW-EDITED-MARKER)',
			'',
			'## Prompt',
			'',
			'> Add a --quiet flag (tightened).',
		].join('\n');
		let round = 0;
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => SLICE_VERDICT,
			reviewSlice: async (input) => {
				round++;
				if (round === 1) {
					// PRE-CONVERGENCE round: propose an edit and BLOCK (re-review). The
					// reviewer must see the ORIGINAL drafted body this round.
					expect(input.body).toContain('suppresses the progress notes.');
					// No file may exist on disk yet (no pre-emit write).
					expect(() =>
						readFileSync(join(repo, 'work/backlog/add-quiet-flag.md'), 'utf8'),
					).toThrow();
					return {
						verdict: 'block',
						findings: [
							{
								severity: 'blocking',
								question: 'tighten the acceptance criteria',
							},
						],
						edit: editedBody,
					};
				}
				// SECOND round: the reviewer now sees the EDITED body (applied in memory).
				expect(input.body).toContain('REVIEW-EDITED-MARKER');
				return {verdict: 'approve', findings: []};
			},
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('sliced');
		expect(round).toBe(2);
		// The EMITTED slice reflects the edit (the body differs from the first draft).
		gitIn(['fetch', '-q', ARBITER], repo);
		const onBranch = gitIn(
			['show', `${ARBITER}/work/add-quiet-flag:work/backlog/add-quiet-flag.md`],
			repo,
		);
		expect(onBranch).toContain('REVIEW-EDITED-MARKER');
		expect(onBranch).not.toContain('suppresses the >> notes');
	});

	it('CAP = 3 HARD-CODED: a never-converging review stops after EXACTLY 3 rounds and flips to ASK (no infinite loop, no silent emit)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider({issue: {number: 9}});
		let rounds = 0;
		const result = await performIntake({
			issueNumber: 9,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => SLICE_VERDICT,
			// ALWAYS blocks (never converges) — the hard cap must terminate it.
			reviewSlice: async () => {
				rounds++;
				return {
					verdict: 'block',
					findings: [{severity: 'blocking', question: 'still unclear'}],
					questions: ['What does --quiet actually suppress?'],
				};
			},
			env: gitEnv(),
		});

		// EXACTLY 3 rounds ran, then it flipped to ASK (not an infinite loop).
		expect(rounds).toBe(3);
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('asked');
		// NO slice was written / integrated (no silent emit of the under-refined slice).
		expect(result.emitted).toBeUndefined();
		expect(existsOnArbiterMain(repo, 'backlog', 'add-quiet-flag')).toBe(false);
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(gitIn(['branch', '-r'], repo)).not.toContain(
			`${ARBITER}/work/add-quiet-flag`,
		);
	});

	it('NON-CONVERGE flips SLICE→ASK: ONE comment carrying BOTH the draft AND the open question(s), stamped kind=ask, NO slice written/integrated', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider({issue: {number: 11}});
		const result = await performIntake({
			issueNumber: 11,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => SLICE_VERDICT,
			// A blocking question with no clear thread answer on round 1 → flip to ASK.
			reviewSlice: async () => ({
				verdict: 'block',
				findings: [{severity: 'blocking', question: 'destination check fails'}],
				questions: ['Should --quiet also suppress warnings, or only notes?'],
			}),
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		// Reuses the EXISTING `asked` outcome — no new IntakeRunOutcome.
		expect(result.outcome).toBe('asked');
		// NO artifact emitted, NO integrate, the issue is not closed.
		expect(result.emitted).toBeUndefined();
		expect(result.closed).toBeUndefined();
		expect(existsOnArbiterMain(repo, 'backlog', 'add-quiet-flag')).toBe(false);

		// ONE comment posted, carrying BOTH the open question(s) AND the proposed draft.
		expect(issueProvider.comments).toHaveLength(1);
		const body = issueProvider.comments[0].body;
		expect(body).toContain('Should --quiet also suppress warnings');
		// The draft rides in the BODY (the slice's frontmatter + body), not a new marker.
		expect(body).toContain('slug: add-quiet-flag');
		expect(body).toMatch(/issue: 11/);
		expect(body).toContain('## What to build');
		// The EXISTING `kind=ask` marker — NOT a new marker kind (ruling C).
		const marker = parseIntakeMarker(body);
		expect(marker?.kind).toBe('ask');
	});

	it('the lone-slice flip carries any EDITS made before the non-converge into the ASK draft (the human reacts to the refined draft)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider({issue: {number: 12}});
		let round = 0;
		const result = await performIntake({
			issueNumber: 12,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => SLICE_VERDICT,
			reviewSlice: async () => {
				round++;
				// Round 1: tighten the draft (edit) AND block with an open question that
				// no edit can resolve → the cap eventually flips to ASK with the tightened
				// draft.
				return {
					verdict: 'block',
					findings: [{severity: 'blocking', question: 'needs the human'}],
					...(round === 1
						? {edit: '## What to build\n\nTIGHTENED-DRAFT-MARKER\n'}
						: {}),
					questions: ['A genuinely open product question for the maintainer.'],
				};
			},
			env: gitEnv(),
		});

		expect(result.outcome).toBe('asked');
		expect(round).toBe(3);
		const body = issueProvider.comments[0].body;
		// The ASK draft reflects the round-1 edit (the refined draft, not the original).
		expect(body).toContain('TIGHTENED-DRAFT-MARKER');
	});

	it('a review launch/parse FAILURE maps onto `agent-failed` (exit 1) — never a silent emit of the un-reviewed slice', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		const issueProvider = stubIssueProvider();
		const result = await performIntake({
			issueNumber: 42,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider,
			decide: async () => SLICE_VERDICT,
			// The review gate throws (a launch/parse failure) — the dispatcher's
			// try/catch maps it onto agent-failed, NOT a silent emit.
			reviewSlice: async () => {
				throw new Error('review agent produced no parseable verdict');
			},
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('agent-failed');
		// NO slice emitted on the failure path; the lock is released (not leaked).
		expect(result.emitted).toBeUndefined();
		expect(existsOnArbiterMain(repo, 'backlog', 'add-quiet-flag')).toBe(false);
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(gitIn(['branch', '-r'], repo)).not.toContain(
			`${ARBITER}/work/add-quiet-flag`,
		);
		// No comment posted (no draft, no question) — it degraded honestly.
		expect(issueProvider.comments).toHaveLength(0);
	});

	it('the review runs ONLY on the slice outcome — ask/prd/bounce never invoke the review gate', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, []);
		let reviewCalls = 0;
		const spyGate: LoneSliceReviewGate = async () => {
			reviewCalls++;
			return {verdict: 'approve', findings: []};
		};

		// ASK: no review.
		await performIntake({
			issueNumber: 1,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider({issue: {number: 1}}),
			decide: async () => ({outcome: 'ask', question: 'clarify?'}),
			reviewSlice: spyGate,
			env: gitEnv(),
		});
		// PRD: no review (the PRD path is covered by `do prd:`'s own loop).
		await performIntake({
			issueNumber: 2,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider({issue: {number: 2}}),
			decide: async () => ({outcome: 'prd', prdTitle: 'A coherent feature'}),
			reviewSlice: spyGate,
			env: gitEnv(),
		});
		// BOUNCE: no review.
		await performIntake({
			issueNumber: 3,
			cwd: repo,
			arbiter: ARBITER,
			issueProvider: stubIssueProvider({issue: {number: 3}}),
			decide: async () => ({outcome: 'bounce', bounceMessage: 'unrelated'}),
			reviewSlice: spyGate,
			env: gitEnv(),
		});

		expect(reviewCalls).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// The lone-slice review PROMPT + PARSER (the production wire). The prompt's
// JUDGEMENT is NOT unit-tested — only that it frames the right lenses (N=1: the
// SET lenses OFF) and that the parser is the `{verdict, findings, edit, questions}`
// twin of the slicer loop's, anchored on `"verdict"` via the shared extractor.
// ---------------------------------------------------------------------------
describe('buildLoneSliceReviewPrompt — frames the per-slice + destination lenses, SET lenses OFF', () => {
	it('names the per-slice well-formedness + destination check and explicitly turns the SET/graph/overlap lenses OFF (N=1)', () => {
		const prompt = buildLoneSliceReviewPrompt({
			slug: 'add-quiet-flag',
			issueNumber: 42,
			title: 'Add a --quiet flag',
			body: '## What to build\n\nA --quiet flag.',
			round: 1,
			cwd: '/tmp/x',
		});
		expect(prompt).toMatch(/destination check/i);
		expect(prompt).toMatch(/well-formedness/i);
		// The SET lenses are explicitly OFF for N=1.
		expect(prompt).toMatch(/N=1/);
		expect(prompt).toMatch(/are OFF|OFF:/);
		expect(prompt).toMatch(/issue #42/);
		// It carries the hard-coded cap in the framing.
		expect(prompt).toMatch(/at most 3/);
	});
});

describe('parseLoneSliceReviewVerdict — the {verdict, findings, edit, questions} parse table', () => {
	it('parses an approve verdict out of prose-wrapped + fenced output', () => {
		const output = [
			'I reviewed the slice.',
			'```json',
			JSON.stringify({verdict: 'approve', findings: []}),
			'```',
		].join('\n');
		const v = parseLoneSliceReviewVerdict(output);
		expect(v.verdict).toBe('approve');
		expect(v.findings).toEqual([]);
	});

	it('parses a block verdict with an edit + questions', () => {
		const v = parseLoneSliceReviewVerdict(
			JSON.stringify({
				verdict: 'block',
				findings: [{severity: 'blocking', question: 'q', context: 'c'}],
				edit: '## What to build\n\nrefined',
				questions: ['open?'],
			}),
		);
		expect(v.verdict).toBe('block');
		expect(v.findings[0].severity).toBe('blocking');
		expect(v.findings[0].context).toBe('c');
		expect(v.edit).toBe('## What to build\n\nrefined');
		expect(v.questions).toEqual(['open?']);
	});

	it('THROWS when no JSON object is present', () => {
		expect(() => parseLoneSliceReviewVerdict('no verdict here')).toThrow(
			/no parseable/i,
		);
	});

	it('THROWS on invalid JSON', () => {
		expect(() => parseLoneSliceReviewVerdict('{"verdict":"approve",}')).toThrow(
			/not valid JSON/i,
		);
	});

	it('THROWS on a verdict not in {approve, block}', () => {
		expect(() => parseLoneSliceReviewVerdict('{"verdict":"maybe"}')).toThrow(
			/approve.*block/i,
		);
	});
});

// ---------------------------------------------------------------------------
// Scope-fence inspection (AC #5/#6): the bounded review adds NO new outcome /
// marker / flag, and `intake.ts` never imports or calls the slicer loop.
// ---------------------------------------------------------------------------
describe('the bounded review introduces no new outcome/marker/flag and does not reuse the slicer loop', () => {
	const intakeSrc = readFileSync(
		join(__dirname, '..', 'src', 'intake.ts'),
		'utf8',
	);

	it('does NOT import or call runSliceReviewLoop (intake-native, not slicer-loop integration)', () => {
		// No IMPORT of the slicer-loop module (a textual mention in a doc comment
		// explaining what NOT to do is fine; an import/require/call is not).
		expect(intakeSrc).not.toMatch(/from\s+['"][^'"]*slicer-review-loop/);
		expect(intakeSrc).not.toMatch(/import\([^)]*slicer-review-loop/);
		// No CALL to runSliceReviewLoop (a call is `runSliceReviewLoop(`).
		expect(intakeSrc).not.toMatch(/runSliceReviewLoop\s*\(/);
	});

	it('adds no new IntakeRunOutcome (the union is unchanged; the flip reuses `asked`)', () => {
		// The non-converge sink is the EXISTING `asked` outcome — there is no
		// `non-converge`/`under-reviewed`/`review-failed` member on IntakeRunOutcome.
		const outcomeBlock = intakeSrc.slice(
			intakeSrc.indexOf('export type IntakeRunOutcome'),
			intakeSrc.indexOf('export interface IntakeResult'),
		);
		expect(outcomeBlock).toContain("'asked'");
		expect(outcomeBlock).not.toMatch(
			/non-converge|under-reviewed|review-failed/,
		);
	});

	it('adds no review-loop config flag / knob (no --slicer-loop-style knob, no PerformIntakeOptions cap field)', () => {
		// The cap is a hard-coded literal (ruling A/B): no flag, no config, no option.
		expect(intakeSrc).toContain('LONE_SLICE_REVIEW_MAX_ROUNDS = 3');
		expect(intakeSrc).not.toMatch(/slicerLoop|reviewLoopMax|loneSliceLoop/);
	});
});
