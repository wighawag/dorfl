import {existsSync, mkdirSync, readdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {git, run} from './git.js';
import {encodeRepoKey} from './repo-mirror.js';

/**
 * The **arbiter management** primitive (ADR §7 in
 * `docs/adr/execution-substrate-decisions.md`): provision and inspect a local
 * `--bare` arbiter — the offline source of truth the claim/integration
 * protocols serialize on (`scripts/CLAIM-PROTOCOL.md`).
 *
 * An arbiter is **precious DATA**, not state or cache: it is the very thing the
 * deletion-safety predicate (ADR §4) proves everything else safe *against*. So:
 *
 *   - It is provisioned under a visible `~/git/` (config `arbitersDir`),
 *     hierarchical (`<host>/<org>/<name>.git`), reusing the workspace repo→key
 *     encoding (`.`→`-` per segment) — NEVER under `~/.agent-runner/`, whose
 *     `gc`/cleanup could nuke the only copy.
 *   - It is created `git clone --bare`. A non-bare repo with `main` checked out
 *     CANNOT be an arbiter: it rejects pushes to `main` (CLAIM-PROTOCOL), which
 *     would silently break every claim. `init` refuses that unsafe case; `status`
 *     flags it.
 *
 * This module only **provisions/locates** the arbiter (`arbiterInit` from an
 * existing working repo, `arbiterStatus`). It does NOT claim, run, or fetch —
 * those consume what this provides. It reuses the `repo-mirror` repo→key
 * encoding (it does NOT duplicate it).
 */

/** The conventional default name for the arbiter remote in a working repo. */
export const DEFAULT_ARBITER_REMOTE = 'arbiter';

/**
 * The on-disk location of the local bare arbiter for `url`:
 * `<arbitersDir>/<host>/<org>/<name>.git` (hierarchical, reusing the
 * `repo-mirror` repo→key encoding, with a `.git` suffix). Lives under
 * `arbitersDir` (default `~/git`), NEVER `~/.agent-runner` (ADR §7).
 */
export function arbiterPath(arbitersDir: string, url: string): string {
	return join(arbitersDir, `${encodeRepoKey(url)}.git`);
}

export interface ArbiterInitOptions {
	/**
	 * The working repo to derive the arbiter FROM (its current contents seed the
	 * bare clone, and its `<remote>` is wired to point at it). Defaults to `cwd`.
	 */
	repo?: string;
	/** Working directory `repo` defaults to when omitted. Defaults to `process.cwd()`. */
	cwd?: string;
	/**
	 * Override the resolved default path (`<arbitersDir>/<key>.git`) with an
	 * explicit location (`--at`). Still created `--bare`.
	 */
	at?: string;
	/** Where to provision the arbiter (config `arbitersDir`, default `~/git`). */
	arbitersDir?: string;
	/** Name of the remote to wire in `repo` (`--remote`). Default `arbiter`. */
	remote?: string;
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

export interface ArbiterInitResult {
	/** Absolute path to the (existing or just-created) bare arbiter. */
	path: string;
	/** The `file://` URL the repo's remote was wired to. */
	url: string;
	/** The remote name wired in the working repo. */
	remote: string;
	/** True iff the arbiter did not exist and was just `clone --bare`d. */
	created: boolean;
	/** True iff an arbiter already existed at the path (idempotent no-clobber). */
	alreadyExisted: boolean;
	/** True iff the arbiter is bare (always true on success — invariant). */
	bare: boolean;
}

/** Raised when `init` cannot safely provision/locate an arbiter. */
export class ArbiterError extends Error {}

/**
 * Provision (or locate) a local bare arbiter from a working repo and wire the
 * repo's `<remote>` to it. Idempotent: an existing arbiter is detected and NOT
 * clobbered (it is only re-pointed by the remote, never re-cloned). Refuses the
 * unsafe case where the target is a non-bare repo with `main` checked out (which
 * would reject claim pushes — CLAIM-PROTOCOL).
 *
 * The default path is hierarchical under `arbitersDir` (`~/git`), NEVER under
 * `~/.agent-runner` (ADR §7) — overridable via `at`.
 */
export function arbiterInit(options: ArbiterInitOptions): ArbiterInitResult {
	const env = options.env;
	const note = options.note ?? (() => {});
	const repo = options.repo ?? options.cwd ?? process.cwd();
	const remote = options.remote ?? DEFAULT_ARBITER_REMOTE;

	if (run('git', ['rev-parse', '--git-dir'], repo, {env}).status !== 0) {
		throw new ArbiterError(`not inside a git repository: ${repo}`);
	}

	// Resolve the destination path: explicit --at, else the hierarchical default
	// under arbitersDir keyed off the repo's canonical file:// URL.
	const repoUrl = `file://${repo}`;
	const path = options.at ?? arbiterPath(arbitersDir(options), repoUrl);
	const url = `file://${path}`;

	// Idempotent: an existing git repo at the path is detected, validated as bare,
	// and NEVER clobbered (no re-clone). We only ensure the remote is wired.
	if (pathHoldsGitRepo(path)) {
		assertBare(path, env);
		note(
			`arbiter already exists at ${path} (not re-cloning) — ensuring remote.`,
		);
		wireRemote(repo, remote, url, env);
		return {
			path,
			url,
			remote,
			created: false,
			alreadyExisted: true,
			bare: true,
		};
	}

	// Refuse the unsafe case: --at points at an EXISTING non-bare repo (e.g. one
	// with main checked out). Using it as the arbiter rejects claim pushes to
	// main (CLAIM-PROTOCOL) — a silent, claim-breaking footgun.
	if (existsSync(path) && pathLooksLikeWorkingTree(path)) {
		assertBare(path, env); // throws with the clear non-bare message
	}

	// Provision: a bare clone of the working repo (its objects + main seed it).
	mkdirSync(dirname(path), {recursive: true});
	git(['clone', '--quiet', '--bare', repo, path], dirname(path), {env});
	note(`provisioned bare arbiter at ${path}`);

	// Wire the repo's <remote> to the new arbiter.
	wireRemote(repo, remote, url, env);

	return {path, url, remote, created: true, alreadyExisted: false, bare: true};
}

export interface ArbiterStatusOptions {
	/** The working repo to inspect. Defaults to `process.cwd()`. */
	cwd?: string;
	/** The arbiter remote name to report on. Default `arbiter`. */
	remote?: string;
	env?: NodeJS.ProcessEnv;
}

export interface ArbiterStatusReport {
	/** The remote name inspected. */
	remote: string;
	/** True iff the working repo has a remote with that name. */
	configured: boolean;
	/** The remote's URL, if configured. */
	url?: string;
	/** The local filesystem path the URL resolves to (for `file://` / local URLs). */
	path?: string;
	/** True iff a git repo exists at `path` (or the URL is reachable locally). */
	exists: boolean;
	/** True iff the arbiter is a bare repo (the safe shape). */
	bare: boolean;
	/** True iff `main` is reachable on the arbiter. */
	mainReachable: boolean;
	/**
	 * True iff the arbiter is in the unsafe non-bare-with-main shape: it EXISTS
	 * but is not bare (CLAIM-PROTOCOL warns this rejects claim pushes).
	 */
	unsafe: boolean;
}

/**
 * Read-only report of the current repo's arbiter: which remote it is, its
 * URL/path, whether it exists and is bare, and whether `main` is reachable. It
 * MUTATES NOTHING (no fetch, no checkout) — it reads the local remote config and
 * inspects the arbiter repo in place. Flags the unsafe non-bare-with-main case
 * (ADR §7 / CLAIM-PROTOCOL).
 */
export function arbiterStatus(
	options: ArbiterStatusOptions,
): ArbiterStatusReport {
	const env = options.env;
	const cwd = options.cwd ?? process.cwd();
	const remote = options.remote ?? DEFAULT_ARBITER_REMOTE;

	const urlResult = run('git', ['remote', 'get-url', remote], cwd, {env});
	if (urlResult.status !== 0) {
		return {
			remote,
			configured: false,
			exists: false,
			bare: false,
			mainReachable: false,
			unsafe: false,
		};
	}
	const url = urlResult.stdout.trim();
	const path = localPathFromUrl(url);

	// Only a local path can be inspected in place; a remote URL (github, ssh) is
	// reported as configured but its bare-ness/reachability is not probed here.
	if (path === undefined) {
		return {
			remote,
			configured: true,
			url,
			exists: false,
			bare: false,
			mainReachable: false,
			unsafe: false,
		};
	}

	const exists = pathHoldsGitRepo(path);
	if (!exists) {
		return {
			remote,
			configured: true,
			url,
			path,
			exists: false,
			bare: false,
			mainReachable: false,
			unsafe: false,
		};
	}

	const bare = isBareRepo(path, env);
	const mainReachable =
		run('git', ['rev-parse', '--verify', 'main'], path, {
			env,
		}).status === 0;

	return {
		remote,
		configured: true,
		url,
		path,
		exists: true,
		bare,
		mainReachable,
		// Unsafe = it exists but is NOT bare (a working tree with main checked out
		// rejects claim pushes to main — CLAIM-PROTOCOL).
		unsafe: !bare,
	};
}

/** Render an `arbiter status` report for the terminal. */
export function formatArbiterStatus(report: ArbiterStatusReport): string {
	const lines: string[] = [];
	if (!report.configured) {
		lines.push(
			`Arbiter: no '${report.remote}' remote configured in this repo.`,
		);
		lines.push(
			`  Run \`agent-runner arbiter init --remote ${report.remote}\` to provision one,`,
		);
		lines.push('  or set it manually with `git remote add`.');
		return lines.join('\n');
	}

	lines.push(`Arbiter remote: ${report.remote}`);
	lines.push(`  URL:    ${report.url ?? '(unknown)'}`);
	if (report.path !== undefined) {
		lines.push(`  path:   ${report.path}`);
	}
	lines.push(`  exists: ${report.exists ? 'yes' : 'no'}`);
	if (report.exists) {
		lines.push(`  bare:   ${report.bare ? 'yes' : 'no'}`);
		lines.push(
			`  main:   ${report.mainReachable ? 'reachable' : 'NOT reachable'}`,
		);
	}
	if (report.unsafe) {
		lines.push('');
		lines.push(
			'  !! UNSAFE: the arbiter is a non-bare repo (a working tree). A non-bare',
		);
		lines.push(
			'     repo with `main` checked out REJECTS claim pushes to main',
		);
		lines.push(
			'     (CLAIM-PROTOCOL). Re-provision a bare arbiter with `arbiter init`.',
		);
	} else if (report.exists && !report.mainReachable) {
		lines.push('');
		lines.push(
			'  !! main is not reachable on the arbiter (empty or wrong repo?).',
		);
	}
	return lines.join('\n');
}

/** Resolve the arbiters dir from options, defaulting to `~/git`. */
function arbitersDir(options: ArbiterInitOptions): string {
	if (options.arbitersDir && options.arbitersDir.trim() !== '') {
		return options.arbitersDir;
	}
	throw new ArbiterError(
		'arbiterInit requires `at` or `arbitersDir` (the CLI passes the resolved config).',
	);
}

/** Add the remote if absent, else set its URL (idempotent wiring). */
function wireRemote(
	repo: string,
	remote: string,
	url: string,
	env: NodeJS.ProcessEnv | undefined,
): void {
	const existing = run('git', ['remote', 'get-url', remote], repo, {env});
	if (existing.status === 0) {
		git(['remote', 'set-url', remote, url], repo, {env});
	} else {
		git(['remote', 'add', remote, url], repo, {env});
	}
}

/** Throw a clear error if the repo at `path` is not bare (the unsafe case). */
function assertBare(path: string, env: NodeJS.ProcessEnv | undefined): void {
	if (!isBareRepo(path, env)) {
		throw new ArbiterError(
			`refusing: the arbiter at ${path} is a NON-BARE repo (a working tree). ` +
				'A non-bare repo with `main` checked out rejects claim pushes to main ' +
				'(CLAIM-PROTOCOL) — it cannot serve as an arbiter. Provision a bare ' +
				'arbiter (git clone --bare) at a clean location instead.',
		);
	}
}

/** True iff `path` is (or contains) an initialised git repository. */
function pathHoldsGitRepo(path: string): boolean {
	if (!existsSync(path)) {
		return false;
	}
	// A bare repo IS a git dir; a non-bare repo has a `.git` entry. Either way,
	// `git rev-parse --git-dir` succeeds when run inside it.
	return run('git', ['rev-parse', '--git-dir'], path).status === 0;
}

/** True iff `path` exists and looks like a non-empty directory (a candidate repo). */
function pathLooksLikeWorkingTree(path: string): boolean {
	try {
		return readdirSync(path).length > 0;
	} catch {
		return false;
	}
}

/** True iff the git repo at `path` is bare. */
function isBareRepo(path: string, env: NodeJS.ProcessEnv | undefined): boolean {
	const result = run('git', ['rev-parse', '--is-bare-repository'], path, {env});
	return result.status === 0 && result.stdout.trim() === 'true';
}

/**
 * The local filesystem path a remote URL refers to, or `undefined` for a true
 * remote (github/ssh/https). Handles `file://...` and a plain absolute path.
 */
function localPathFromUrl(url: string): string | undefined {
	const trimmed = url.trim();
	if (trimmed.startsWith('file://')) {
		return trimmed.slice('file://'.length);
	}
	if (trimmed.startsWith('/')) {
		return trimmed;
	}
	return undefined;
}
