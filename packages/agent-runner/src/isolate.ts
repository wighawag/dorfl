import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {git} from './git.js';

/**
 * Isolation strategy for running an agent's code changes without corrupting
 * shared state. Per CLAIM-PROTOCOL.md / the slice: PREFER separate clones for
 * high parallelism (independent object stores, no shared-branch constraint).
 * Worktrees share one object store but git forbids the same branch in two
 * worktrees at once — so worktree branch names MUST be per-agent unique.
 */
export type IsolationMode = 'clone' | 'worktree';

export interface IsolationHandle {
	/** Working directory the agent + tests run in. */
	dir: string;
	/** The work branch checked out there (per-agent unique). */
	branch: string;
	/** Tear down the isolated checkout. */
	dispose(): void;
}

export interface IsolateOptions {
	/** The source working clone (has the `arbiter` remote configured). */
	sourceRepo: string;
	/** Arbiter remote name; the work branch is cut from `<arbiter>/main`. */
	arbiter: string;
	/** Slug being worked (for branch + dir naming). */
	slug: string;
	/** A per-agent unique id so two agents racing the same slug do not collide. */
	agentId: string;
	/** Where to place clones/worktrees. */
	workspace: string;
	mode: IsolationMode;
	env?: NodeJS.ProcessEnv;
}

/** Per-agent unique work branch name: `work/<slug>-<agentId>`. */
export function workBranchName(slug: string, agentId: string): string {
	return `work/${slug}-${agentId}`;
}

/**
 * Create an isolated checkout cut from the arbiter's freshly-claimed `main`
 * (which already includes this item's claim move). Returns the working dir, the
 * per-agent-unique branch, and a `dispose()`.
 *
 * The work branch is always uniquely named (`work/<slug>-<agentId>`) so the
 * worktree single-branch constraint is never hit, and concurrent runs of the
 * same slug never collide locally. The arbiter's CAS still guarantees a single
 * claim winner regardless — this is purely about avoiding LOCAL collisions.
 */
export function isolate(options: IsolateOptions): IsolationHandle {
	const branch = workBranchName(options.slug, options.agentId);
	mkdirSync(options.workspace, {recursive: true});

	if (options.mode === 'worktree') {
		const dir = join(options.workspace, `${options.slug}-${options.agentId}`);
		git(['fetch', '-q', options.arbiter], options.sourceRepo, {
			env: options.env,
		});
		git(
			['worktree', 'add', '-b', branch, dir, `${options.arbiter}/main`],
			options.sourceRepo,
			{env: options.env},
		);
		return {
			dir,
			branch,
			dispose() {
				git(['worktree', 'remove', '--force', dir], options.sourceRepo, {
					env: options.env,
				});
				git(['branch', '-D', branch], options.sourceRepo, {
					env: options.env,
				});
			},
		};
	}

	// Preferred: a separate clone with its own object store.
	const dir = join(options.workspace, `${options.slug}-${options.agentId}`);
	const arbiterUrl = git(
		['remote', 'get-url', options.arbiter],
		options.sourceRepo,
		{env: options.env},
	).trim();
	git(['clone', '-q', arbiterUrl, dir], options.workspace, {env: options.env});
	git(['remote', 'add', options.arbiter, arbiterUrl], dir, {env: options.env});
	git(['fetch', '-q', options.arbiter], dir, {env: options.env});
	git(['switch', '-c', branch, `${options.arbiter}/main`], dir, {
		env: options.env,
	});
	return {
		dir,
		branch,
		dispose() {
			// A separate clone is just a temp dir; the caller's workspace cleanup
			// removes it. Nothing repo-local to undo.
		},
	};
}
