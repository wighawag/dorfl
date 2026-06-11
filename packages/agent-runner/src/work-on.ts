import {cpSync, existsSync, mkdirSync, rmSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {git, runAsync, type RunResult} from './git.js';
import {performClaim} from './claim-cas.js';
import {
	encodeRepoKey,
	ensureMirror,
	fetchMirrorMain,
	mirrorPath,
} from './repo-mirror.js';
import {
	defaultConfigPath,
	loadConfig,
	saveConfig,
	type Config,
} from './config.js';
import {brand} from './brand.js';
import {workBranchRef} from './slug-namespace.js';
import type {InteractiveLauncher} from './harness.js';

/**
 * `agent-runner work-on` — the HUMAN command to claim a slice and create an
 * isolated **worktree in a human-friendly location**, so a person can open their
 * editor and work several slices in parallel without juggling branches in one
 * checkout. It is the human counterpart to the runner's job worktrees
 * (`workspace.ts`): it is NEVER used by agents, so it never carries the human's
 * secrets into an agent context (see `--copy`).
 *
 * Two invocation forms — the ONLY intended difference between them is **where the
 * worktree's files live**; the claim, the integration semantics, and the
 * starting commit are IDENTICAL:
 *
 *   work-on <slug>                in-repo: the arbiter remote/URL is inferred from
 *                                 the current repo; the claim runs in that repo.
 *   work-on --remote <r> <slug>   remote: ensure a hub mirror for <r> (creating
 *                                 it via repo-mirror if absent, exactly like
 *                                 agents do), then claim against it from a
 *                                 throwaway worktree. The remote target is a FLAG
 *                                 (consistent with `do --remote`), not positional.
 *
 * BOTH forms: claim the slug, then ALWAYS `git fetch` and branch the worktree off
 * the **freshly-fetched `<arbiter>/main`** — never a possibly-stale local ref.
 * THIS GUARANTEE is what makes the two forms equivalent: the same slug yields
 * equivalent work either way (same starting commit).
 *
 * The worktree lives under the configured `humanWorktreesDir`
 * (`<dir>/<key>/<slug>/` on branch `work/<slug>`) — prompted + saved on first use,
 * with a sensible suggestion but no silent default, and NEVER under
 * `~/.agent-runner/` (that is the agents' area; `work-on` is human-only).
 *
 * A binary cannot `cd` its parent shell, so on success it prints the worktree path
 * + a `cd` hint; `--print-dir` emits the path ONLY (stdout) so the human can
 * install a shell function that actually cd's them:
 *
 *   work-on() { cd "$(agent-runner work-on "$@" --print-dir)"; }
 */

/** The semantic outcome of a `work-on` invocation. */
export type WorkOnOutcome =
	| 'created' // claimed and created the worktree
	| 'refused' // a readiness refusal (unmet blockedBy without override)
	| 'lost' // lost the claim race (propagated from claim) — NO worktree
	| 'contended' // claim push kept being rejected — NO worktree
	| 'usage-error'; // usage / environment problem

export interface WorkOnOptions {
	/** The slug to work on (`work/backlog/<slug>.md`). Required. */
	slug: string;
	/**
	 * Remote mode: the remote spec/URL to mirror via `repo-mirror`. When given,
	 * `work-on --remote <r> <slug>` ensures a hub mirror (creating it if absent)
	 * and claims against it. When omitted, in-repo mode: the arbiter is inferred
	 * from `cwd`.
	 */
	remote?: string;
	/** The current working directory (in-repo mode resolves the arbiter from it). */
	cwd: string;
	/**
	 * Name of the arbiter git remote in `cwd` (in-repo mode only). Defaults to
	 * `origin`. Ignored in remote mode (the mirror's own `origin` is used).
	 */
	arbiter?: string;
	/**
	 * Override the readiness guard (`--ignore-not-ready`): claim despite
	 * an unmet `blockedBy`, and silence the `needsAnswers` warning. Forwarded to
	 * the claim CAS's human-path guard.
	 */
	override?: boolean;
	/**
	 * Comma-separated glob-free filenames (gitignored, untracked files like
	 * `.env.local,.env`) to COPY into the new worktree so the project is runnable.
	 * Copy, not symlink (tooling-safe). Source = the current repo in-repo mode; in
	 * remote mode there is no implicit source, so `--copy` REQUIRES `copyFrom`.
	 */
	copy?: string;
	/**
	 * The explicit source dir for `--copy` in remote mode (`--copy-from <path>`).
	 * Required when `copy` is set in remote mode; ignored otherwise.
	 */
	copyFrom?: string;
	/** The execution working area for hub mirrors (config `workspacesDir`). */
	workspacesDir?: string;
	/**
	 * The human worktree root (config `humanWorktreesDir`). When already
	 * configured this is used directly; when undefined, `promptForRoot` is invoked
	 * to obtain + SAVE it (first-use prompt). Tests pass it directly to avoid TTY.
	 */
	humanWorktreesDir?: string;
	/**
	 * First-use prompt for the human worktree root. Called only when
	 * `humanWorktreesDir` is undefined (in config + options). Receives a sensible
	 * SUGGESTION; returns the chosen absolute path (or '' to abort). The CLI wires
	 * a readline prompt; tests inject a stub.
	 */
	promptForRoot?: (suggestion: string) => Promise<string> | string;
	/**
	 * Persist a newly-prompted `humanWorktreesDir`. The CLI wires this to
	 * `saveConfig` at `configPath`; tests can inject a spy or a no-op.
	 */
	saveRoot?: (dir: string) => void;
	/**
	 * `--agent` (slice `agent-interactive-launch`): after the human worktree is
	 * created, launch the configured harness INTERACTIVELY in THAT worktree — a
	 * foreground session the human drives (no prepared prompt). Injected as a thin
	 * launcher so `work-on.ts` stays decoupled from `createHarness`: the CLI wires
	 * it to the resolved harness's `launchInteractive` (model/session resolved
	 * there). Omitted ⇒ work-on creates the worktree and prints the cd hint (its
	 * historical behaviour). It is NOT a tracked job (decision #3): no job record,
	 * no gate — after exit the human drives `complete`/`requeue`.
	 */
	launchInteractive?: InteractiveLauncher;
	/** Environment for child git processes (identity etc.). */
	env?: NodeJS.ProcessEnv;
	/** Sink for human-readable progress + the security notice (stderr). */
	note?: (message: string) => void;
}

export interface WorkOnResult {
	exitCode: 0 | 1 | 2 | 3;
	outcome: WorkOnOutcome;
	/** Absolute path to the created worktree (only on success). */
	dir?: string;
	/** The work branch checked out there (`work/<slug>`). */
	branch?: string;
	/** The resolved arbiter URL the worktree branches from. */
	arbiterUrl?: string;
	/** The starting commit (freshly-fetched `<arbiter>/main`) the worktree is cut from. */
	startCommit?: string;
	/** Files copied in via `--copy` (basenames), in order. */
	copied?: string[];
	/** Human-readable summary of the terminal condition. */
	message: string;
}

const DEFAULT_ARBITER = 'origin';

/** Raised for usage/environment errors (exit 1, outcome 'usage-error'). */
class WorkOnUsageError extends Error {}

/**
 * Run the `work-on` ritual. Never throws for the expected lost/contended/refused
 * cases — those are returned with the appropriate exit code and NO worktree.
 * Usage/environment problems surface as exit 1.
 */
export async function performWorkOn(
	options: WorkOnOptions,
): Promise<WorkOnResult> {
	const note = options.note ?? (() => {});
	try {
		return await runWorkOn(options, note);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {exitCode: 1, outcome: 'usage-error', message};
	}
}

async function runWorkOn(
	options: WorkOnOptions,
	note: (m: string) => void,
): Promise<WorkOnResult> {
	const slug = options.slug;
	if (!slug) {
		throw new WorkOnUsageError(
			'missing <slug>. usage: agent-runner work-on <slug> [--remote <r>]',
		);
	}
	const env = options.env;
	const workspacesDir =
		options.workspacesDir ?? join(homedir(), brand.workdirName);

	// The human worktree root: configured value wins; otherwise prompt + save on
	// first use (a sensible suggestion, NEVER a silent default; never under
	// ~/.agent-runner/).
	const root = await resolveHumanWorktreesRoot(options, note);

	// Resolve the arbiter URL + a CLAIM CONTEXT (a checkout with the arbiter
	// remote where the CAS runs). The ONLY thing that differs between the two
	// forms is the claim context's location; both fetch + branch off the fresh
	// arbiter main, so the starting commit is identical.
	const ctx = await resolveClaimContext({
		slug,
		remote: options.remote,
		cwd: options.cwd,
		arbiter: options.arbiter ?? DEFAULT_ARBITER,
		workspacesDir,
		env,
		note,
	});

	try {
		// Claim FIRST. On a lost/contended/refused claim, create NO worktree
		// (clean failure, exactly like `claim`).
		const claim = await performClaim({
			slug,
			cwd: ctx.claimCwd,
			arbiter: ctx.claimArbiter,
			env,
			humanPath: true,
			override: options.override,
			note,
		});
		if (claim.exitCode !== 0) {
			const outcome: WorkOnOutcome =
				claim.outcome === 'not-ready'
					? 'refused'
					: claim.exitCode === 2
						? 'lost'
						: claim.exitCode === 3
							? 'contended'
							: 'usage-error';
			return {exitCode: claim.exitCode, outcome, message: claim.message};
		}

		// The claim landed. Create the human worktree off the FRESHLY-FETCHED
		// arbiter main (which now includes the claim move). We branch from the hub
		// mirror's main so both forms share one branching primitive.
		const created = createHumanWorktree({
			slug,
			root,
			arbiterUrl: ctx.arbiterUrl,
			workspacesDir,
			env,
		});

		// Copy named gitignored files (copy, not symlink) so the project is
		// runnable; print a security notice. Source resolved per mode.
		const copied = copyGitignoredFiles({
			copy: options.copy,
			copyFrom: options.copyFrom,
			remoteMode: ctx.remoteMode,
			inRepoSource: options.cwd,
			destDir: created.dir,
			note,
		});

		const message = `Created worktree for '${slug}' at ${created.dir} (branch ${created.branch}).`;
		note(message);
		note(`To start working:  cd ${created.dir}`);

		// `--agent` (slice `agent-interactive-launch`): launch the configured harness
		// INTERACTIVELY in the freshly-created worktree so the human can immediately
		// drive the agent there. It is NOT a tracked job (decision #3): no record, no
		// gate — it blocks in the foreground until the human exits, then control
		// returns and they drive `complete`/`requeue`. The model/session are bound in
		// the CLI's launcher closure (config lives there).
		if (options.launchInteractive) {
			note(`Launching the configured harness interactively in ${created.dir}.`);
			options.launchInteractive({slug, dir: created.dir, env});
		}

		return {
			exitCode: 0,
			outcome: 'created',
			dir: created.dir,
			branch: created.branch,
			arbiterUrl: ctx.arbiterUrl,
			startCommit: created.startCommit,
			copied,
			message,
		};
	} finally {
		ctx.cleanup();
	}
}

interface ClaimContext {
	/** Resolved arbiter URL (canonical; used for the hub key + worktree). */
	arbiterUrl: string;
	/** The checkout where the claim CAS runs. */
	claimCwd: string;
	/** The arbiter remote NAME valid inside `claimCwd`. */
	claimArbiter: string;
	/** True iff this is remote mode (no implicit `--copy` source). */
	remoteMode: boolean;
	/** Tear down any throwaway claim worktree. */
	cleanup(): void;
}

/**
 * Resolve where + how the claim CAS runs, per mode. The starting commit is
 * guaranteed identical because the claim and the worktree both branch off the
 * freshly-fetched arbiter main; only the claim context's LOCATION differs.
 */
async function resolveClaimContext(params: {
	slug: string;
	remote: string | undefined;
	cwd: string;
	arbiter: string;
	workspacesDir: string;
	env: NodeJS.ProcessEnv | undefined;
	note: (m: string) => void;
}): Promise<ClaimContext> {
	const {remote, cwd, arbiter, workspacesDir, env, note} = params;

	if (remote === undefined || remote.trim() === '') {
		// IN-REPO: infer the arbiter URL from the current repo; claim runs here.
		if ((await gitSoft(['rev-parse', '--git-dir'], cwd, env)).status !== 0) {
			throw new WorkOnUsageError(
				'not inside a git repository (run inside a clone, or use the remote form: work-on --remote <r> <slug>)',
			);
		}
		const url = await gitSoft(['remote', 'get-url', arbiter], cwd, env);
		if (url.status !== 0) {
			throw new WorkOnUsageError(
				`no git remote named '${arbiter}' (set one, or pass --arbiter)`,
			);
		}
		return {
			arbiterUrl: url.stdout.trim(),
			claimCwd: cwd,
			claimArbiter: arbiter,
			remoteMode: false,
			cleanup: () => {},
		};
	}

	// REMOTE: ensure a hub mirror for <remote> (create if absent, like agents do)
	// so the worktree can later branch off it. The claim itself needs a normal
	// (non-bare) checkout with an `origin/main` tracking ref + a work tree to
	// commit in, which a bare mirror does not provide — so the claim runs in a
	// THROWAWAY clone of the arbiter URL (removed in cleanup either way).
	//
	// When the mirror already exists we refresh ONLY `main` (non-pruning): a
	// pruning mirror-fetch here would delete the LOCAL-ONLY `work/<slug>` branches
	// of other live human worktrees off this hub.
	const hubPath = mirrorPath(workspacesDir, remote);
	let mirrorUrl: string;
	if (existsSync(hubPath)) {
		mirrorUrl = ensureMirrorUrl(remote);
		fetchMirrorMain(hubPath, env);
		note(`Reusing hub mirror for ${mirrorUrl} at ${hubPath}.`);
	} else {
		const created = ensureMirror({url: remote, workspacesDir, env});
		mirrorUrl = created.url;
		note(`Created hub mirror for ${mirrorUrl} at ${created.path}.`);
	}

	const claimDir = join(
		workspacesDir,
		'claim',
		`${encodeRepoKey(mirrorUrl).split('/').join('__')}__${params.slug}`,
	);
	rmSync(claimDir, {recursive: true, force: true});
	mkdirSync(dirname(claimDir), {recursive: true});
	// A lightweight clone whose `origin` IS the arbiter URL — the claim CAS fetches
	// `origin` + branches off `origin/main`, exactly as in the in-repo form.
	git(['clone', '--quiet', mirrorUrl, claimDir], dirname(claimDir), {env});

	return {
		arbiterUrl: mirrorUrl,
		claimCwd: claimDir,
		claimArbiter: 'origin',
		remoteMode: true,
		cleanup: () => rmSync(claimDir, {recursive: true, force: true}),
	};
}

interface CreatedWorktree {
	dir: string;
	branch: string;
	startCommit: string;
}

/**
 * Create the human worktree at `<root>/<key>/<slug>/` on `work/<slug>`, branched
 * off the freshly-fetched hub-mirror `main`. The mirror is (re-)fetched here too,
 * so even in in-repo mode the worktree is cut from the latest arbiter main — the
 * same-starting-commit guarantee.
 */
function createHumanWorktree(params: {
	slug: string;
	root: string;
	arbiterUrl: string;
	workspacesDir: string;
	env: NodeJS.ProcessEnv | undefined;
}): CreatedWorktree {
	const {slug, root, arbiterUrl, workspacesDir, env} = params;

	// Ensure the hub mirror exists, then refresh ONLY `main` to the latest arbiter
	// tip (which, post-claim, includes the claim move). We do NOT use the pruning
	// mirror-fetch here: this mirror also holds the LOCAL-ONLY `work/<slug>`
	// branches of other live human worktrees, and a pruning fetch would delete
	// (and corrupt) them. fetchMirrorMain refreshes main without touching them.
	const hubPath = mirrorPath(workspacesDir, arbiterUrl);
	let mirrorUrl = arbiterUrl;
	if (existsSync(hubPath)) {
		fetchMirrorMain(hubPath, env);
	} else {
		mirrorUrl = ensureMirror({url: arbiterUrl, workspacesDir, env}).url;
	}

	const key = encodeRepoKey(mirrorUrl);
	// `work-on` builds a SLICE in a worktree — the slice-namespaced work branch.
	const branch = workBranchRef('slice', slug);
	const dir = join(root, key, slug);

	// Clear any stale worktree/branch for this slug (idempotent re-run).
	clearWorktree(hubPath, dir, env);
	pruneBranch(hubPath, branch, env);

	mkdirSync(dirname(dir), {recursive: true});
	git(['worktree', 'add', '--quiet', '-b', branch, dir, 'main'], hubPath, {
		env,
	});

	const startCommit = git(['rev-parse', 'HEAD'], dir, {env}).trim();
	return {dir, branch, startCommit};
}

/**
 * Copy the named gitignored files into the new worktree (COPY, not symlink). A
 * fresh worktree has NONE of your untracked files, so a project that needs e.g.
 * `.env.local` to run won't run without this. Prints a one-line SECURITY NOTICE
 * naming what was copied and that secrets now live in a second location.
 *
 * Source: the current repo in in-repo mode; in remote mode there is no implicit
 * source, so `--copy` REQUIRES `--copy-from <path>`.
 */
function copyGitignoredFiles(params: {
	copy: string | undefined;
	copyFrom: string | undefined;
	remoteMode: boolean;
	inRepoSource: string;
	destDir: string;
	note: (m: string) => void;
}): string[] {
	const {copy, copyFrom, remoteMode, inRepoSource, destDir, note} = params;
	if (!copy || copy.trim() === '') {
		return [];
	}

	const patterns = copy
		.split(',')
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	if (patterns.length === 0) {
		return [];
	}

	const source = resolveCopySource({remoteMode, copyFrom, inRepoSource});

	const copied: string[] = [];
	const missing: string[] = [];
	for (const name of patterns) {
		const from = join(source, name);
		if (!existsSync(from)) {
			missing.push(name);
			continue;
		}
		const to = join(destDir, name);
		mkdirSync(dirname(to), {recursive: true});
		// Copy (recursively for dirs); explicitly NOT a symlink, so the worktree is
		// tooling-safe and self-contained.
		cpSync(from, to, {recursive: true});
		copied.push(name);
	}

	if (missing.length > 0) {
		note(`!! --copy: not found in ${source} (skipped): ${missing.join(', ')}.`);
	}
	if (copied.length > 0) {
		note(
			`!! SECURITY NOTICE: copied ${copied.length} gitignored file(s) into the ` +
				`new worktree: ${copied.join(', ')}. These are real copies (not ` +
				`symlinks) — secrets now live in a SECOND location (${destDir}). ` +
				'Treat that worktree like the source for credential hygiene.',
		);
	}
	return copied;
}

/** Resolve the source dir for `--copy`, enforcing `--copy-from` in remote mode. */
function resolveCopySource(params: {
	remoteMode: boolean;
	copyFrom: string | undefined;
	inRepoSource: string;
}): string {
	const {remoteMode, copyFrom, inRepoSource} = params;
	if (remoteMode) {
		if (!copyFrom || copyFrom.trim() === '') {
			throw new WorkOnUsageError(
				'--copy needs an explicit source in remote mode: pass --copy-from <path> ' +
					'(there is no current repo to copy gitignored files from).',
			);
		}
		const src = resolve(copyFrom);
		if (!existsSync(src) || !statSync(src).isDirectory()) {
			throw new WorkOnUsageError(
				`--copy-from path does not exist or is not a directory: ${src}`,
			);
		}
		return src;
	}
	return inRepoSource;
}

/**
 * Resolve the human worktree root: a configured `humanWorktreesDir` wins; else
 * prompt for it (a sensible SUGGESTION, no silent default) and SAVE it, so the
 * human is asked exactly once. NEVER allow a root under `~/.agent-runner/` (that
 * is the agents' execution area — work-on is human-only).
 */
async function resolveHumanWorktreesRoot(
	options: WorkOnOptions,
	note: (m: string) => void,
): Promise<string> {
	const configured = options.humanWorktreesDir;
	if (configured && configured.trim() !== '') {
		return assertHumanRoot(resolve(configured));
	}

	if (!options.promptForRoot) {
		throw new WorkOnUsageError(
			'humanWorktreesDir is not configured and no prompt is available; set ' +
				'`humanWorktreesDir` in config (a human-only worktree root, NOT under ' +
				'~/.agent-runner/).',
		);
	}

	const suggestion = suggestHumanWorktreesDir();
	const answeredRaw = await options.promptForRoot(suggestion);
	const answered = (answeredRaw ?? '').trim();
	if (answered === '') {
		throw new WorkOnUsageError(
			'no humanWorktreesDir provided — aborting (work-on needs a worktree root).',
		);
	}
	const chosen = assertHumanRoot(resolve(answered));
	if (options.saveRoot) {
		options.saveRoot(chosen);
		note(`Saved humanWorktreesDir = ${chosen} to config.`);
	}
	return chosen;
}

/**
 * Reject a human worktree root under `~/.agent-runner/` (the agents' area, ADR
 * §3): work-on is human-only and must never share that space.
 */
function assertHumanRoot(dir: string): string {
	const agentArea = join(homedir(), brand.workdirName);
	const normalized = dir.endsWith('/') ? dir.slice(0, -1) : dir;
	if (normalized === agentArea || normalized.startsWith(agentArea + '/')) {
		throw new WorkOnUsageError(
			`humanWorktreesDir must NOT be under ${agentArea} (that is the agents' ` +
				'execution area; work-on is human-only). Choose a separate human dir.',
		);
	}
	return dir;
}

/**
 * A sensible SUGGESTION for the human worktree root. Deliberately uses a name
 * (`~/worktrees`) that does NOT share a prefix with the usual code dir
 * (`~/dev/...`), so shell tab-completion on the code dir never collides with it.
 * This is only a suggestion — there is no silent default; the human confirms.
 */
export function suggestHumanWorktreesDir(): string {
	return join(homedir(), 'worktrees');
}

/** Remove a worktree registration from the hub (git's own removal, never rm -rf). */
function clearWorktree(
	mirrorPath: string,
	dir: string,
	env: NodeJS.ProcessEnv | undefined,
): void {
	if (existsSync(dir)) {
		try {
			git(['worktree', 'remove', '--force', dir], mirrorPath, {env});
		} catch {
			// not a registered worktree — fall through to a plain rm + prune
			rmSync(dir, {recursive: true, force: true});
		}
	}
	try {
		git(['worktree', 'prune'], mirrorPath, {env});
	} catch {
		// best-effort
	}
}

/** Drop a branch from the hub if it exists (idempotent re-run safety). */
function pruneBranch(
	mirrorPath: string,
	branch: string,
	env: NodeJS.ProcessEnv | undefined,
): void {
	try {
		git(['branch', '-D', branch], mirrorPath, {env});
	} catch {
		// branch may not exist
	}
}

/**
 * The canonical arbiter URL a mirror tracks for a given `remote` spec. The
 * mirror is cloned from `remote`, so the tracked URL is just the trimmed spec
 * (the same value {@link ensureMirror} would resolve from `url`).
 */
function ensureMirrorUrl(remote: string): string {
	return remote.trim();
}

/** Run git, returning the raw result (no throw) — for soft checks. */
function gitSoft(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	return runAsync('git', args, cwd, {env});
}

/**
 * Resolve `humanWorktreesDir` + `configPath` for the CLI: read config from
 * `configPath` and surface its `humanWorktreesDir` (undefined ⇒ first use). The
 * CLI wires the prompt/save around this; kept here so the wiring is testable.
 */
export function loadHumanWorktreesDir(
	configPath: string = defaultConfigPath(),
): {
	dir: string | undefined;
	config: Config;
} {
	const config = loadConfig(configPath);
	return {dir: config.humanWorktreesDir, config};
}

/** Save a chosen `humanWorktreesDir` back to `configPath`, preserving the rest. */
export function persistHumanWorktreesDir(
	dir: string,
	configPath: string = defaultConfigPath(),
): void {
	const config = loadConfig(configPath);
	saveConfig({...config, humanWorktreesDir: dir}, configPath);
}

// Re-export for callers that want the encoding without importing repo-mirror.
export {encodeRepoKey};
