import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, readFileSync, mkdirSync} from 'node:fs';
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

	it('drops reviewer-addressed lines from the block and WARNS, keeping the decision', async () => {
		const repo = await claimAndBranch('theta');
		const sink = noteSink();

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'theta',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			note: sink.note,
			body: reportWithDecisions(
				[
					'I could not add the ## Decisions section myself (no edits to the task body).',
					'Please append this line to work/tasks/done/theta.md:',
					'',
					'- Kept the queue per session; a global queue would leak replies.',
				].join('\n'),
			),
		});

		expect(core.outcome).toBe('completed');
		const record = readFromArbiterMain(repo, 'work/tasks/done/theta.md');
		expect(record).toContain('Kept the queue per session');
		expect(record).not.toContain('I could not add');
		expect(record).not.toContain('Please append');
		expect(
			sink.lines.some((l) =>
				/Warning: dropped 2 reviewer-addressed lines/.test(l),
			),
		).toBe(true);
	});
});

/** Capture every `note(...)` line a run emits. */
function noteSink(): {note: (m: string) => void; lines: string[]} {
	const lines: string[] = [];
	return {note: (m: string) => lines.push(m), lines};
}

/** The agent writes a decisions note under `work/notes/observations/` (no git). */
function writeDecisionsNote(repo: string, name: string): string {
	const rel = `work/notes/observations/${name}`;
	mkdirSync(join(repo, 'work/notes/observations'), {recursive: true});
	writeFileSync(join(repo, rel), '# Decisions\n\n- chose A over B\n');
	return rel;
}

describe('the runner links a decisions NOTE the agent wrote but did not link', () => {
	it('no `## Decisions` block: adds one linking the note with a path relative to the done record', async () => {
		const repo = await claimAndBranch('iota');
		const noteRel = writeDecisionsNote(repo, 'iota-decisions.md');
		const sink = noteSink();
		const before = commitCountOnArbiterMain(repo);

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'iota',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			note: sink.note,
			body: 'Built it. Decisions are in the observations note.',
		});

		expect(core.outcome).toBe('completed');
		const record = readFromArbiterMain(repo, 'work/tasks/done/iota.md');
		expect(record).toMatch(/^## Decisions\s*$/m);
		expect(record).toContain(
			'[iota-decisions.md](../../notes/observations/iota-decisions.md)',
		);
		// The note itself landed too, and all of it in ONE completion commit.
		expect(readFromArbiterMain(repo, noteRel)).toContain('chose A over B');
		expect(commitCountOnArbiterMain(repo)).toBe(before + 1);
		expect(
			sink.lines.some((l) =>
				l.includes(`Warning: the agent wrote ${noteRel} without linking it`),
			),
		).toBe(true);
	});

	it('a block that does not mention the note: appends the link to that block', async () => {
		const repo = await claimAndBranch('kappa');
		writeDecisionsNote(repo, 'kappa-decisions.md');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'kappa',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			body: reportWithDecisions('- kept the old flag name'),
		});

		expect(core.outcome).toBe('completed');
		const record = readFromArbiterMain(repo, 'work/tasks/done/kappa.md');
		expect(record.match(/^##\s+Decisions\b/gm)?.length).toBe(1);
		expect(record).toContain('- kept the old flag name');
		expect(record).toContain('(../../notes/observations/kappa-decisions.md)');
		expect(record.indexOf('kept the old flag name')).toBeLessThan(
			record.indexOf('kappa-decisions.md'),
		);
	});

	it('a block that already links the note is left exactly as written', async () => {
		const repo = await claimAndBranch('lambda');
		writeDecisionsNote(repo, 'lambda-decisions.md');
		const sink = noteSink();
		const block =
			'- See [lambda-decisions.md](../../notes/observations/lambda-decisions.md).';

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'lambda',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			note: sink.note,
			body: reportWithDecisions(block),
		});

		expect(core.outcome).toBe('completed');
		const record = readFromArbiterMain(repo, 'work/tasks/done/lambda.md');
		expect(record.match(/lambda-decisions\.md\)/g)?.length).toBe(1);
		expect(sink.lines.some((l) => l.includes('without linking it'))).toBe(
			false,
		);
	});

	it('ordinary observation notes are NOT linked, even with "decision" in the name', async () => {
		const repo = await claimAndBranch('mu');
		writeDecisionsNote(repo, 'spotted-flaky-test.md');
		writeDecisionsNote(repo, 'decision-gate-flaky.md');
		writeDecisionsNote(repo, 'review-decision-parser-bug.md');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'mu',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			body: 'Built it.',
		});

		expect(core.outcome).toBe('completed');
		const record = readFromArbiterMain(repo, 'work/tasks/done/mu.md');
		expect(record).not.toContain('## Decisions');
		expect(record).not.toContain('spotted-flaky-test');
		expect(record).not.toContain('decision-gate-flaky');
		expect(record).not.toContain('review-decision-parser-bug');
	});

	it('a dated `<slug>-decisions-YYYY-MM-DD.md` note IS linked', async () => {
		const repo = await claimAndBranch('nu');
		writeDecisionsNote(repo, 'nu-decisions-2026-10-30.md');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'nu',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			body: 'Built it.',
		});

		expect(core.outcome).toBe('completed');
		const record = readFromArbiterMain(repo, 'work/tasks/done/nu.md');
		expect(record).toContain(
			'(../../notes/observations/nu-decisions-2026-10-30.md)',
		);
	});

	it('a tasker instruction heading as the last section gets a NEW Decisions section, not an append under it', async () => {
		const repo = await claimAndBranch('xi');
		const readyPath = join(repo, 'work/tasks/ready/xi.md');
		writeFileSync(
			readyPath,
			`${readFileSync(readyPath, 'utf8')}\n## Decisions (to record while building)\n\n- say which flag name you kept\n`,
		);
		writeDecisionsNote(repo, 'xi-decisions.md');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'xi',
			source: 'tasks-ready',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			body: 'Built it.',
		});

		expect(core.outcome).toBe('completed');
		const record = readFromArbiterMain(repo, 'work/tasks/done/xi.md');
		expect(record).toMatch(/^## Decisions\s*$/m);
		expect(
			record.indexOf('## Decisions (to record while building)'),
		).toBeLessThan(record.search(/^## Decisions\s*$/m));
		expect(record).toContain('(../../notes/observations/xi-decisions.md)');
	});

	it('on a CONTINUED run, links a decisions note new in that run under the continued-run block', async () => {
		const repo = await claimAndBranch('omicron');
		const readyRel = 'work/tasks/ready/omicron.md';
		const doneRel = 'work/tasks/done/omicron.md';
		run('mkdir', ['-p', join(repo, 'work/tasks/done')], repo);
		gitIn(['mv', readyRel, doneRel], repo);
		writeFileSync(
			join(repo, doneRel),
			`${readFileSync(join(repo, doneRel), 'utf8')}\n## Decisions\n\n- first run: kept the old flag name\n`,
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'feat(omicron): first run'], repo);
		writeFileSync(join(repo, 'more.txt'), 'second run\n');
		writeDecisionsNote(repo, 'omicron-decisions.md');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'omicron',
			source: 'done',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
			body: reportWithDecisions('- second run: fixed the build'),
		});

		expect(core.outcome).toBe('completed');
		const record = readFromArbiterMain(repo, doneRel);
		expect(record).toContain('first run: kept the old flag name');
		expect(record).toMatch(/^## Decisions \(continued run, /m);
		expect(record).toContain('(../../notes/observations/omicron-decisions.md)');
		expect(record.indexOf('second run: fixed the build')).toBeLessThan(
			record.indexOf('omicron-decisions.md'),
		);
	});
});
