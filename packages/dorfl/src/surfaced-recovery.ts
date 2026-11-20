import {sidecarPathFor} from './sidecar.js';
import {workBranchRef} from './slug-namespace.js';

/**
 * The ONE recovery sentence for a task a run SURFACED (a red gate, a blocking
 * review, a continue-push failure): what state it is in and the one recovery that
 * works for that state.
 *
 * After the per-item-lock cutover a bounce writes the question sidecar on main,
 * flips `needsAnswers`, and RELEASES the lock, keeping the work on
 * `work/task-<slug>`. The older wording ("marked stuck on its per-item lock;
 * `requeue` once resolved", plus a `complete --isolated` hint) named recoveries
 * that do not apply to that state: plain `requeue` is a no-op on a released lock,
 * and `complete --isolated` re-runs the integrate the gate just refused. What
 * works is answering the question (`requeue -m` does it in one step) and running
 * `do` again, which continues from the kept branch.
 */
export function surfacedRecoveryHint(slug: string): string {
	return (
		`'${slug}' is surfaced: its question is on main (${sidecarPathFor(`task:${slug}`)}), ` +
		`its lock is released, and the work is kept on ${workBranchRef('task', slug)}. ` +
		`To retry, run \`dorfl requeue ${slug} -m "<instruction>"\` (answers the ` +
		`question with your instruction), then \`dorfl do task:${slug}\` (continues ` +
		'from the kept branch).'
	);
}

/**
 * The recovery sentence for a task surfaced on a CONTINUE-REBASE or INTEGRATION
 * conflict dorfl could not resolve (genuine content on both sides). Answering
 * the question alone would bounce again on the same conflict, so the branch has
 * to be rebased first.
 */
export function surfacedConflictRecoveryHint(slug: string): string {
	const branch = workBranchRef('task', slug);
	return (
		`'${slug}' is surfaced (question on main, lock released, work kept on ` +
		`${branch}). Rebase ${branch} onto the latest main by hand and push it with ` +
		`--force-with-lease, then \`dorfl requeue ${slug} -m "<instruction>"\` and ` +
		`\`dorfl do task:${slug}\`. Last resort: \`dorfl requeue ${slug} --reset\` ` +
		'DESTRUCTIVELY discards the branch and starts fresh.'
	);
}
