import {type RunResult} from './git.js';

/**
 * **Shared `gh`-failure diagnostics** for the two `gh`-backed provider seams (the
 * review-request `GitHubProvider` in `github.ts` and the `GitHubIssueProvider` in
 * `issue-provider.ts`).
 *
 * Both providers shell out to `gh` and must, on a failure, surface the REAL cause
 * — the actual `gh` stderr (a rate-limit, a permissions error, a transient 5xx),
 * NOT a hard-coded "`gh` is unavailable or unauthenticated" guess that sends an
 * operator chasing a phantom auth problem. This module is the single source of
 * truth for that distillation so the two providers can NEVER drift apart on the
 * next fix (the drift the original hard-coded strings created).
 *
 * Both `gh`-shelling helpers (`runGh`) return `RunResult | undefined`, where
 * `undefined` = the `gh` BINARY could not be spawned (missing / not on `PATH`).
 * That case has no `RunResult` to read, so the PAIR below resolves it to a fixed
 * "binary missing" string and reserves {@link ghFailureReason} for a genuine
 * `RunResult`.
 */

/** The fixed reason for a missing/unspawnable `gh` binary (no `RunResult` to read). */
export const GH_BINARY_MISSING = '`gh` is not available (binary missing).';

/**
 * Distil the REAL reason a `gh` invocation failed from its result — the trimmed
 * stderr (the actual cause, e.g. `'agent-runner:processing' not found`), falling
 * back to the exit status when stderr is empty. This is what replaces the old
 * hard-coded "unavailable or unauthenticated" guess: the cause must be diagnosable.
 *
 * Requires a NON-undefined `RunResult` (it reads `stderr`/`status`); a missing
 * binary (`undefined`) has no result to read — use {@link ghFailureDetail} when
 * the value may be `undefined`.
 */
export function ghFailureReason(result: RunResult): string {
	const stderr = result.stderr.trim();
	if (stderr) {
		return stderr;
	}
	return `\`gh\` exited ${result.status}.`;
}

/**
 * Resolve the real failure detail for a `gh` shell-out whose result MAY be
 * `undefined` (binary missing) — the two-arm guard both providers' degrade paths
 * need: a missing binary yields the fixed {@link GH_BINARY_MISSING} string, and
 * only a genuine `RunResult` is passed to {@link ghFailureReason}. This keeps the
 * undefined-vs-`RunResult` split in ONE place so no degrade branch ever calls
 * `ghFailureReason(undefined)`.
 */
export function ghFailureDetail(result: RunResult | undefined): string {
	return result === undefined ? GH_BINARY_MISSING : ghFailureReason(result);
}
