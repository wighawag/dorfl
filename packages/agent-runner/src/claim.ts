import {existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {run, runAsync} from './git.js';

/**
 * Wraps the vendored `scripts/claim.sh` — the atomic compare-and-swap claim from
 * the `wighawag-work-slices` work-contract. The runner NEVER reimplements the
 * claim dance; it shells out to the verified script and interprets its exit
 * codes. claim.sh owns the claim commit (the runner owns all other git-state
 * transitions; the claim is the first of them).
 *
 * Exit codes (from claim.sh / CLAIM-PROTOCOL.md):
 *   0  claimed (work/in-progress/<slug>.md now on the arbiter's main)
 *   1  usage / environment error
 *   2  not claimable (not in backlog, or lost the race) — skip this item
 *   3  push kept failing after retries (contended — try later)
 */
export type ClaimOutcome = 'claimed' | 'lost' | 'contended' | 'error';

export interface ClaimOptions {
	slug: string;
	/** Working clone/worktree the claim runs in (single-checkout: one at a time). */
	cwd: string;
	/** Name of the arbiter remote (claim.sh `--arbiter`). */
	arbiter: string;
	/** Optional advisory claimer id (claim.sh `--by`). */
	by?: string;
	/** Path to claim.sh; defaults to the vendored copy resolved from the package. */
	claimScript?: string;
	/** Environment for the child process (git identity etc.). */
	env?: NodeJS.ProcessEnv;
}

export interface ClaimResult {
	outcome: ClaimOutcome;
	exitCode: number;
	stdout: string;
	stderr: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the vendored claim.sh. At runtime the package lives in
 * `packages/agent-runner/{src,dist}`; the work-contract scripts live at the repo
 * root `scripts/`. We probe a few candidate locations so this works both from
 * `src` (tsx/dev, tests) and `dist` (built). Callers may override via
 * `ClaimOptions.claimScript`.
 */
export function defaultClaimScript(): string {
	const candidates = [
		resolve(HERE, '..', '..', '..', 'scripts', 'claim.sh'),
		resolve(HERE, '..', '..', '..', '..', 'scripts', 'claim.sh'),
		resolve(HERE, '..', 'scripts', 'claim.sh'),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	// Fall back to the first candidate; the error surfaces clearly on use.
	return candidates[0];
}

function outcomeFor(exitCode: number): ClaimOutcome {
	switch (exitCode) {
		case 0:
			return 'claimed';
		case 2:
			return 'lost';
		case 3:
			return 'contended';
		default:
			return 'error';
	}
}

/**
 * Attempt to claim one item via claim.sh. Returns a structured result; a lost
 * race (exit 2) is a CLEAN, expected outcome (`outcome: 'lost'`), never a false
 * "claimed" and never a thrown error.
 */
export function claimItem(options: ClaimOptions): ClaimResult {
	const script = options.claimScript ?? defaultClaimScript();
	const result = run('bash', claimArgs(options, script), options.cwd, {
		env: options.env,
	});
	return {
		outcome: outcomeFor(result.status),
		exitCode: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

/**
 * Async variant of {@link claimItem}: spawns claim.sh without blocking the event
 * loop, so two awaited calls genuinely race (the way claim.sh's own simultaneous
 * two-agent verification does). The arbiter's ref-CAS still picks one winner.
 */
export async function claimItemAsync(
	options: ClaimOptions,
): Promise<ClaimResult> {
	const script = options.claimScript ?? defaultClaimScript();
	const result = await runAsync(
		'bash',
		claimArgs(options, script),
		options.cwd,
		{
			env: options.env,
		},
	);
	return {
		outcome: outcomeFor(result.status),
		exitCode: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

function claimArgs(options: ClaimOptions, script: string): string[] {
	const args = [script, options.slug, '--arbiter', options.arbiter];
	if (options.by) {
		args.push('--by', options.by);
	}
	return args;
}
