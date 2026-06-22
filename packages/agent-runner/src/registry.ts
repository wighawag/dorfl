import {existsSync, readdirSync, rmSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {run} from './git.js';
import {
	encodeRepoKey,
	ensureMirror,
	mirrorPath,
	readOriginUrl,
} from './repo-mirror.js';
import {arbiterInit, type ArbiterInitResult} from './arbiter.js';
import {
	discoverJobs,
	evaluateDeletionSafety,
	RETAIN_REASON_TEXT,
	type GcJob,
} from './gc.js';

/**
 * The **registry** primitive (ADR `command-surface-and-journeys` §1): the
 * registered set of targets IS the set of hub mirrors on disk under
 * `<workspacesDir>/repos/<key>.git`. There is NO `roots` and NO `remotes` config
 * field — discovery is "enumerate the mirror folders". This module is that
 * enumeration plus the `remote add/rm` mutators; it reuses the `repo-mirror`
 * hub primitive (`ensureMirror`/`encodeRepoKey`/`mirrorPath`) and the `arbiter`
 * provisioner (`arbiterInit` for `--local`) — it does NOT duplicate them.
 *
 * The `remote ls` view reads each mirror's `origin` URL with `git -C <mirror>
 * remote get-url origin` (the key encoding is LOSSY — it drops scheme/transport
 * — so the URL is NOT reconstructible from the key) and derives the transport
 * from that URL's scheme.
 */

/** A registered hub mirror's self-description (the `remote ls` row). */
export interface RegisteredMirror {
	/** The hierarchical hub key (`host/org/name`), as `encodeRepoKey` produces. */
	key: string;
	/** Absolute path to the bare hub mirror (`<workspacesDir>/repos/<key>.git`). */
	path: string;
	/**
	 * The mirror's `origin` URL (`git -C <path> remote get-url origin`), or
	 * `undefined` if it cannot be read (a malformed mirror).
	 */
	originUrl?: string;
	/** The transport derived from `originUrl`'s scheme. */
	transport: Transport;
	/**
	 * The trailing `org/name` of the key — the project identity the transport
	 * guard keys on (siblings under different transports share this tail).
	 */
	projectId: string;
}

/**
 * The transport a mirror's origin uses, derived from its URL scheme:
 * `local-bare` (`file://` or a plain filesystem path to a bare repo) vs
 * `remote-host` (`git@`/`https`/`http`/`ssh`). `unknown` when no origin URL
 * could be read.
 */
export type Transport = 'local-bare' | 'remote-host' | 'unknown';

/** Inputs to the registry enumeration / mutators. */
export interface RegistryOptions {
	/** The execution working area (config `workspacesDir`, default `~/.agent-runner`). */
	workspacesDir: string;
	env?: NodeJS.ProcessEnv;
}

/** Raised when a registry operation cannot proceed safely. */
export class RegistryError extends Error {}

/** The `repos/` directory under `workspacesDir` that holds the hub mirrors. */
function reposDir(workspacesDir: string): string {
	return join(workspacesDir, 'repos');
}

/**
 * Derive the transport from a remote URL's scheme. `file://` (and a plain
 * absolute path to a bare repo) ⇒ `local-bare`; `git@`/`https`/`http`/`ssh`
 * (anything with a host) ⇒ `remote-host`. This is the same scheme split
 * `encodeRepoKey` deliberately collapses away from the KEY — here we keep it for
 * the transport guard + `remote ls`.
 */
export function transportForUrl(url: string): Transport {
	const trimmed = url.trim();
	if (trimmed === '') {
		return 'unknown';
	}
	if (trimmed.startsWith('file://') || trimmed.startsWith('/')) {
		return 'local-bare';
	}
	// scp-like ssh (`git@host:org/repo`) or any `scheme://host/...` is a remote host.
	return 'remote-host';
}

/** The trailing `org/name` of a hub key (the project identity for the guard). */
export function projectIdFromKey(key: string): string {
	const segments = key.split('/').filter((s) => s.length > 0);
	// Keep the last two segments (`org/name`); fall back to the whole key when a
	// degenerate key has fewer than two segments.
	return segments.slice(-2).join('/');
}

/**
 * The on-disk hub-key for an arbiter URL is encoded WITH a `.git` directory
 * suffix; the mirror folder is `<key>.git`. Recover the hub key from a folder
 * name by stripping that trailing `.git`.
 */
function keyFromMirrorDir(name: string): string {
	return name.endsWith('.git') ? name.slice(0, -'.git'.length) : name;
}

/** True iff `path` is (or contains) an initialised git repository. */
function pathHoldsGitRepo(
	path: string,
	env: NodeJS.ProcessEnv | undefined,
): boolean {
	if (!existsSync(path)) {
		return false;
	}
	return run('git', ['rev-parse', '--git-dir'], path, {env}).status === 0;
}

/**
 * Enumerate the registered hub mirrors (the registry). Walks the bare mirror
 * folders under `<workspacesDir>/repos/<key>.git` — which exist hierarchically
 * (`host/org/name.git`), so a leaf `*.git` directory holding a git repo IS a
 * mirror. Reads each one's `origin` URL + transport (the key is lossy). Sorted
 * by key. This is the SINGLE "list registered mirrors" primitive that both
 * `remote ls` AND `scan`/`status` discovery consume.
 */
export function listMirrors(options: RegistryOptions): RegisteredMirror[] {
	const root = reposDir(options.workspacesDir);
	if (!existsSync(root)) {
		return [];
	}
	const mirrors: RegisteredMirror[] = [];
	// Walk for `*.git` leaf directories that hold a git repo (the hub mirrors).
	const stack: string[] = [root];
	while (stack.length > 0) {
		const dir = stack.pop()!;
		let entries: import('node:fs').Dirent[];
		try {
			entries = readdirSync(dir, {withFileTypes: true});
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}
			const full = join(dir, entry.name);
			if (entry.name.endsWith('.git') && pathHoldsGitRepo(full, options.env)) {
				const key = relKey(root, full);
				const originUrl = readOriginUrl(full, options.env);
				mirrors.push({
					key,
					path: full,
					originUrl,
					transport:
						originUrl === undefined ? 'unknown' : transportForUrl(originUrl),
					projectId: projectIdFromKey(key),
				});
				continue;
			}
			// Descend into intermediate (non-`.git`) directories.
			stack.push(full);
		}
	}
	return mirrors.sort((a, b) => a.key.localeCompare(b.key));
}

/** The hub key for a mirror dir relative to `<workspacesDir>/repos/`. */
function relKey(reposRoot: string, mirrorPathAbs: string): string {
	const rel = mirrorPathAbs.slice(reposRoot.length).replace(/^[/\\]+/, '');
	return keyFromMirrorDir(rel.split('\\').join('/'));
}

/** The result of `remote add`. */
export interface RemoteAddResult {
	/** The hub key the target was registered under. */
	key: string;
	/** Absolute path to the (existing or just-created) hub mirror. */
	mirrorPath: string;
	/** The origin URL the mirror tracks. */
	url: string;
	/** The transport derived from `url`. */
	transport: Transport;
	/** True iff the mirror did not exist and was just created. */
	created: boolean;
	/**
	 * The provisioned local bare arbiter, when `--local` provisioned one (it
	 * absorbs `arbiter init`). Absent for a plain remote add.
	 */
	arbiter?: ArbiterInitResult;
}

/** Inputs to {@link remoteAdd}. */
export interface RemoteAddOptions extends RegistryOptions {
	/**
	 * The target to register. For a plain (remote) add this is the arbiter URL.
	 * For `--local` it is the WORKING REPO whose `--bare` arbiter is provisioned
	 * (the old `arbiter init` input).
	 */
	target: string;
	/**
	 * Provision a LOCAL `--bare` arbiter from `target` (a working repo) and
	 * register ITS mirror — absorbing `arbiter init`. The arbiter is provisioned
	 * under `arbitersDir` (precious DATA, ADR §7), never `~/.agent-runner`.
	 */
	local?: boolean;
	/** Where local `--bare` arbiters are provisioned (config `arbitersDir`). Required for `--local`. */
	arbitersDir?: string;
	/** The arbiter remote name to wire in the working repo on `--local`. */
	arbiterRemote?: string;
	/**
	 * Override the project-identity POLICY block: REPLACE this project's existing
	 * mirror (re-link remote ↔ `--bare` arbiter deliberately) even though a sibling
	 * mirror for the same project (same `projectIdFromKey` tail) already exists
	 * under a different key. `force` overrides the POLICY block ONLY — it NEVER
	 * overrides the DATA-LOSS block: if any worktree of the mirror being replaced
	 * holds un-pushed work (dirty tree OR a `work/*` tip not reachable on the
	 * arbiter — the full `gc.ts` clean-AND-reachable predicate), `force` still
	 * REFUSES, because replacing would strand that work.
	 */
	force?: boolean;
	/** Sink for human-readable progress notes. */
	note?: (message: string) => void;
}

/**
 * Raised when `--force` cannot REPLACE a project's mirror because a worktree of
 * the mirror being replaced still holds un-pushed work (a DATA-LOSS block,
 * distinct from the POLICY block `--force` overrides). The reason names each
 * unsafe worktree so the human can rescue the work before re-running.
 */
export class ReplaceWouldStrandWorkError extends RegistryError {}

/**
 * Register a target by creating its hub mirror (the `ensureMirror` primitive).
 * Idempotent: an existing mirror is fetched + reused, not clobbered. With
 * `--local`, first provisions a `--bare` arbiter from the working repo
 * (`arbiterInit`, absorbing `arbiter init`) and registers THAT arbiter's mirror.
 *
 * Project-identity guard (anti-stranding, ADR §1 +
 * `work/observations/hub-mirror-key-ignores-transport.md`): if a sibling mirror
 * for the SAME project (same `projectIdFromKey` tail) already exists under a
 * DIFFERENT key (a transport mismatch OR a same-transport path/host collision),
 * refuse by default — registering the project under a second key would fork the
 * mirror and risk stranding un-pushed `work/<slug>` work on the other mirror.
 *
 * `--force` REPLACES the existing mirror(s) for the project (so you can re-link
 * a project's mirror from a remote to a `--bare` arbiter, or vice-versa,
 * deliberately) — but `--force` overrides the POLICY block ONLY, NEVER the
 * DATA-LOSS block: if any worktree of the mirror being replaced still holds
 * un-pushed work (the full `gc.ts` clean-AND-reachable per-worktree predicate),
 * the replace REFUSES with {@link ReplaceWouldStrandWorkError}. (An identical
 * key is the idempotent reuse case, NOT a conflict — it is the same mirror.)
 */
export function remoteAdd(options: RemoteAddOptions): RemoteAddResult {
	const env = options.env;
	const note = options.note ?? (() => {});

	let url: string;
	let arbiter: ArbiterInitResult | undefined;
	if (options.local) {
		if (!options.arbitersDir || options.arbitersDir.trim() === '') {
			throw new RegistryError(
				'remote add --local requires `arbitersDir` (the CLI passes the resolved config).',
			);
		}
		// Provision (or locate) the local bare arbiter from the working repo, then
		// register ITS file:// URL. This absorbs `arbiter init`.
		arbiter = arbiterInit({
			repo: options.target,
			arbitersDir: options.arbitersDir,
			remote: options.arbiterRemote,
			env,
			note,
		});
		url = arbiter.url;
	} else {
		url = options.target.trim();
		if (url === '') {
			throw new RegistryError('remote add requires a target URL.');
		}
	}

	const transport = transportForUrl(url);
	const key = encodeRepoKey(url);
	const projectId = projectIdFromKey(key);
	const destPath = mirrorPath(options.workspacesDir, url);

	// Project-identity guard: a sibling mirror for the SAME project under a
	// DIFFERENT key (same `projectIdFromKey` tail) risks stranding un-pushed work.
	// An identical key is the idempotent reuse case, NOT a conflict (same mirror).
	const siblings = listMirrors({
		workspacesDir: options.workspacesDir,
		env,
	}).filter((m) => m.projectId === projectId && m.key !== key);

	if (siblings.length > 0) {
		if (!options.force) {
			// POLICY block (default): refuse the project-identity collision. Name the
			// existing mirror(s) + transport(s) so the human sees WHAT collides.
			const existing = siblings[0];
			throw new RegistryError(
				`refusing: project '${projectId}' is already registered (mirror ` +
					`${existing.key}, transport '${existing.transport}', origin ` +
					`${existing.originUrl ?? '(unknown)'}). Registering it under a second ` +
					`key (${key}, transport '${transport}') would fork the mirror and risk ` +
					'stranding un-pushed work on the other mirror. Re-run with --force to ' +
					'REPLACE the existing mirror (force replaces the mirror, but still ' +
					'refuses if un-pushed work would be lost).',
			);
		}

		// --force REPLACE path: force overrides the POLICY block, NEVER the
		// DATA-LOSS block. Before replacing, run the FULL per-worktree predicate
		// (gc.ts's clean-AND-reachable) across EVERY worktree of the sibling
		// mirror(s) — committed-but-unpushed work lives in the mirror's refs, but
		// UNCOMMITTED (dirty) work is only on disk, invisible to a refs-only check.
		// A single dirty-or-unreachable worktree BLOCKS the replace.
		const unsafe = unsafeWorktreesForMirrors(
			options.workspacesDir,
			new Set(siblings.map((m) => m.key)),
			env,
		);
		if (unsafe.length > 0) {
			const details = unsafe
				.map((u) => `  - ${u.slug} (${u.dir}): ${u.reasonText}`)
				.join('\n');
			throw new ReplaceWouldStrandWorkError(
				`refusing --force replace of project '${projectId}': the mirror being ` +
					`replaced has worktree(s) with un-pushed work that would be stranded.\n` +
					`${details}\n` +
					'--force overrides the registration POLICY, never the DATA-LOSS guard. ' +
					'Push/merge or gc --force each worktree above, then re-run.',
			);
		}

		// Safe to replace: every sibling worktree is provably clean + reachable.
		// Delete the sibling mirror(s) so the project re-links onto the new key.
		for (const sibling of siblings) {
			remoteRm({
				target: sibling.key,
				workspacesDir: options.workspacesDir,
				env,
			});
			note(
				`replaced: removed prior mirror '${sibling.key}' for '${projectId}'.`,
			);
		}
	}

	const result = ensureMirror({url, workspacesDir: options.workspacesDir, env});
	if (result.created) {
		note(`registered '${key}' (created hub mirror at ${result.path}).`);
	} else {
		note(
			`'${key}' already registered (fetched existing mirror at ${result.path}).`,
		);
	}

	return {
		key,
		mirrorPath: result.path,
		url: result.url,
		transport,
		created: result.created,
		...(arbiter ? {arbiter} : {}),
	};
}

/** One worktree the replace-guard found to hold un-pushed work (data-loss). */
interface UnsafeWorktree {
	/** The job worktree directory. */
	dir: string;
	/** The work slug (from the job record, else derived). */
	slug: string;
	/** Human-readable reason it is not provably safe (the `gc` retain reason). */
	reasonText: string;
}

/**
 * Enumerate the worktrees of the mirror(s) identified by `mirrorKeys` and run
 * `gc.ts`'s FULL clean-AND-reachable per-worktree predicate
 * ({@link evaluateDeletionSafety}) in each, returning the ones that are NOT
 * provably safe (a dirty tree OR a `work/*` tip not reachable on the arbiter).
 *
 * Worktrees are discovered via {@link discoverJobs} (which walks
 * `<workspacesDir>/work/*` for `.agent-runner-job.json` records, each carrying
 * the mirror `repoKey`), so a job is attributed to its mirror by KEY. This is
 * the DATA-LOSS guard the `--force` replace path consults: replacing a mirror
 * that still has un-pushed work would strand it, so `--force` proceeds ONLY when
 * this returns empty (every worktree clean + reachable).
 */
function unsafeWorktreesForMirrors(
	workspacesDir: string,
	mirrorKeys: Set<string>,
	env: NodeJS.ProcessEnv | undefined,
): UnsafeWorktree[] {
	const unsafe: UnsafeWorktree[] = [];
	for (const job of discoverJobs(workspacesDir)) {
		if (!jobBelongsToMirror(job, mirrorKeys)) {
			continue;
		}
		const verdict = evaluateDeletionSafety({
			dir: job.dir,
			branch: job.branch,
			env,
		});
		if (!verdict.safe) {
			const reason = verdict.reason ?? 'unmerged-commits';
			unsafe.push({
				dir: job.dir,
				slug: job.slug,
				reasonText: RETAIN_REASON_TEXT[reason],
			});
		}
	}
	return unsafe;
}

/** True iff `job`'s record attributes it to one of `mirrorKeys`. */
function jobBelongsToMirror(job: GcJob, mirrorKeys: Set<string>): boolean {
	const key = job.record?.repoKey;
	return key !== undefined && mirrorKeys.has(key);
}

/** The result of `remote rm`. */
export interface RemoteRmResult {
	/** The hub key that was removed. */
	key: string;
	/** Absolute path to the deleted mirror. */
	path: string;
	/** True iff a mirror existed and was deleted (false ⇒ nothing matched). */
	removed: boolean;
}

/** Inputs to {@link remoteRm}. */
export interface RemoteRmOptions extends RegistryOptions {
	/** The mirror to delete, by hub KEY (`host/org/name`) or by its origin URL. */
	target: string;
}

/**
 * Delete a hub mirror by key or origin URL — the ONLY mirror deleter (`gc`
 * NEVER reaps mirrors). Resolves `target` first as a literal key, then by
 * encoding it as a URL (so both `remote rm <key>` and `remote rm <url>` work),
 * and finally by matching any registered mirror's origin URL. Removes the bare
 * mirror directory (a self-contained `<key>.git` folder under `repos/`).
 */
export function remoteRm(options: RemoteRmOptions): RemoteRmResult {
	const env = options.env;
	const target = options.target.trim();
	const mirrors = listMirrors({workspacesDir: options.workspacesDir, env});

	// Resolve the mirror to delete: by literal key, by URL→key, or by origin URL.
	const byKey = mirrors.find((m) => m.key === target);
	const urlKey = target === '' ? undefined : encodeRepoKey(target);
	const byUrlKey =
		urlKey !== undefined ? mirrors.find((m) => m.key === urlKey) : undefined;
	const byOrigin = mirrors.find((m) => m.originUrl === target);
	const match = byKey ?? byUrlKey ?? byOrigin;

	if (match === undefined) {
		return {key: target, path: '', removed: false};
	}

	// Guard: only remove a self-contained bare mirror directory under repos/.
	if (existsSync(match.path) && statSync(match.path).isDirectory()) {
		rmSync(match.path, {recursive: true, force: true});
	}
	return {key: match.key, path: match.path, removed: true};
}
