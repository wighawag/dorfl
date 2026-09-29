import {runAsync} from './git.js';
import type {MergeQuestions} from './config.js';
import {listItemLockEntriesStrict, type LockEntry} from './item-lock.js';
import {
	surfaceMergeQuestions,
	type SurfaceMergeQuestionsOptions,
	type SurfaceMergeQuestionsResult,
} from './merge-question-surfacer.js';
import {refWrite} from './ref-write.js';

/**
 * The **merge-question TICK** (task `wire-merge-questions-into-the-advance-tick`):
 * the one production caller of {@link surfaceMergeQuestions}, behind the
 * `mergeQuestions: off | ask` gate. Surfacing is deterministic (it reads runner
 * state, no agent), so it runs as its own step rather than as a rung of the
 * per-item tick:
 *
 *   - the laptop bare `advance` runs it before selecting (`advance-drivers.ts`);
 *   - CI runs it as the no-agent `surface-merge-questions` job of the generated
 *     `advance-lifecycle` workflow, through `dorfl surface-merge-questions`
 *     (decision 5). The read-only `enumerate` job does not run it.
 *
 * One pass: fetch the arbiter (so the listing sees its current work branches),
 * read the held item locks STRICTLY (a lock that cannot be read must not look
 * like "no live build"), run the surfacer in `cwd` (each question is its own
 * local commit on `HEAD`, via `persistSurfacedQuestions`), then publish those
 * commits to `<arbiter>/main` through the tree-less publish seam (re-fetch and
 * rebase on a race, never `--force`).
 */

/** Options of {@link runMergeQuestionTick}. */
export interface MergeQuestionTickOptions {
	/** The working clone (checked out on `main`) the questions are committed in. */
	cwd: string;
	/** The arbiter remote NAME in `cwd`. */
	arbiter: string;
	/** The resolved `mergeQuestions` gate. `off` ⇒ nothing runs. */
	mergeQuestions: MergeQuestions;
	/** The base branch. Default `main`. */
	base?: string;
	/**
	 * Push the surfaced questions to `<arbiter>/main`. Default `true`. The laptop
	 * tick passes `false` when it has no arbiter configured (its checkout sits on
	 * the real `main`).
	 */
	publish?: boolean;
	/** The `gh` binary for the open-PR listing (GitHub arbiters). */
	ghBin?: string;
	env?: NodeJS.ProcessEnv;
	note?: (message: string) => void;
	/** Seam: the surfacer (tests). */
	surface?: (
		options: SurfaceMergeQuestionsOptions,
	) => SurfaceMergeQuestionsResult;
	/** Seam: the strict lock read (tests). */
	readLocks?: (
		cwd: string,
		arbiter: string,
		env: NodeJS.ProcessEnv | undefined,
	) => Promise<LockEntry[]>;
}

/** What one {@link runMergeQuestionTick} pass did. */
export interface MergeQuestionTickResult {
	/** `false` when the gate is `off` or a read failed (nothing surfaced). */
	ran: boolean;
	/** `true` when a read the pass depends on failed (fetch, lock refs). */
	failed: boolean;
	/** The surfacer's result, when it ran. */
	result?: SurfaceMergeQuestionsResult;
	/** A one-paragraph summary for the log. */
	message: string;
}

/** Run one merge-question pass (see the module doc). Never throws. */
export async function runMergeQuestionTick(
	options: MergeQuestionTickOptions,
): Promise<MergeQuestionTickResult> {
	const {cwd, arbiter, env} = options;
	const note = options.note ?? (() => {});
	if (options.mergeQuestions === 'off') {
		return {
			ran: false,
			failed: false,
			message: 'mergeQuestions is off: no merge question is surfaced.',
		};
	}
	const url = await runAsync('git', ['remote', 'get-url', arbiter], cwd, {
		env,
	});
	const arbiterUrl = url.status === 0 ? url.stdout.trim() : undefined;
	let locks: LockEntry[] = [];
	if (arbiterUrl !== undefined) {
		// The arbiter's CURRENT work branches (the floor reads the remote-tracking
		// refs of a clone) and `main` (the reachability base).
		const fetched = await runAsync(
			'git',
			['fetch', '--prune', '--quiet', arbiter],
			cwd,
			{env},
		);
		if (fetched.status !== 0) {
			return {
				ran: false,
				failed: true,
				message: `merge questions: fetching ${arbiter} failed (${fetched.stderr.trim()}); nothing surfaced.`,
			};
		}
		try {
			locks = await (options.readLocks ?? listItemLockEntriesStrict)(
				cwd,
				arbiter,
				env,
			);
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			return {
				ran: false,
				failed: true,
				message: `merge questions: the item locks on ${arbiter} could not be read (${detail}); nothing surfaced.`,
			};
		}
	}
	const result = (options.surface ?? surfaceMergeQuestions)({
		cwd,
		arbiterUrl,
		arbiter,
		base: options.base,
		ghBin: options.ghBin,
		env,
		note,
		locks,
	});
	for (const s of result.skipped) {
		note(`merge question: not asked about ${s.ref} (${s.reason}).`);
	}
	for (const s of result.surfaced) {
		note(`merge question: asked about ${s.ref} (${s.sidecarPath}).`);
	}
	if (
		result.surfaced.length > 0 &&
		options.publish !== false &&
		arbiterUrl !== undefined
	) {
		await refWrite.publishTreelessResult({
			cwd,
			arbiter,
			// The same large liveness ceiling the in-place tree-less publish uses: a
			// clean re-rebase never counts against a small budget.
			retries: 1000,
			env,
			note,
		});
	}
	return {
		ran: true,
		failed: false,
		result,
		message:
			`merge questions: ${result.surfaced.length} surfaced, ` +
			`${result.skipped.length} not asked, of ${result.considered} unmerged ` +
			'work branch(es).',
	};
}
