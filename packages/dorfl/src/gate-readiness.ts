import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {run} from './git.js';
import {resolvePrepareCommands, type PrepareConfig} from './prepare.js';

/**
 * Pre-claim / pre-build startup GUARD for the fresh-worktree acceptance gate
 * (task `do-fails-fast-when-acceptance-gate-statically-unrunnable`).
 *
 * The fresh-worktree gate (`gate-on-rebased-tip-fresh-worktree`, ON by default)
 * runs `prepare` then `verify` in a CLEAN throwaway worktree with NO
 * `node_modules`. If `prepare` resolves to no commands AND the repo has a
 * lockfile (evidence that an install IS required), the gate will provably fail
 * with "command not found" — a STATICALLY-detectable misconfiguration we can
 * surface at second zero, BEFORE wasting a claim + agent build + a routed
 * needs-attention.
 *
 * Critical non-regression: `prepare` resolving to no commands is a DELIBERATE
 * no-op (`prepare.ts`: "a repo with no deps needs none; we never invent a
 * default that would run `pnpm install` in a repo that has no lockfile"). So
 * the guard KEYS off LOCKFILE-PRESENT evidence — never off `prepare`-unset
 * alone — and a genuinely dep-free repo (no lockfile) PROCEEDS unchanged.
 *
 * There is NO "verify unset" case: {@link resolveVerifyCommands} substitutes
 * `DEFAULT_VERIFY_COMMAND` when `verify` is unset OR all-blank, so `verify` is
 * NEVER statically unrunnable-because-unset. A "verify unset → STOP" guard
 * would be dead code (or fire wrongly on the default). The guard is deps-only.
 *
 * The guard is also gated on `freshWorktreeGate === true` for THIS invocation:
 * when the gate is OFF (`--no-fresh-worktree-gate`) the acceptance gate runs in
 * the agent's BUILD worktree (which HAS deps), so the throwaway-worktree
 * reasoning does not apply.
 */

/**
 * The lockfile basenames whose presence implies an install is required. Order
 * is the search order (first match wins — its basename is the one named in the
 * guard message).
 */
export const LOCKFILE_BASENAMES = [
	'pnpm-lock.yaml',
	'package-lock.json',
	'yarn.lock',
] as const;

/**
 * Probe `cwd` for one of {@link LOCKFILE_BASENAMES} on disk and return the
 * first match (or `undefined`). The standard probe for the in-place / job-
 * worktree paths where the repo is materialised on disk.
 */
export function detectLockfileOnDisk(cwd: string): string | undefined {
	return LOCKFILE_BASENAMES.find((name) => existsSync(join(cwd, name)));
}

/**
 * Probe a BARE mirror's `main` ref via `git ls-tree` for one of
 * {@link LOCKFILE_BASENAMES} and return the first match (or `undefined`). Used
 * by the no-checkout `do --remote` path, which has no working tree until AFTER
 * the claim; this lets the guard fire BEFORE the claim. Best-effort: a missing
 * `main` ref or a failing `git ls-tree` returns `undefined` (the guard then
 * stays quiet and any genuine plumbing error surfaces later as a usage error).
 */
export function detectLockfileOnMirrorMain(
	mirrorPath: string,
	env?: NodeJS.ProcessEnv,
): string | undefined {
	const res = run(
		'git',
		['ls-tree', '--name-only', 'main', ...LOCKFILE_BASENAMES],
		mirrorPath,
		{env},
	);
	if (res.status !== 0) {
		return undefined;
	}
	const present = new Set(
		res.stdout
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line !== ''),
	);
	return LOCKFILE_BASENAMES.find((name) => present.has(name));
}

export interface GatePreconditionInput {
	/**
	 * The resolved fresh-worktree-gate flag for THIS invocation
	 * (flag > env > per-repo > global > default `true`). The guard ONLY fires when
	 * this is exactly `true` — `false`/`undefined` ⇒ the throwaway-worktree
	 * reasoning does not apply and the guard returns `undefined`.
	 */
	freshWorktreeGate: boolean | undefined;
	/** The resolved `prepare` config (unset / string / list). */
	prepare?: PrepareConfig;
	/**
	 * The lockfile basename probed for this repo (one of
	 * {@link LOCKFILE_BASENAMES}), or `undefined` for the intentional dep-free
	 * case. The caller picks the probe ({@link detectLockfileOnDisk} for the
	 * in-place / job-worktree paths, {@link detectLockfileOnMirrorMain} for the
	 * no-checkout `do --remote` path).
	 */
	lockfile: string | undefined;
}

export interface GatePreconditionFailure {
	/** The lockfile basename (from {@link LOCKFILE_BASENAMES}) that tripped the guard. */
	lockfile: string;
	/** A precise, actionable error message naming the lockfile and the two ways out. */
	message: string;
}

/**
 * Check the fresh-worktree-gate startup preconditions. Returns the failure
 * (with a precise message) when the gate is STATICALLY unrunnable for the
 * deps-only reason; returns `undefined` otherwise (proceed normally).
 *
 * NOTE — deps-only, not verify-presence: see the file-level doc.
 */
export function checkGatePreconditions(
	input: GatePreconditionInput,
): GatePreconditionFailure | undefined {
	// Gate OFF for THIS invocation ⇒ no throwaway worktree ⇒ the deps reasoning
	// does not apply. (The default is ON; the guard fires when ON.)
	if (input.freshWorktreeGate !== true) {
		return undefined;
	}
	// `prepare` resolves to at least one command ⇒ the throwaway worktree will
	// install (or codegen, etc.); not statically unrunnable. Covers BOTH `prepare`
	// unset AND an all-blank list returning `[]` via the SAME `resolvePrepareCommands`.
	if (resolvePrepareCommands(input.prepare).length > 0) {
		return undefined;
	}
	// No lockfile ⇒ the intentional dep-free repo (the design point preserved):
	// `prepare` unset is a DELIBERATE no-op and `verify` runs against a repo that
	// needs no install — proceed.
	if (input.lockfile === undefined) {
		return undefined;
	}
	return {
		lockfile: input.lockfile,
		message:
			'the fresh-worktree gate is on but no `prepare` step is configured, ' +
			`and a lockfile (${input.lockfile}) is present — the throwaway worktree ` +
			'will have no installed deps, so the gate cannot run. Add a `prepare` ' +
			'(e.g. `pnpm install --frozen-lockfile`) or pass --no-fresh-worktree-gate.',
	};
}
