import {runAsync, localMainDivergence} from './git.js';
import {isParticipatingRepo} from './detect.js';
import {scanRepoPaths, type RepoReport} from './scan.js';
import {arbiterStatus} from './arbiter.js';
import {listMirrors} from './registry.js';
import {encodeRepoKey, mirrorPath} from './repo-mirror.js';
import type {Config} from './config.js';
import type {ConfigOverrideMap} from './config-override.js';

/**
 * The CWD-LOCAL section of `scan`/`status` (the `scan-status-read-cwd-repo`
 * slice). When a command runs INSIDE a participating repo, it ALSO reports that
 * CURRENT repo as a clearly-labelled, separately-counted LOCAL section, in
 * addition to (NEVER merged into) the cross-repo REGISTRY view.
 *
 * The consistency rule this module enforces (do not violate):
 *
 *   - The local section reads the LOCAL WORKING TREE (`scanRepoPaths([cwd])`) —
 *     your possibly-uncommitted / unpushed / diverged state — NOT the bare
 *     mirror-ref the registry reads. The two reads have DIFFERENT freshness +
 *     storage models, so they are kept VISUALLY + SEMANTICALLY distinct, each
 *     with its OWN count. A merged grand total would be true in NEITHER model.
 *   - **Fetch-first ALSO for the cwd** (the maintainer's explicit ask): the cwd
 *     repo's arbiter is fetched BEFORE the divergence is computed (the local
 *     working tree is the LEAST authoritative view), reusing the
 *     `scan-status-fetch-first` fetch+warn+fallback discipline — a failed fetch
 *     WARNS and falls back to last-known, NEVER errors out (a read-only command
 *     must degrade, ADR §5/§6).
 *   - The divergence-vs-arbiter is shown with the `main-divergence-guard` framing
 *     (`local main is N commits ahead of <arbiter>/main` = unpushed).
 *   - **De-dup:** if the cwd repo is ALSO registered, it is shown ONCE in the
 *     local section marked "(also registered)" and its registry row is dropped
 *     from the registry list — so the same repo never appears as two mystery
 *     rows with possibly-disagreeing states.
 *
 * The registry model is UNCHANGED by this: `scan`/`status` are read-only DISPLAY
 * surfaces; the daemon (`run`) + the arbiter CAS still claim against the REGISTRY
 * only. Showing the cwd changes nothing about where claims happen.
 */

/** The cwd repo's arbiter, as resolved for the local section's divergence line. */
export interface CwdArbiter {
	/** The arbiter remote name inspected (e.g. `arbiter` / `origin`). */
	remote: string;
	/** True iff the cwd repo has a remote with that name. */
	configured: boolean;
	/** The arbiter's URL, when configured. */
	url?: string;
	/**
	 * True iff the cwd repo's arbiter `main` was FRESHLY FETCHED before the
	 * divergence was computed. False ⇒ the fetch failed (offline / no arbiter) and
	 * the divergence reflects the last-known arbiter ref (a warning was emitted).
	 */
	fetched: boolean;
	/** Commits local `main` is AHEAD of `<arbiter>/main` (unpushed). */
	ahead: number;
	/** Commits local `main` is BEHIND `<arbiter>/main` (needs a pull/rebase). */
	behind: number;
}

/** The cwd-local section report (one repo: the current working tree). */
export interface CwdSection {
	/** Absolute path to the cwd repo. */
	path: string;
	/**
	 * True iff the cwd is a participating repo (a `work/backlog/` with ≥1 `.md`).
	 * When false, every other field is absent — there is NO local section.
	 */
	participating: boolean;
	/** The cwd repo's `work/` lifecycle, read from the LOCAL WORKING TREE. */
	repo?: RepoReport;
	/** Total backlog item count for the cwd (its OWN count, never merged). */
	totalItems?: number;
	/** Eligible item count for the cwd (its OWN count). */
	totalEligible?: number;
	/**
	 * True iff the cwd repo is ALSO in the registry (its arbiter URL keys to a
	 * registered hub mirror). When true the cwd is de-duped: shown once here,
	 * marked "(also registered)", and its registry row is dropped.
	 */
	alsoRegistered?: boolean;
	/**
	 * The registered hub-mirror PATH the cwd de-dups against (so the registry view
	 * can drop that row). Present only when {@link alsoRegistered} is true.
	 */
	registeredMirrorPath?: string;
	/** The cwd repo's arbiter + divergence (fetch-first). Absent when no arbiter. */
	arbiter?: CwdArbiter;
}

/** Inputs to {@link resolveCwdSection}. */
export interface ResolveCwdSectionOptions {
	/** The current working directory to inspect (the candidate cwd repo). */
	cwd: string;
	/** Resolved global config (for `workspacesDir` + per-repo `autoBuild`). */
	config: Config;
	/**
	 * The per-machine {@link ConfigOverrideMap}. Threaded into the local
	 * working-tree scan so the cwd section's eligibility reflects the per-machine
	 * override (consistent with the autopick / advance paths). Default: none.
	 */
	override?: ConfigOverrideMap;
	/**
	 * The arbiter remote name to fetch + diff against. Defaults to the same remote
	 * `status`'s arbiter section resolves; the CLI passes the configured value.
	 */
	arbiterRemote?: string;
	/** Sink for the fetch-first fall-back warning (warn + last-known, never error). */
	warn?: (message: string) => void;
	env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the cwd-local section for `scan`/`status`. Returns
 * `{participating: false}` when the cwd is NOT a participating repo (the callers
 * then render only the registry view, unchanged). When participating it:
 *
 *   1. reads the cwd's `work/` lifecycle from the LOCAL WORKING TREE
 *      (`scanRepoPaths([cwd])`);
 *   2. FETCHES the cwd repo's arbiter first (warn + fall back to last-known on
 *      failure — never errors), then computes the divergence vs `<arbiter>/main`;
 *   3. de-dups against the registry (is the cwd's arbiter URL a registered
 *      mirror?).
 *
 * It MUTATES nothing but the arbiter fetch (a read refresh, same as the registry
 * fetch-first); it never claims/moves/integrates.
 */
export async function resolveCwdSection(
	options: ResolveCwdSectionOptions,
): Promise<CwdSection> {
	const {cwd, config, warn, env} = options;

	if (!isParticipatingRepo(cwd)) {
		return {path: cwd, participating: false};
	}

	// 1. The cwd's `work/` lifecycle from the LOCAL WORKING TREE (not a mirror ref).
	//    Thread the per-machine override so the cwd section's eligibility matches
	//    what `do`/`advance` autopick will actually select.
	const localReport = scanRepoPaths([cwd], config, new Set(), options.override);
	const repo = localReport.repos[0];

	// 2. The cwd repo's arbiter + fetch-first divergence. We resolve the arbiter
	//    via the SAME `arbiterStatus` the dashboard's arbiter section uses; if it
	//    is configured we fetch it BEFORE diffing (the local tree is the least
	//    authoritative view) — warn + fall back to last-known on failure.
	const arbiter = await resolveCwdArbiter({
		cwd,
		remote: options.arbiterRemote,
		warn,
		env,
	});

	// 3. De-dup: is the cwd's arbiter URL a registered hub mirror? Compare the
	//    cwd's mirror KEY (from its arbiter URL) against the registry's keys.
	const {alsoRegistered, registeredMirrorPath} = resolveRegistration({
		arbiterUrl: arbiter?.url,
		config,
		env,
	});

	return {
		path: cwd,
		participating: true,
		repo,
		totalItems: localReport.totalItems,
		totalEligible: localReport.totalEligible,
		alsoRegistered,
		...(registeredMirrorPath !== undefined ? {registeredMirrorPath} : {}),
		...(arbiter !== undefined ? {arbiter} : {}),
	};
}

/**
 * Resolve the cwd repo's arbiter + divergence. Reuses `arbiterStatus` to find
 * the arbiter remote/URL, FETCHES its `main` first (warn + fall back to
 * last-known on failure — NEVER errors, ADR §5/§6), then reads the divergence of
 * local `main` vs `<arbiter>/main` in both directions. Returns `undefined` when
 * no arbiter remote is configured (no divergence line to show).
 */
async function resolveCwdArbiter(input: {
	cwd: string;
	remote?: string;
	warn?: (message: string) => void;
	env?: NodeJS.ProcessEnv;
}): Promise<CwdArbiter | undefined> {
	const {cwd, env} = input;
	const status = arbiterStatus({cwd, remote: input.remote, env});
	if (!status.configured) {
		return undefined;
	}
	const remote = status.remote;

	// Fetch-first ALSO for the cwd (the maintainer's explicit ask): refresh the
	// arbiter's `main` before diffing, reusing scan-status-fetch-first's
	// fetch+warn+fallback. A failed fetch is NOT fatal — warn + last-known.
	let fetched = false;
	const fetch = await runAsync('git', ['fetch', '--quiet', remote], cwd, {env});
	if (fetch.status === 0) {
		fetched = true;
	} else {
		input.warn?.(
			`could not fetch the cwd repo's arbiter '${remote}'; ` +
				'computing local divergence from last-known (offline). ' +
				fetch.stderr.trim(),
		);
	}

	const {ahead, behind} = await localMainDivergence(cwd, remote, env);
	return {
		remote,
		configured: true,
		url: status.url,
		fetched,
		ahead,
		behind,
	};
}

/**
 * De-dup helper: is the cwd repo (identified by its arbiter URL) ALSO registered
 * in the registry? The registry keys a mirror off its arbiter URL via
 * `encodeRepoKey`/`mirrorPath`, so we encode the cwd's arbiter URL the same way
 * and look for a matching registered mirror (by key, robust to the lossy URL).
 * Returns whether it is registered + the matching mirror path (so the registry
 * view can drop that row). With no arbiter URL there is nothing to match.
 */
function resolveRegistration(input: {
	arbiterUrl: string | undefined;
	config: Config;
	env?: NodeJS.ProcessEnv;
}): {alsoRegistered: boolean; registeredMirrorPath?: string} {
	const {arbiterUrl, config, env} = input;
	if (arbiterUrl === undefined || arbiterUrl.trim() === '') {
		return {alsoRegistered: false};
	}
	const cwdKey = encodeRepoKey(arbiterUrl);
	const cwdMirrorPath = mirrorPath(config.workspacesDir, arbiterUrl);
	for (const mirror of listMirrors({
		workspacesDir: config.workspacesDir,
		env,
	})) {
		if (mirror.key === cwdKey || mirror.path === cwdMirrorPath) {
			return {alsoRegistered: true, registeredMirrorPath: mirror.path};
		}
	}
	return {alsoRegistered: false};
}
