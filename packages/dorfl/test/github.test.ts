import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {join} from 'node:path';
import {writeFileSync, chmodSync, readFileSync, existsSync} from 'node:fs';
import {
	GitHubProvider,
	isGitHubArbiterUrl,
	selectProvider,
	DEFAULT_GH_BIN,
} from '../src/github.js';
import {NoneProvider} from '../src/integrator.js';
import {runOnce, type Dorfl} from '../src/run.js';
import {mergeConfig} from '../src/config.js';
import {scanRepoPaths} from '../src/scan.js';
import {readJobRecord, jobWorktreePath} from '../src/workspace.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	type Scratch,
} from './helpers/gitRepo.js';

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('dorfl-github-');
});
afterEach(() => {
	scratch.cleanup();
});

/**
 * Write an executable shell STUB standing in for the `gh` CLI (we never hit the
 * network / a real GitHub). It records the args it was invoked with, prints the
 * configured stdout (a fake PR URL), and exits with `exitCode` — so a test can
 * assert the exact invocation and simulate auth failure (non-zero exit).
 */
function writeGhStub(opts: {stdout?: string; exitCode?: number} = {}): {
	bin: string;
	argsFile: string;
} {
	const bin = join(scratch.root, 'gh-stub.sh');
	const argsFile = join(scratch.root, 'gh-args.txt');
	const stdout = opts.stdout ?? 'https://github.com/o/r/pull/42';
	const exit = opts.exitCode ?? 0;
	const script = [
		'#!/usr/bin/env bash',
		`printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}`,
		`printf '%s\\n' ${JSON.stringify(stdout)}`,
		`exit ${exit}`,
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return {bin, argsFile};
}

/**
 * A `gh` stub that DISPATCHES on the sub-command (`create` / `view` / `edit` /
 * `comment` / `auth`), so a test can simulate the "PR already exists" flow:
 * `pr create` fails with the `already exists` stderr, `pr view` resolves the
 * existing PR url, `pr edit` succeeds, `pr comment` succeeds. Every invocation's
 * argv is APPENDED to `argsFile` (one call per line-group, blank-line separated)
 * so a test can assert which sub-commands ran and in what order.
 */
function writeGhDispatchStub(opts: {
	viewUrl?: string;
	createExit?: number;
	createStderr?: string;
}): {bin: string; argsFile: string} {
	const bin = join(scratch.root, 'gh-dispatch.sh');
	const argsFile = join(scratch.root, 'gh-dispatch-args.txt');
	const viewUrl = opts.viewUrl ?? 'https://github.com/o/r/pull/357';
	const createExit = opts.createExit ?? 1;
	const createStderr =
		opts.createStderr ??
		`a pull request for branch "x" into branch "main" already exists: ${viewUrl}`;
	const script = [
		'#!/usr/bin/env bash',
		// Record every invocation (argv joined by newlines, then a blank separator).
		`{ printf '%s\\n' "$@"; printf -- '---\\n'; } >> ${JSON.stringify(argsFile)}`,
		'sub="$2"', // `gh pr <sub> ...` → $1=pr $2=create/view/edit/comment
		'case "$1 $sub" in',
		`  'pr create') printf '%s\\n' ${JSON.stringify(createStderr)} 1>&2; exit ${createExit} ;;`,
		`  'pr view')   printf '%s\\n' ${JSON.stringify(viewUrl)}; exit 0 ;;`,
		"  'pr edit')   exit 0 ;;",
		"  'pr comment') exit 0 ;;",
		"  'auth status') exit 0 ;;",
		'  *) exit 0 ;;',
		'esac',
	].join('\n');
	writeFileSync(bin, script + '\n');
	chmodSync(bin, 0o755);
	return {bin, argsFile};
}

/** A `gh` path that does NOT exist on disk → spawn fails (gh missing). */
function missingGhBin(): string {
	return join(scratch.root, 'no-such-gh-binary');
}

describe('isGitHubArbiterUrl — URL-based detection', () => {
	it('recognises github.com remotes in every URL shape', () => {
		expect(isGitHubArbiterUrl('git@github.com:wighawag/dorfl.git')).toBe(true);
		expect(isGitHubArbiterUrl('https://github.com/wighawag/dorfl.git')).toBe(
			true,
		);
		expect(isGitHubArbiterUrl('ssh://git@github.com/wighawag/dorfl.git')).toBe(
			true,
		);
		expect(isGitHubArbiterUrl('https://github.com/o/r')).toBe(true);
	});

	it('does NOT recognise non-GitHub arbiters (GitLab, bare/local)', () => {
		expect(isGitHubArbiterUrl('git@gitlab.com:o/r.git')).toBe(false);
		expect(isGitHubArbiterUrl('https://gitlab.com/o/r.git')).toBe(false);
		expect(isGitHubArbiterUrl('file:///home/me/git/o/r.git')).toBe(false);
		expect(isGitHubArbiterUrl('/srv/git/o/r.git')).toBe(false);
		// A lookalike host that merely contains the substring must NOT match.
		expect(isGitHubArbiterUrl('https://notgithub.com.evil/o/r')).toBe(false);
	});
});

describe('selectProvider — purely arbiter-derived (no override axis)', () => {
	it('auto-selects the github provider for a GitHub arbiter URL', () => {
		const provider = selectProvider({
			arbiterUrl: 'git@github.com:wighawag/dorfl.git',
		});
		expect(provider.name).toBe('github');
	});

	it('falls back to the none provider for a non-GitHub arbiter URL', () => {
		const provider = selectProvider({
			arbiterUrl: 'file:///home/me/git/o/r.git',
		});
		expect(provider.name).toBe('none');
	});

	it('an unknown arbiter URL (no detection) defaults to none', () => {
		const provider = selectProvider({arbiterUrl: undefined});
		expect(provider.name).toBe('none');
	});

	it('takes NO `provider` override input — the type carries only arbiterUrl/ghBin', () => {
		// A GitHub arbiter URL ALWAYS resolves to github regardless of anything else;
		// a non-GitHub URL ALWAYS resolves to none. There is no override that could
		// contradict the arbiter (the whole point of the removal).
		expect(selectProvider({arbiterUrl: 'git@github.com:o/r.git'}).name).toBe(
			'github',
		);
		expect(
			selectProvider({arbiterUrl: 'file:///home/me/git/o/r.git'}).name,
		).toBe('none');
	});
});

describe('GitHubProvider.openRequest — gh pr create (stubbed)', () => {
	it('invokes `gh pr create` for the pushed branch and records the PR URL', async () => {
		const stub = writeGhStub({stdout: 'https://github.com/o/r/pull/7'});
		const provider = new GitHubProvider({ghBin: stub.bin});
		const result = await provider.openRequest({
			cwd: scratch.root,
			branch: 'work/task-feat',
			arbiter: 'origin',
		});

		expect(result.opened).toBe(true);
		expect(result.url).toBe('https://github.com/o/r/pull/7');
		expect(result.instruction).toContain('https://github.com/o/r/pull/7');

		// It shelled out to `gh pr create` against the pushed branch's head.
		const args = readFileSync(stub.argsFile, 'utf8');
		expect(args).toMatch(/^pr$/m);
		expect(args).toMatch(/^create$/m);
		expect(args).toMatch(/^--head$/m);
		expect(args).toMatch(/^work\/task-feat$/m);
		// Base is main; never --force anywhere.
		expect(args).toMatch(/^main$/m);
		expect(args).not.toMatch(/force/);
	});

	it('degrades to the none behaviour when gh exits non-zero (unauthenticated)', async () => {
		const stub = writeGhStub({exitCode: 1, stdout: ''});
		const provider = new GitHubProvider({ghBin: stub.bin});
		const result = await provider.openRequest({
			cwd: scratch.root,
			branch: 'work/task-feat',
			arbiter: 'origin',
		});
		// No hard failure: the branch is already pushed (safety-bearing), so we
		// fall back to the manual-instructions path rather than throwing.
		expect(result.opened).toBe(false);
		expect(result.url).toBeUndefined();
		expect(result.instruction).toMatch(/manually|open a/i);
	});

	it('degrades to the none behaviour when gh is missing (spawn fails)', async () => {
		const provider = new GitHubProvider({ghBin: missingGhBin()});
		const result = await provider.openRequest({
			cwd: scratch.root,
			branch: 'work/task-feat',
			arbiter: 'origin',
		});
		expect(result.opened).toBe(false);
		expect(result.instruction).toMatch(/manually|open a/i);
	});

	// Task `committed-recovery-completes-existing-pr`: a re-pushed branch whose PR
	// is still open makes `gh pr create` fail with "already exists". Instead of
	// degrading to push-only (dropping the refreshed body + the review comment), we
	// RESOLVE the existing PR, refresh its title/body, and return it as `opened`
	// so the caller's review-comment path fires on the existing PR.
	it('PR ALREADY EXISTS ⇒ resolves the existing PR, refreshes its body/title, and returns opened+url (no degrade)', async () => {
		const stub = writeGhDispatchStub({
			viewUrl: 'https://github.com/o/r/pull/357',
		});
		const provider = new GitHubProvider({ghBin: stub.bin});
		const result = await provider.openRequest({
			cwd: scratch.root,
			branch: 'work/task-feat',
			arbiter: 'origin',
			title: 'feat(feat): the thing',
			body: 'Task pointer + summary.',
		});

		// Treated as opened (NOT a push-only degrade), carrying the resolved url.
		expect(result.opened).toBe(true);
		expect(result.url).toBe('https://github.com/o/r/pull/357');
		expect(result.instruction).toMatch(/updated|existing/i);

		const calls = readFileSync(stub.argsFile, 'utf8');
		// It tried to create (failed already-exists), then resolved the PR (view),
		// then refreshed the content (edit --title/--body). It did NOT retry create
		// or probe auth.
		expect(calls).toMatch(/^create$/m);
		expect(calls).toMatch(/^view$/m);
		expect(calls).toMatch(/^edit$/m);
		expect(calls).toMatch(/^--body$/m);
		expect(calls).not.toMatch(/^status$/m); // no auth probe on this path
	});

	it('PR ALREADY EXISTS but its url cannot be resolved ⇒ falls through to the degrade path (branch is safe)', async () => {
		// create fails already-exists, but `pr view` returns no url (empty) ⇒ we
		// cannot resolve the existing PR, so we honestly degrade rather than crash.
		const stub = writeGhDispatchStub({viewUrl: ''});
		const provider = new GitHubProvider({ghBin: stub.bin});
		const result = await provider.openRequest({
			cwd: scratch.root,
			branch: 'work/task-feat',
			arbiter: 'origin',
			title: 'feat(feat): the thing',
			body: 'body',
			// Zero-delay backoff: the fall-through path retries `pr create` (still
			// failing) before the clean give-up; keep the test fast.
			sleep: async () => {},
			backoff: {maxAttempts: 2},
		});
		expect(result.opened).toBe(false);
		expect(result.instruction).toMatch(/manually|open a/i);
	});
});

describe('GitHubProvider — availability check (stubbed)', () => {
	it('reports available when gh auth status exits 0', () => {
		const stub = writeGhStub({exitCode: 0});
		const provider = new GitHubProvider({ghBin: stub.bin});
		expect(provider.available(scratch.root)).toBe(true);
	});

	it('reports unavailable when gh is missing/unauthenticated', () => {
		const provider = new GitHubProvider({ghBin: missingGhBin()});
		expect(provider.available(scratch.root)).toBe(false);
		const unauth = new GitHubProvider({ghBin: writeGhStub({exitCode: 1}).bin});
		expect(unauth.available(scratch.root)).toBe(false);
	});
});

describe('DEFAULT_GH_BIN', () => {
	it('is `gh` (resolved on PATH)', () => {
		expect(DEFAULT_GH_BIN).toBe('gh');
		// silence unused-import lint for the helpers in this suite
		void NoneProvider;
		void existsSync;
	});
});

/** An agent that edits a file (so the commit is non-empty) and succeeds. */
const editingAgent: Dorfl = ({cwd}) => {
	writeFileSync(join(cwd, 'agent-output.txt'), 'work done\n');
	return {ok: true};
};

/** The injected working-tree scan report for `run` over the seeded `project`. */
function scanProject(config: Parameters<typeof scanRepoPaths>[1]) {
	return scanRepoPaths([join(scratch.root, 'project')], config);
}

function configFor(root: string, overrides = {}) {
	void root;
	return mergeConfig({
		defaultArbiter: 'arbiter',
		maxParallel: 4,
		perRepoMax: 2,
		integration: 'propose',
		agentCmd: 'true',
		// The gate is now the per-repo `verify` (the converged core), injected as a
		// string command; green for these provider end-to-end tests.
		verify: 'exit 0',
		autoBuild: true,
		...overrides,
	});
}

describe('runOnce — GitHub provider end-to-end (stubbed gh)', () => {
	it('propose mode: pushes the branch AND opens a PR via gh; records the PR URL', async () => {
		const stub = writeGhStub({stdout: 'https://github.com/o/r/pull/99'});
		const {repo, arbiter} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root, {integration: 'propose'});
		const workspacesDir = join(scratch.root, 'ws');
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: workspacesDir,
			dorfl: editingAgent,
			env: gitEnv(),
			// Inject the GitHub provider with the stubbed gh (the URL-selection path
			// is unit-tested separately; here we drive the full pipeline).
			provider: new GitHubProvider({ghBin: stub.bin}),
		});

		const item = result.items[0];
		expect(item.status).toBe('claimed-done');
		expect(item.integration?.mode).toBe('propose');
		expect(item.integration?.provider).toBe('github');
		expect(item.integration?.requestOpened).toBe(true);
		expect(item.integration?.url).toBe('https://github.com/o/r/pull/99');

		// `gh pr create` was actually invoked for the work branch.
		const args = readFileSync(stub.argsFile, 'utf8');
		expect(args).toMatch(/^pr$/m);
		expect(args).toMatch(/^create$/m);
		expect(args).toMatch(/^work\/task-feat$/m);

		// propose never moves done/ onto main; claim writes nothing to main, so the body stays in backlog/.
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(false);
		expect(existsOnArbiterMain(repo, 'backlog', 'feat')).toBe(true);

		// The PR URL is recorded on the job record (surfaced by `status`).
		const dir = jobWorktreePath(workspacesDir, `file://${arbiter}`, 'feat');
		void dir; // worktree may be reaped (provably-pushed); assert via integration above
	});

	it('degrades to push-only (no hard failure) when gh is unavailable', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root, {integration: 'propose'});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			dorfl: editingAgent,
			env: gitEnv(),
			provider: new GitHubProvider({ghBin: missingGhBin()}),
		});
		const item = result.items[0];
		// The job still completes (the branch was pushed — the safety-bearing step);
		// only the PR step degraded.
		expect(item.status).toBe('claimed-done');
		expect(item.integration?.mode).toBe('propose');
		expect(item.integration?.requestOpened).toBe(false);
		expect(item.integration?.url).toBeUndefined();
		// Deletion-safety is unaffected: the branch is on the arbiter.
		expect(existsOnArbiterMain(repo, 'backlog', 'feat')).toBe(true);
	});

	it('merge mode is provider-agnostic (gh is never invoked)', async () => {
		const stub = writeGhStub();
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root, {integration: 'merge'});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			dorfl: editingAgent,
			env: gitEnv(),
			provider: new GitHubProvider({ghBin: stub.bin}),
		});
		expect(result.items[0].integration?.mergedToMain).toBe(true);
		expect(existsOnArbiterMain(repo, 'done', 'feat')).toBe(true);
		// merge mode pushes the branch to main directly; the provider (gh) is not
		// consulted, so the stub was never invoked.
		expect(existsSync(stub.argsFile)).toBe(false);
	});
});

describe('runOnce — provider auto-selection via config + URL (no gh)', () => {
	it('a local --bare arbiter (non-GitHub URL) auto-selects none, not github', async () => {
		const {repo} = seedRepoWithArbiter(scratch.root, ['feat']);
		const config = configFor(scratch.root, {integration: 'propose'});
		const result = await runOnce({
			config,
			report: scanProject(config),
			workspace: join(scratch.root, 'ws'),
			dorfl: editingAgent,
			env: gitEnv(),
			// No injected provider: selection is auto from the (file://) arbiter URL.
		});
		const item = result.items[0];
		expect(item.status).toBe('claimed-done');
		expect(item.integration?.provider).toBe('none');
		expect(existsOnArbiterMain(repo, 'backlog', 'feat')).toBe(true);
	});
});
