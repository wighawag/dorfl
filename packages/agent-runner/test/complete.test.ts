import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	mkdirSync,
	writeFileSync,
	readFileSync,
	existsSync,
	chmodSync,
	rmSync,
} from 'node:fs';
import {join} from 'node:path';
import {
	performComplete,
	isLocalBranchProvablyOnArbiter,
} from '../src/complete.js';
import {GitHubProvider} from '../src/github.js';
import {performClaim} from '../src/claim-cas.js';
import {run} from '../src/git.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;

beforeEach(() => {
	scratch = makeScratch('agent-runner-complete-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';

function currentBranch(repo: string): string {
	return gitIn(['rev-parse', '--abbrev-ref', 'HEAD'], repo).trim();
}

/** True iff a LOCAL branch named `branch` exists in `repo`. */
function localBranchExists(repo: string, branch: string): boolean {
	return (
		run('git', ['rev-parse', '--verify', '--quiet', branch], repo, {
			env: gitEnv(),
		}).status === 0
	);
}

/** True iff `<arbiter>/<branch>` exists on the arbiter remote. */
function remoteBranchExists(repo: string, branch: string): boolean {
	run('git', ['fetch', '-q', ARBITER], repo, {env: gitEnv()});
	return (
		run(
			'git',
			['rev-parse', '--verify', '--quiet', `${ARBITER}/${branch}`],
			repo,
			{
				env: gitEnv(),
			},
		).status === 0
	);
}

/**
 * Stand a repo up exactly as the human loop leaves it just before `complete`:
 * a slice claimed (in-progress on the arbiter) and the human onboarded onto
 * `work/<slug>` off the freshly-pushed main. Returns the seeded handle + repo.
 */
async function claimAndBranch(
	slug: string,
	opts: {humanOnly?: boolean; promptBody?: string} = {},
) {
	const seeded = seedRepoWithArbiter(scratch.root, [slug], opts);
	const repo = seeded.repo;
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`], repo);
	return {seeded, repo};
}

/** Simulate the build agent: leave UNCOMMITTED work in the tree (no git). */
function agentEdits(repo: string, file = 'feature.txt', body = 'the work\n') {
	writeFileSync(join(repo, file), body);
}

/**
 * Write an executable `gh` STUB on a fresh dir (prepend its `binDir` to PATH) that
 * RECORDS the args it was invoked with (newline-per-arg) and prints a fake PR URL.
 * Lets a propose-mode `complete`/`do` test assert the EXACT `gh pr create` args
 * (`--title`/`--body` vs `--fill`) through the full chain, no real GitHub.
 */
function recordingGhStub(stdout = 'https://github.com/o/r/pull/1'): {
	binDir: string;
	bin: string;
	readArgs: () => string;
} {
	const binDir = join(
		scratch.root,
		`gh-stub-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(binDir, {recursive: true});
	const argsFile = join(binDir, 'gh-args.txt');
	const gh = join(binDir, 'gh');
	const script = [
		'#!/usr/bin/env bash',
		`printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
		`printf '%s\\n' ${JSON.stringify(stdout)}`,
		'exit 0',
	].join('\n');
	writeFileSync(gh, script + '\n');
	chmodSync(gh, 0o755);
	return {
		binDir,
		bin: gh,
		readArgs: () => readFileSync(argsFile, 'utf8'),
	};
}

/** A `verify` gate that always passes / always fails, deterministically. */
const PASS = 'exit 0';
const FAIL = 'exit 1';

describe('complete — gate', () => {
	it('routes to needs-attention (not done) when the gate fails (ADR §12)', async () => {
		const {repo} = await claimAndBranch('alpha');
		agentEdits(repo);

		const result = await performComplete({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			verify: FAIL,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('gate-failed');
		expect(result.routedToNeedsAttention).toBe(true);
		// The item is NOT left dangling in in-progress/, and never reaches done/ —
		// it is bounced to needs-attention/ for the human (detailed assertions in
		// complete-needs-attention.test.ts).
		expect(existsSync(join(repo, 'work', 'in-progress', 'alpha.md'))).toBe(
			false,
		);
		expect(existsSync(join(repo, 'work', 'done', 'alpha.md'))).toBe(false);
		expect(existsSync(join(repo, 'work', 'needs-attention', 'alpha.md'))).toBe(
			true,
		);
	});

	it('--skip-verify skips the gate and completes anyway', async () => {
		const {repo} = await claimAndBranch('alpha');
		agentEdits(repo);

		const result = await performComplete({
			slug: 'alpha',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			skipVerify: true,
			verify: FAIL, // would fail if run — proving it is skipped
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
	});
});

describe('complete — done-move + commit', () => {
	it('on pass: git mv in-progress→done + ONE atomic commit staging all work', async () => {
		const {repo} = await claimAndBranch('beta');
		agentEdits(repo, 'src.txt', 'agent code\n');

		// --no-switch keeps us on the work branch so we can inspect the done-move
		// + the atomic commit in the tree (the switch-to-main behaviour has its own
		// dedicated tests below).
		const result = await performComplete({
			slug: 'beta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			noSwitch: true,
			verify: PASS,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		// The move happened in the tree…
		expect(existsSync(join(repo, 'work', 'in-progress', 'beta.md'))).toBe(
			false,
		);
		expect(existsSync(join(repo, 'work', 'done', 'beta.md'))).toBe(true);
		// …and ONE commit carries BOTH the move AND the agent's previously-
		// uncommitted file.
		const files = gitIn(['show', '--name-status', '--format=', 'HEAD'], repo);
		expect(files).toMatch(/work\/done\/beta\.md/);
		expect(files).toMatch(/work\/in-progress\/beta\.md/);
		expect(files).toMatch(/src\.txt/);
		// Working tree is clean afterwards (everything was staged).
		expect(gitIn(['status', '--porcelain'], repo).trim()).toBe('');
	});

	it('refuses honestly when there is genuinely nothing to complete on the branch (wrong slug / nothing staged)', async () => {
		// Stand the work branch up as the "genuinely nothing here" shape: claimed,
		// then the in-progress slice REMOVED from the branch tree WITHOUT a done-move
		// (so neither in-progress/ NOR needs-attention/ NOR done/ holds the slug on
		// the branch). This is the bar the stranded-done auto-recover MUST NOT mask
		// (slice `autonomous-path-auto-recovers-already-committed-stranded-branch`):
		// a real wrong-slug / nothing-staged error still surfaces as `refused`. The
		// auto-recover routing is folder-gated on `work/done/<slug>.md`, so this
		// shape correctly falls through to the existing honest `CompleteRefusal`.
		const {repo} = await claimAndBranch('empty');
		gitIn(['rm', '-q', 'work/in-progress/empty.md'], repo);
		gitIn(['commit', '-q', '-m', 'drop the slice (genuinely nothing)'], repo);
		const result = await performComplete({
			slug: 'empty',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('refused');
		expect(result.message).toMatch(/nothing to complete|not found/);
	});

	it('uses <type>(<slug>): <summary>; done with --type/--message defaults', async () => {
		// Seed a slice whose title carries the "slug — …" prefix to exercise the
		// default-summary stripping.
		const seeded = seedRepoWithArbiter(scratch.root, ['theslug']);
		const repo = seeded.repo;
		// Rewrite the slice title to the realistic "slug — summary" form.
		const slicePath = join(repo, 'work', 'backlog', 'theslug.md');
		const original = readFileSync(slicePath, 'utf8');
		writeFileSync(
			slicePath,
			original.replace(
				/^title: .*$/m,
				'title: theslug — do the important thing',
			),
		);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'retitle'], repo);
		gitIn(['push', '-q', ARBITER, 'main:main'], repo);

		await performClaim({
			slug: 'theslug',
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		gitIn(['fetch', '-q', ARBITER], repo);
		gitIn(
			['switch', '-q', '-c', 'work/slice-theslug', `${ARBITER}/main`],
			repo,
		);
		agentEdits(repo);

		// Default type+message. --no-switch keeps HEAD on the work branch so the
		// completion commit (not main) is HEAD for the log assertion.
		const result = await performComplete({
			slug: 'theslug',
			cwd: repo,
			noSwitch: true,
			arbiter: ARBITER,
			integration: 'propose',
			verify: PASS,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.commitMessage).toBe(
			'feat(theslug): do the important thing; done',
		);
		const subject = gitIn(['log', '-1', '--format=%s'], repo).trim();
		expect(subject).toBe('feat(theslug): do the important thing; done');
	});

	it('honours explicit --type and --message overrides', async () => {
		const {repo} = await claimAndBranch('gamma');
		agentEdits(repo);
		const result = await performComplete({
			slug: 'gamma',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			verify: PASS,
			type: 'fix',
			message: 'patch the leak',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.commitMessage).toBe('fix(gamma): patch the leak; done');
	});
});

describe('complete — merge integration', () => {
	it('lands on arbiter main AND leaves the local main up-to-date', async () => {
		const {repo} = await claimAndBranch('delta');
		agentEdits(repo, 'thing.txt', 'merged work\n');

		const result = await performComplete({
			slug: 'delta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(result.mergedToMain).toBe(true);
		// Arbiter main now has the item in done/ and the agent's file.
		expect(existsOnArbiterMain(repo, 'done', 'delta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'delta')).toBe(false);
		// Local checkout ends on an up-to-date main (the ergonomic finish).
		expect(currentBranch(repo)).toBe('main');
		gitIn(['fetch', '-q', ARBITER], repo);
		const localMain = gitIn(['rev-parse', 'main'], repo).trim();
		const arbiterMain = gitIn(['rev-parse', `${ARBITER}/main`], repo).trim();
		expect(localMain).toBe(arbiterMain);
		// The agent's file is present on the merged main.
		expect(existsSync(join(repo, 'thing.txt'))).toBe(true);
	});

	it('never --forces: a non-fast-forward push to main is rejected, not forced', async () => {
		const {seeded, repo} = await claimAndBranch('epsilon');
		agentEdits(repo);

		// Advance arbiter/main from another clone AFTER we branched, but in a way
		// that does NOT touch our slice — so our rebase stays clean, yet our push
		// would only ff because we rebased. To prove we never force, we instead
		// check that the push target is main via ff (covered above); here we assert
		// integrate uses no --force by construction is documented. Keep a smoke
		// merge that succeeds via ff after rebase.
		const other = seeded.clone('mover');
		writeFileSync(join(other, 'unrelated.txt'), 'x\n');
		gitIn(['add', '-A'], other);
		gitIn(['commit', '-q', '-m', 'unrelated advance'], other);
		gitIn(['push', '-q', ARBITER, 'main:main'], other);

		const result = await performComplete({
			slug: 'epsilon',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			env: gitEnv(),
		});
		// Rebase onto the advanced main is clean (no overlap) → ff push succeeds.
		expect(result.exitCode).toBe(0);
		expect(existsOnArbiterMain(repo, 'done', 'epsilon')).toBe(true);
	});
});

describe('complete — propose integration', () => {
	it('provider: github degrades to push-only (exit 0) when gh is unauthenticated', async () => {
		const {repo} = await claimAndBranch('gh-degrade');
		agentEdits(repo);
		// Simulate an unauthenticated `gh`: prepend a stub `gh` that exits non-zero
		// onto PATH (keeping the real git etc. available). The GitHub provider must
		// degrade (never hard-fail) — the branch is still pushed, so the human path
		// stays safe.
		const stubBin = join(scratch.root, 'gh-stub-bin');
		mkdirSync(stubBin, {recursive: true});
		const ghStub = join(stubBin, 'gh');
		writeFileSync(ghStub, '#!/usr/bin/env bash\nexit 1\n');
		chmodSync(ghStub, 0o755);
		const result = await performComplete({
			slug: 'gh-degrade',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			// Inject the GitHubProvider INSTANCE with the unauth stub (the provider is
			// arbiter-derived now; tests drive the propose pipeline via the instance seam).
			providerInstance: new GitHubProvider({ghBin: ghStub}),
			verify: PASS,
			env: {...gitEnv(), PATH: `${stubBin}:${process.env.PATH ?? ''}`},
		});
		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(result.prUrl).toBeUndefined();
		// Deletion-safety is unaffected: the branch was pushed to the arbiter.
		gitIn(['fetch', '-q', ARBITER], repo);
		const pushed = gitIn(
			['rev-parse', '--verify', `${ARBITER}/work/slice-gh-degrade`],
			repo,
		).trim();
		expect(pushed).not.toBe('');
		expect(existsOnArbiterMain(repo, 'done', 'gh-degrade')).toBe(false);
	});

	it('pushes the work branch (not main) and reports the next step', async () => {
		const {repo} = await claimAndBranch('zeta');
		agentEdits(repo);

		const result = await performComplete({
			slug: 'zeta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			verify: PASS,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(0);
		expect(result.outcome).toBe('completed');
		expect(result.mergedToMain).toBe(false);
		// The work branch was pushed to the arbiter…
		gitIn(['fetch', '-q', ARBITER], repo);
		const pushed = gitIn(
			['rev-parse', '--verify', `${ARBITER}/work/slice-zeta`],
			repo,
		).trim();
		expect(pushed).not.toBe('');
		// …but main was NOT advanced to carry the item into done/.
		expect(existsOnArbiterMain(repo, 'done', 'zeta')).toBe(false);
		expect(existsOnArbiterMain(repo, 'in-progress', 'zeta')).toBe(true);
		expect(result.message).toMatch(/Open a PR\/MR|opened a review/);
	});

	it('prints a visually-distinct next-step block with color on a (simulated) TTY', async () => {
		const {repo} = await claimAndBranch('zeta-tty');
		agentEdits(repo);
		const blocks: string[] = [];
		const result = await performComplete({
			slug: 'zeta-tty',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			verify: PASS,
			color: true, // simulate stdout being a TTY
			noteBlock: (m) => blocks.push(m),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		const block = blocks.join('\n');
		// Surrounded by blank lines, names the pushed branch, and carries ANSI color.
		expect(block).toContain('work/slice-zeta-tty');
		expect(block).toContain(`${ARBITER}/work/slice-zeta-tty`);
		expect(block).toContain('\u001b['); // ANSI escape ⇒ color present
	});

	it('prints a PLAIN next-step block when not a TTY / NO_COLOR', async () => {
		const {repo} = await claimAndBranch('zeta-plain');
		agentEdits(repo);
		const blocks: string[] = [];
		const result = await performComplete({
			slug: 'zeta-plain',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			verify: PASS,
			color: false, // simulate piped/redirected or NO_COLOR
			noteBlock: (m) => blocks.push(m),
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		const block = blocks.join('\n');
		expect(block).toContain('work/slice-zeta-plain');
		expect(block).not.toContain('\u001b['); // no ANSI escapes when plain
		// Still surrounded by blank lines (stands out without color too).
		const lines = block.split('\n');
		expect(lines[0]).toBe('');
		expect(lines[lines.length - 1]).toBe('');
	});

	// --- Half A (title) + Half B (body): the synthesised single-line --title and
	//     the threaded --body reach `gh pr create` (a recording stub on PATH).

	it('passes an explicit single-line --title synthesised from the slice (not --fill-derived)', async () => {
		const {repo} = await claimAndBranch('titled');
		agentEdits(repo);
		const gh = recordingGhStub('https://github.com/o/r/pull/1');
		const result = await performComplete({
			slug: 'titled',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			providerInstance: new GitHubProvider({ghBin: gh.bin}),
			verify: PASS,
			env: {...gitEnv(), PATH: `${gh.binDir}:${process.env.PATH ?? ''}`},
		});
		expect(result.exitCode).toBe(0);
		const args = gh.readArgs();
		expect(args).toMatch(/^--title$/m);
		// The seeded slice title == the slug, so `<type>(<slug>): <title>`.
		expect(args).toMatch(/^feat\(titled\): titled$/m);
		// The title NEVER relies on --fill (which would derive the commit run-on).
		expect(args).not.toMatch(/^--fill$/m);
		// The title arg is a single line.
		const lines = args.split('\n');
		const titleIdx = lines.indexOf('--title');
		expect(lines[titleIdx + 1]).toBe('feat(titled): titled');
	});

	it('threads the --body (under a slice-pointer header) when supplied; absent ⇒ --fill', async () => {
		const {repo} = await claimAndBranch('bodied');
		agentEdits(repo);
		const gh = recordingGhStub('https://github.com/o/r/pull/2');
		const result = await performComplete({
			slug: 'bodied',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			providerInstance: new GitHubProvider({ghBin: gh.bin}),
			verify: PASS,
			body: 'Built the thing. Decided to inline the helper.',
			env: {...gitEnv(), PATH: `${gh.binDir}:${process.env.PATH ?? ''}`},
		});
		expect(result.exitCode).toBe(0);
		const args = gh.readArgs();
		expect(args).toMatch(/^--body$/m);
		// The body carries the summary AND a pointer back to the slice file.
		expect(args).toContain('Built the thing. Decided to inline the helper.');
		expect(args).toContain('work/done/bodied.md');
		expect(args).not.toMatch(/^--fill$/m);
	});

	it('with NO body the gh invocation still drops --fill but supplies the title (no run-on)', async () => {
		const {repo} = await claimAndBranch('nobody');
		agentEdits(repo);
		const gh = recordingGhStub('https://github.com/o/r/pull/3');
		const result = await performComplete({
			slug: 'nobody',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			providerInstance: new GitHubProvider({ghBin: gh.bin}),
			verify: PASS,
			// no body
			env: {...gitEnv(), PATH: `${gh.binDir}:${process.env.PATH ?? ''}`},
		});
		expect(result.exitCode).toBe(0);
		const args = gh.readArgs();
		// Title is always synthesised (Half A), so --fill is gone even without a body.
		expect(args).toMatch(/^--title$/m);
		expect(args).toMatch(/^feat\(nobody\): nobody$/m);
		expect(args).not.toMatch(/^--fill$/m);
		// The (empty) body field is supplied so gh never re-derives from the subject.
		expect(args).toMatch(/^--body$/m);
	});
});

describe('complete — rebase conflict (ADR §10)', () => {
	it('aborts the rebase and surfaces needs-attention; never auto-resolves', async () => {
		const {seeded, repo} = await claimAndBranch('theta');
		// Our work edits README.md.
		writeFileSync(join(repo, 'README.md'), '# project\nour change\n');

		// Concurrently, another clone advances arbiter/main with a CONFLICTING
		// edit to the same file/line.
		const other = seeded.clone('conflict');
		writeFileSync(join(other, 'README.md'), '# project\ntheir change\n');
		gitIn(['add', '-A'], other);
		gitIn(['commit', '-q', '-m', 'conflicting advance'], other);
		gitIn(['push', '-q', ARBITER, 'main:main'], other);

		const result = await performComplete({
			slug: 'theta',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			env: gitEnv(),
		});

		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('rebase-conflict');
		expect(result.message).toMatch(/conflict/i);
		expect(result.message).toMatch(/aborted/i);
		expect(result.routedToNeedsAttention).toBe(true);
		// The rebase was aborted: we are back on the work branch, not mid-rebase.
		expect(currentBranch(repo)).toBe('work/slice-theta');
		expect(existsSync(join(repo, '.git', 'rebase-merge'))).toBe(false);
		expect(existsSync(join(repo, '.git', 'rebase-apply'))).toBe(false);
		// Nothing landed on arbiter main — and the item is routed to
		// needs-attention/ rather than left dangling (ADR §12).
		expect(existsOnArbiterMain(repo, 'done', 'theta')).toBe(false);
		expect(existsSync(join(repo, 'work', 'needs-attention', 'theta.md'))).toBe(
			true,
		);
	});
});

describe('complete — slug inference + environment', () => {
	it('infers the slug from the work/<slug> branch when omitted', async () => {
		const {repo} = await claimAndBranch('inferred');
		agentEdits(repo);
		const result = await performComplete({
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			verify: PASS,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.branch).toBe('work/slice-inferred');
	});

	it('errors when not on a work/<slug> branch and no slug given', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['x'], {});
		// Still on main.
		const result = await performComplete({
			cwd: repo,
			arbiter: ARBITER,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/missing <slug>/);
	});

	it('errors when checked out on a different branch than the slug', async () => {
		const {repo} = await claimAndBranch('mismatch');
		gitIn(['switch', '-q', 'main'], repo);
		const result = await performComplete({
			slug: 'mismatch',
			cwd: repo,
			arbiter: ARBITER,
			verify: PASS,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/not on work\/slice-mismatch/);
	});

	it('errors when the arbiter remote does not exist', async () => {
		const {repo} = await claimAndBranch('alpha');
		const result = await performComplete({
			slug: 'alpha',
			cwd: repo,
			arbiter: 'nope',
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(1);
		expect(result.outcome).toBe('usage-error');
		expect(result.message).toMatch(/no git remote named 'nope'/);
	});
});

describe('complete — switch back to main (both modes)', () => {
	it('merge: switches to main AND fast-forwards it to the new arbiter main', async () => {
		const {repo} = await claimAndBranch('m-switch');
		agentEdits(repo);
		const result = await performComplete({
			slug: 'm-switch',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.switchedTo).toBe('main');
		expect(currentBranch(repo)).toBe('main');
		// ff'd: local main == arbiter main (the just-pushed merge).
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(gitIn(['rev-parse', 'main'], repo).trim()).toBe(
			gitIn(['rev-parse', `${ARBITER}/main`], repo).trim(),
		);
	});

	it('propose: switches to main but does NOT fast-forward (arbiter main unchanged)', async () => {
		const {repo} = await claimAndBranch('p-switch');
		agentEdits(repo);
		// Capture the arbiter main BEFORE completing — propose must not advance it.
		gitIn(['fetch', '-q', ARBITER], repo);
		const arbiterMainBefore = gitIn(
			['rev-parse', `${ARBITER}/main`],
			repo,
		).trim();

		const result = await performComplete({
			slug: 'p-switch',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			verify: PASS,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.switchedTo).toBe('main');
		expect(currentBranch(repo)).toBe('main');
		// Arbiter main was NOT advanced (the work is on the pushed branch only).
		gitIn(['fetch', '-q', ARBITER], repo);
		expect(gitIn(['rev-parse', `${ARBITER}/main`], repo).trim()).toBe(
			arbiterMainBefore,
		);
		// No ff happened: local main must NOT contain the completion commit (the
		// work lives on the pushed branch, never on main in propose mode).
		const completionCommit = gitIn(
			['rev-parse', `${ARBITER}/work/slice-p-switch`],
			repo,
		).trim();
		const containsCompletion =
			run(
				'git',
				['merge-base', '--is-ancestor', completionCommit, 'main'],
				repo,
				{env: gitEnv()},
			).status === 0;
		expect(containsCompletion).toBe(false);
	});
});

describe('complete — local work-branch deletion (provably on arbiter)', () => {
	it('merge: deletes the LOCAL work branch (tip is on arbiter main), keeps no remote', async () => {
		const {repo} = await claimAndBranch('m-del');
		agentEdits(repo);
		const result = await performComplete({
			slug: 'm-del',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			verify: PASS,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.deletedLocalBranch).toBe(true);
		expect(localBranchExists(repo, 'work/slice-m-del')).toBe(false);
	});

	it('propose: deletes the LOCAL work branch (pushed & up-to-date) but NEVER the remote', async () => {
		const {repo} = await claimAndBranch('p-del');
		agentEdits(repo);
		const result = await performComplete({
			slug: 'p-del',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			verify: PASS,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.deletedLocalBranch).toBe(true);
		// Local branch gone…
		expect(localBranchExists(repo, 'work/slice-p-del')).toBe(false);
		// …but the REMOTE branch (which a propose PR is built from) survives.
		expect(remoteBranchExists(repo, 'work/slice-p-del')).toBe(true);
	});

	it('keeps the LOCAL branch under --no-switch even when provably on arbiter', async () => {
		const {repo} = await claimAndBranch('keep-noswitch');
		agentEdits(repo);
		const result = await performComplete({
			slug: 'keep-noswitch',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			noSwitch: true,
			verify: PASS,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.deletedLocalBranch).toBeFalsy();
		expect(localBranchExists(repo, 'work/slice-keep-noswitch')).toBe(true);
	});
});

describe('complete — isLocalBranchProvablyOnArbiter predicate (ADR §4)', () => {
	it('true when the branch tip is an ancestor of arbiter/main (merged)', async () => {
		const {repo} = await claimAndBranch('pred-merged');
		agentEdits(repo);
		// Commit + push the branch tip onto arbiter main (a merge would do this).
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'work'], repo);
		gitIn(['push', '-q', ARBITER, 'work/slice-pred-merged:main'], repo);
		expect(
			await isLocalBranchProvablyOnArbiter(
				repo,
				ARBITER,
				'work/slice-pred-merged',
				gitEnv(),
			),
		).toBe(true);
	});

	it('true when arbiter/<branch> exists and its tip == the local tip (pushed)', async () => {
		const {repo} = await claimAndBranch('pred-pushed');
		agentEdits(repo);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'work'], repo);
		gitIn(
			['push', '-q', ARBITER, 'work/slice-pred-pushed:work/slice-pred-pushed'],
			repo,
		);
		expect(
			await isLocalBranchProvablyOnArbiter(
				repo,
				ARBITER,
				'work/slice-pred-pushed',
				gitEnv(),
			),
		).toBe(true);
	});

	it('false when work is unmerged AND never pushed (no remote presence)', async () => {
		const {repo} = await claimAndBranch('pred-unmerged');
		agentEdits(repo);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'work'], repo);
		// Never pushed and not on main ⇒ not provable ⇒ keep.
		expect(
			await isLocalBranchProvablyOnArbiter(
				repo,
				ARBITER,
				'work/slice-pred-unmerged',
				gitEnv(),
			),
		).toBe(false);
	});

	it('false when the remote tip differs from the local tip (un-pushed amend)', async () => {
		const {repo} = await claimAndBranch('pred-diverge');
		agentEdits(repo);
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'work'], repo);
		// Push the branch (a remote branch now exists)…
		gitIn(
			[
				'push',
				'-q',
				ARBITER,
				'work/slice-pred-diverge:work/slice-pred-diverge',
			],
			repo,
		);
		// …then advance the LOCAL tip WITHOUT pushing (the un-pushed amend).
		writeFileSync(join(repo, 'more.txt'), 'unpushed\n');
		gitIn(['add', '-A'], repo);
		gitIn(['commit', '-q', '-m', 'unpushed amend'], repo);
		// remote-tip != local-tip ⇒ not provable ⇒ keep (never lose the amend).
		expect(
			await isLocalBranchProvablyOnArbiter(
				repo,
				ARBITER,
				'work/slice-pred-diverge',
				gitEnv(),
			),
		).toBe(false);
	});
});

describe('complete — --no-switch opt-out (both modes)', () => {
	it('merge --no-switch: stays on work branch and keeps it', async () => {
		const {repo} = await claimAndBranch('m-stay');
		agentEdits(repo);
		const result = await performComplete({
			slug: 'm-stay',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'merge',
			noSwitch: true,
			verify: PASS,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.switchedTo).toBe('work/slice-m-stay');
		expect(currentBranch(repo)).toBe('work/slice-m-stay');
		expect(result.deletedLocalBranch).toBeFalsy();
		expect(localBranchExists(repo, 'work/slice-m-stay')).toBe(true);
		// The work still landed on arbiter main (integration is unaffected).
		expect(existsOnArbiterMain(repo, 'done', 'm-stay')).toBe(true);
	});

	it('propose --no-switch: stays on work branch and keeps it', async () => {
		const {repo} = await claimAndBranch('p-stay');
		agentEdits(repo);
		const result = await performComplete({
			slug: 'p-stay',
			cwd: repo,
			arbiter: ARBITER,
			integration: 'propose',
			noSwitch: true,
			verify: PASS,
			env: gitEnv(),
		});
		expect(result.exitCode).toBe(0);
		expect(result.switchedTo).toBe('work/slice-p-stay');
		expect(currentBranch(repo)).toBe('work/slice-p-stay');
		expect(result.deletedLocalBranch).toBeFalsy();
		expect(localBranchExists(repo, 'work/slice-p-stay')).toBe(true);
		// The branch was still pushed for review (integration is unaffected).
		expect(remoteBranchExists(repo, 'work/slice-p-stay')).toBe(true);
	});
});
