import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {performDo, type DoAgentRunner} from '../src/do.js';
import {performComplete} from '../src/complete.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * `do <slug>` (in-place form) tests — the per-repo, in-place WORKER (the CI
 * command) that COMPOSES `start` + (autonomous agent run) + `complete`, guarded
 * by a dirty-tree refusal. House style: a throwaway checkout + a local `--bare`
 * arbiter + a STUBBED agent (the injected `agentRunner` edits files directly,
 * never a real harness). It drives real git + writes `main` (the autonomous
 * needs-attention surfacing), so it lives in the non-parallel project.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-do-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const PASS = 'exit 0';
const FAIL = 'exit 1';

function currentBranch(repo: string): string {
	return gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
}

/** A stubbed agent that edits a file (so the commit is non-empty) and succeeds. */
const editingAgent: DoAgentRunner = ({cwd}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
	return {ok: true};
};

/** Seed a `work/prd/<slug>.md` in the checkout's working tree (for prd: tests). */
function seedPrd(repo: string, slug: string): void {
	const dir = join(repo, 'work', 'prd');
	mkdirSync(dir, {recursive: true});
	writeFileSync(
		join(dir, `${slug}.md`),
		['---', `title: ${slug}`, `slug: ${slug}`, '---', '', '# PRD', ''].join(
			'\n',
		),
	);
	// Commit it so the PRD lives on main (and survives the work-branch cut).
	gitIn(['add', '-A'], repo);
	gitIn(['commit', '-q', '-m', `prd: ${slug}`], repo);
	gitIn(['push', '-q', ARBITER, 'main'], repo);
}

describe('do <slug> — in-place happy path → exit', () => {
	it('refuses-on-dirty? no; claims + onboards + runs agent + gates + integrates in-place + exits', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(result.slug).toBe('alpha');

		// merge mode → the work landed on the arbiter's main, in done/.
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(false);

		// The agent's edit landed (the runner committed it with the done-move).
		expect(
			gitIn(['cat-file', '-e', 'arbiter/main:agent-output.txt'], repo),
		).toBe('');

		// Like `complete`: switched back to main, branch tidied (provably on arbiter).
		expect(currentBranch(repo)).toBe('main');
		expect(gitIn(['branch', '--list', 'work/alpha'], repo).trim()).toBe('');
	});

	it('the AGENT does no git — the runner owns claim + done-move + commit', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		// An agent that ASSERTS the tree is already on the work branch + claimed
		// (the runner onboarded) and only edits code.
		const assertingAgent: DoAgentRunner = ({cwd, slug}) => {
			expect(currentBranch(cwd)).toBe(`work/${slug}`);
			// in-progress (claimed) in the tree; the agent never moved it.
			expect(existsSync(join(cwd, 'work', 'in-progress', `${slug}.md`))).toBe(
				true,
			);
			writeFileSync(join(cwd, 'agent-output.txt'), 'work\n');
			return {ok: true};
		};
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			agentRunner: assertingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
	});
});

describe('do <slug> — dirty-tree refusal (ar-run.sh guard)', () => {
	it('refuses on an unstaged dirty tree, claiming nothing', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		writeFileSync(join(repo, 'README.md'), '# project DIRTY\n');

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		expect(result.message).toMatch(/dirty/i);
		// Nothing claimed; still in backlog; still on main.
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(currentBranch(repo)).toBe('main');
	});

	it('refuses on a staged-but-uncommitted dirty tree', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		writeFileSync(join(repo, 'staged.txt'), 'staged\n');
		gitIn(['add', 'staged.txt'], repo);

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		expect(existsOnArbiterMain(repo, 'backlog', 'alpha')).toBe(true);
	});
});

describe('do <slug> — lost claim race is skipped cleanly', () => {
	it('skips an item already claimed by someone else (no work branch, no agent)', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['solo']);
		const repo = seeded.repo;
		// Another claimer wins first from a separate clone.
		const other = seeded.clone('other');
		const won = await performClaim({
			slug: 'solo',
			cwd: other,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(won.exitCode).toBe(0);

		let agentRan = false;
		const result = await performDo({
			arg: 'solo',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			agentRunner: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});

		// start refuses an already-in-progress item (folder-based) → do reports the
		// lost/skip cleanly, runs no agent, creates no work branch.
		expect(result.exitCode).not.toBe(0);
		expect(['lost', 'refused']).toContain(result.outcome);
		expect(agentRan).toBe(false);
		expect(gitIn(['branch', '--list', 'work/solo'], repo).trim()).toBe('');
		expect(currentBranch(repo)).toBe('main');
	});

	it('a genuine two-doer race: the loser skips, the winner completes', async () => {
		const seeded = seedRepoWithArbiter(scratch.root, ['race']);
		const a = seeded.clone('a');
		const b = seeded.clone('b');

		const [ra, rb] = await Promise.all([
			performDo({
				arg: 'race',
				cwd: a,
				arbiter: ARBITER,
				integration: 'merge',
				verify: PASS,
				agentRunner: editingAgent,
				env: gitEnv(),
			}),
			performDo({
				arg: 'race',
				cwd: b,
				arbiter: ARBITER,
				integration: 'merge',
				verify: PASS,
				agentRunner: editingAgent,
				env: gitEnv(),
			}),
		]);

		const outcomes = [ra.outcome, rb.outcome].sort();
		// Exactly one completes; the other skips (lost/contended/refused).
		const completedCount = [ra, rb].filter(
			(r) => r.outcome === 'completed',
		).length;
		expect(completedCount).toBe(1);
		expect(outcomes).not.toEqual(['completed', 'completed']);
		// The item is done on the arbiter exactly once.
		expect(existsOnArbiterMain(a, 'done', 'race')).toBe(true);
	});
});

describe('do <slug> — red gate routes to needs-attention via the seam (AUTONOMOUS surfacing)', () => {
	it('a red gate surfaces the stuck item ON THE ARBITER main (not local-only)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: FAIL,
			agentRunner: editingAgent,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('needs-attention');

		// CRITICAL — `do` is autonomous: the stuck state is SURFACED ON MAIN (the
		// mode-M cherry-pick of the move-only commit), so scan/status/another
		// machine can see it. A `complete` (human) call without surfaceArbiter
		// would leave main showing in-progress; `do` MUST surface it.
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);

		// Locally too, the item bounced to needs-attention/ with the reason.
		expect(existsSync(join(repo, 'work', 'needs-attention', 'alpha.md'))).toBe(
			true,
		);
		expect(existsSync(join(repo, 'work', 'in-progress', 'alpha.md'))).toBe(
			false,
		);
	});

	it('CONTRAST: human `complete` (no surfaceArbiter) routes LOCAL-ONLY — main still shows in-progress', async () => {
		// This locks the AUTONOMOUS-vs-HUMAN divergence the slice flags: `do` passes
		// the arbiter (surfaces on main); the human `complete` does NOT, so a red
		// gate leaves main showing in-progress (a human is right there). If someone
		// made `complete` always surface, this fails.
		const seeded = seedRepoWithArbiter(scratch.root, ['beta']);
		const repo = seeded.repo;
		const claim = await performClaim({
			slug: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(claim.exitCode).toBe(0);
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(['switch', '-q', '-c', 'work/beta', `${ARBITER}/main`], repo);
		writeFileSync(join(repo, 'agent-output.txt'), 'work\n');

		const result = await performComplete({
			slug: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			verify: FAIL,
			// NB: NO surfaceArbiter — the human path.
			env: gitEnv(),
		});
		expect(result.outcome).toBe('gate-failed');
		// Local-only: the item bounced locally, but main was NOT surfaced — it still
		// shows the in-progress claim (the human's, no cross-machine surfacing).
		expect(existsSync(join(repo, 'work', 'needs-attention', 'beta.md'))).toBe(
			true,
		);
		expect(existsOnArbiterMain(repo, 'in-progress', 'beta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'beta')).toBe(false);
	});

	it('an agent failure before the gate surfaces agent-failed (item NOT moved to done)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			agentRunner: () => ({ok: false, detail: 'agent exploded'}),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('agent-failed');
		expect(result.message).toMatch(/exploded/);
		// Claimed + onboarded, but never integrated → not done on the arbiter.
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
	});
});

describe('do <slug> — --merge / --propose resolve at integrate-time', () => {
	it('--merge lands the work ON the arbiter main (done/)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
	});

	it('--propose (the CI default) pushes the work branch + does NOT auto-merge the work to main (CI equivalence to ar-run.sh --propose)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);

		const result = await performDo({
			arg: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');

		// propose: the work CODE is on a PUSHED branch awaiting review, NOT merged
		// to main. The CLAIM move IS on main (the item is in-progress, not done),
		// but the agent's work has not auto-landed.
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(false);
		gitIn(['fetch', '-q', ARBITER], repo);
		// The agent's edit is NOT on main (no auto-merge in propose).
		const onMain = gitIn(
			['ls-tree', 'arbiter/main', 'agent-output.txt'],
			repo,
		).trim();
		expect(onMain).toBe('');
		// The work branch was pushed to the arbiter (the safety-bearing step).
		expect(
			gitIn(
				['rev-parse', '--verify', '--quiet', 'arbiter/work/alpha'],
				repo,
			).trim(),
		).not.toBe('');
	});
});

describe('do — slug resolution (§3a): bare / slice: / prd: + collision', () => {
	it('a bare slug resolves to the slice and builds it', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'alpha', // bare → the slice
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(result.slug).toBe('alpha');
	});

	it('an explicit slice:<slug> resolves to the slice and builds it', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		const result = await performDo({
			arg: 'slice:alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(result.slug).toBe('alpha');
	});

	it('do prd:<slug> dispatches to the slicing path (a clear "not yet wired" stub)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['alpha']);
		seedPrd(repo, 'somePrd');

		let agentRan = false;
		const result = await performDo({
			arg: 'prd:somePrd',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			agentRunner: () => {
				agentRan = true;
				return {ok: true};
			},
			env: gitEnv(),
		});
		// Reaches the slicing-path entry, which is not built yet (autoslice-command).
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('prd-not-wired');
		expect(result.slug).toBe('somePrd');
		expect(result.message).toMatch(/slic/i);
		// It dispatched to slicing — it did NOT build a slice / run the agent.
		expect(agentRan).toBe(false);
	});

	it('a bare slug that collides (a slice AND a PRD share it) ERRORS loudly', async () => {
		// Seed a slice `dup` AND a PRD `dup` → a bare `do dup` is ambiguous.
		const {repo} = seedRepoWithArbiter(scratch.root, ['dup']);
		seedPrd(repo, 'dup');

		const result = await performDo({
			arg: 'dup', // bare → ambiguous across namespaces
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/ambiguous/i);
		expect(result.message).toMatch(/slice:dup/);
		expect(result.message).toMatch(/prd:dup/);
		// Nothing was claimed — the collision halts before any git transition.
		expect(existsOnArbiterMain(repo, 'backlog', 'dup')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'dup')).toBe(false);
	});

	it('an explicit slice:<slug> on a colliding slug is unambiguous (builds the slice)', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['dup']);
		seedPrd(repo, 'dup');

		const result = await performDo({
			arg: 'slice:dup', // explicit → no collision check, builds the slice
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			agentRunner: editingAgent,
			env: gitEnv(),
		});
		expect(result.outcome).toBe('completed');
		expect(result.slug).toBe('dup');
		expect(existsOnArbiterMain(repo, 'done', 'dup')).toBe(true);
	});
});
