import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	gitEnv,
	gitIn,
	isolatePiAgentDir,
	type Scratch,
} from './helpers/gitRepo.js';
import {run} from '../src/git.js';

/**
 * The RUNNER transcribes the build agent's `## Decisions` block into the DONE
 * RECORD (WORK-CONTRACT.md, "Where a BUILDER's RATIONALE lives").
 *
 * The builder does NO git, MUST NOT edit the task body, and does not own the
 * done-move, completion commit and PR body, so it cannot write its own rationale
 * into the done record, however the task's acceptance criteria are phrased. It
 * emits a `## Decisions` block on the ONE surface it owns (its final report,
 * arriving here as `input.body`) and the runner appends it while doing the
 * done-move, in the SAME atomic commit.
 *
 * House style (mirrors `runner-scoops-captured-notes.test.ts`): a throwaway
 * checkout + a local `--bare` arbiter + a STUBBED agent (the test writes the
 * files an agent would have left; no model, no git by the "agent"). No shared or
 * global location is touched.
 */

const ARBITER = 'arbiter';
const PASS = 'exit 0';

let scratch: Scratch;
let restorePiAgentDir: () => void;
beforeEach(() => {
	scratch = makeScratch('dorfl-decisions-');
	restorePiAgentDir = isolatePiAgentDir(scratch.root);
});
afterEach(() => {
	restorePiAgentDir();
	scratch.cleanup();
});

/** Read `path` as it rests on `<arbiter>/main` (after a fetch). */
function readFromArbiterMain(repo: string, path: string): string {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	const shown = run('git', ['show', `${ARBITER}/main:${path}`], repo, {
		env: gitEnv(),
	});
	expect(shown.status).toBe(0);
	return shown.stdout;
}

/** How many commits `<arbiter>/main` gained beyond the seeded root. */
function commitCountOnArbiterMain(repo: string): number {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	const log = run('git', ['rev-list', '--count', `${ARBITER}/main`], repo, {
		env: gitEnv(),
	});
	expect(log.status).toBe(0);
	return Number(log.stdout.trim());
}

/**
 * Stand a repo up exactly as the build caller's HEAD leaves it just before the
 * shared core: the task claimed, onboarded onto its work branch off fresh main,
 * with UNCOMMITTED agent source work in the tree.
 */
async function claimAndBranch(slug: string): Promise<string> {
	const {repo} = seedRepoWithArbiter(scratch.root, [slug]);
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/task-${slug}`, `${ARBITER}/main`], repo);
	// The build agent: leave UNCOMMITTED source work (it does no git).
	writeFileSync(join(repo, 'feature.txt'), 'the work\n');
	return repo;
}

/** A realistic final report: prose, then the block, then trailing prose. */
function reportWithDecisions(decisions: string): string {
	return [
		'Built the thing. Gate is green.',
		'',
		'## Decisions',
		'',
		decisions,
		'',
		'## Notes',
		'',
		'Nothing else of interest.',
	].join('\n');
}

describe("the runner transcribes the agent's `## Decisions` block into the done record", () => {
	it('appends the block VERBATIM to the done record, in the completion commit', async () => {
		const repo = await claimAndBranch('alpha');
		const before = commitCountOnArbiterMain(repo);

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'alpha',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			body: reportWithDecisions(
				'- Chose to REFUSE on an unknown flag rather than ignore it;\n' +
					'  the alternative (ignore) hides typos. Touches `run --strict`.',
			),
		});

		expect(core.outcome).toBe('completed');
		const record = readFromArbiterMain(repo, 'work/tasks/done/alpha.md');
		// The rationale reached the DURABLE record the reviewer + human read.
		expect(record).toContain('## Decisions');
		expect(record).toContain('Chose to REFUSE on an unknown flag');
		expect(record).toContain('Touches `run --strict`');
		// VERBATIM: the runner adds structure, never interpretation, and it does NOT
		// drag in the surrounding report prose (only the block's own body).
		expect(record).not.toContain('Built the thing');
		expect(record).not.toContain('Nothing else of interest');
		// SAME atomic commit: the transcription rides the completion commit, it does
		// not add a second one.
		expect(commitCountOnArbiterMain(repo)).toBe(before + 1);
	});

	it('a report with NO `## Decisions` block leaves the done record untouched', async () => {
		const repo = await claimAndBranch('beta');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'beta',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			body: 'Built it. Gate green. No non-obvious decisions were needed.',
		});

		expect(core.outcome).toBe('completed');
		const record = readFromArbiterMain(repo, 'work/tasks/done/beta.md');
		expect(record).not.toContain('## Decisions');
	});

	it('is a no-op when the agent reported nothing at all (no body)', async () => {
		const repo = await claimAndBranch('gamma');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'gamma',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		const record = readFromArbiterMain(repo, 'work/tasks/done/gamma.md');
		expect(record).not.toContain('## Decisions');
	});

	it('does NOT duplicate a block the record already carries (a re-run / continue)', async () => {
		const repo = await claimAndBranch('delta');
		// The task body already carries a `## Decisions` section (e.g. a prior
		// attempt transcribed one, or the tasker wrote resolved decisions into it).
		const readyPath = join(repo, 'work/tasks/ready/delta.md');
		writeFileSync(
			readyPath,
			`${readFileSync(readyPath, 'utf8')}\n## Decisions\n\n- already recorded earlier\n`,
		);

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'delta',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			body: reportWithDecisions('- a NEW decision that must not be appended'),
		});

		expect(core.outcome).toBe('completed');
		const record = readFromArbiterMain(repo, 'work/tasks/done/delta.md');
		expect(record.match(/^##\s+Decisions\s*$/gm)?.length).toBe(1);
		expect(record).toContain('already recorded earlier');
		expect(record).not.toContain('a NEW decision that must not be appended');
	});

	it('an ANNOTATED instruction heading (`## Decisions (to record while building)`) does not suppress a first-run transcription', async () => {
		const repo = await claimAndBranch('eta');
		const readyPath = join(repo, 'work/tasks/ready/eta.md');
		writeFileSync(
			readyPath,
			`${readFileSync(readyPath, 'utf8')}\n## Decisions (to record while building)\n\n- say which flag name you kept\n`,
		);

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'eta',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			body: reportWithDecisions('- kept `--strict` as the flag name'),
		});

		expect(core.outcome).toBe('completed');
		const record = readFromArbiterMain(repo, 'work/tasks/done/eta.md');
		expect(record).toContain('say which flag name you kept');
		expect(record).toMatch(/^## Decisions\s*$/m);
		expect(record).toContain('kept `--strict` as the flag name');
	});

	it('on a CONTINUED run (kept branch already done-moved), APPENDS the new run decisions under a continued-run heading and keeps the first run', async () => {
		const repo = await claimAndBranch('epsilon');
		// The kept branch from the FIRST run: its done-move commit already carries the
		// first run's transcribed `## Decisions` block (a requeue keep+continue).
		const readyRel = 'work/tasks/ready/epsilon.md';
		const doneRel = 'work/tasks/done/epsilon.md';
		run('mkdir', ['-p', join(repo, 'work/tasks/done')], repo);
		gitIn(['mv', readyRel, doneRel], repo);
		writeFileSync(
			join(repo, doneRel),
			`${readFileSync(join(repo, doneRel), 'utf8')}\n## Decisions\n\n- first run: kept the old flag name\n`,
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'feat(epsilon): first run'], repo);
		// The CONTINUED run's agent: new uncommitted work outside its first scope.
		writeFileSync(join(repo, 'outside-scope.txt'), 'second run work\n');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'epsilon',
			source: 'done',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			body: reportWithDecisions(
				'- second run: also touched outside-scope.txt to fix the build',
			),
		});

		expect(core.outcome).toBe('completed');
		const record = readFromArbiterMain(repo, doneRel);
		// The first run's decisions are KEPT.
		expect(record).toContain('first run: kept the old flag name');
		// The second run's decisions are RECORDED, under a heading marking a later run.
		expect(record).toMatch(
			/^## Decisions \(continued run, \d{4}-\d{2}-\d{2}\)\s*$/m,
		);
		expect(record).toContain(
			'second run: also touched outside-scope.txt to fix the build',
		);
		// Ordered: first run's block, then the continued run's block.
		expect(record.indexOf('first run:')).toBeLessThan(
			record.indexOf('second run:'),
		);
	});

	it('on a CONTINUED run, does not re-append a decisions block the record already carries verbatim', async () => {
		const repo = await claimAndBranch('zeta');
		const readyRel = 'work/tasks/ready/zeta.md';
		const doneRel = 'work/tasks/done/zeta.md';
		run('mkdir', ['-p', join(repo, 'work/tasks/done')], repo);
		gitIn(['mv', readyRel, doneRel], repo);
		writeFileSync(
			join(repo, doneRel),
			`${readFileSync(join(repo, doneRel), 'utf8')}\n## Decisions\n\n- the same decision\n`,
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'feat(zeta): first run'], repo);
		writeFileSync(join(repo, 'more.txt'), 'more\n');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'zeta',
			source: 'done',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			body: reportWithDecisions('- the same decision'),
		});

		expect(core.outcome).toBe('completed');
		const record = readFromArbiterMain(repo, doneRel);
		expect(record.match(/^##\s+Decisions\b/gm)?.length).toBe(1);
	});
});
