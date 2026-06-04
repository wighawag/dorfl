import {parseFrontmatter} from './frontmatter.js';
import {resolveBlockedBy} from './eligibility.js';
import {ledgerRead} from './ledger-read.js';

/**
 * The pre-claim readiness guard for the HUMAN `start` / `claim` path. Today the
 * human path decides purely on the FOLDER on `<arbiter>/main` (is the slug in
 * `backlog/`?) and never parses the slice's frontmatter — so it will happily
 * claim a slice whose `blockedBy` deps are not yet in `work/done/`, or one
 * flagged `needsAnswers: true`. The autonomous `run --once` path already filters
 * these out (scan → eligibility → select); this closes that asymmetry for the
 * human path.
 *
 * It reads the SAME source of truth the folder check uses — the slice file and
 * the `work/done/` listing on `<arbiter>/main` — and resolves `blockedBy` with
 * the shared {@link resolveBlockedBy} (no reimplemented dep resolution).
 *
 * The two axes are deliberately treated differently (see WORK-CONTRACT and the
 * slice brief):
 *
 *   - `blockedBy` unmet is a FACTUAL prerequisite (the dep work does not exist
 *     yet) → REFUSE by default. An override flag is the human escape hatch.
 *   - `needsAnswers: true` is a softer, set-by-someone flag (the claimer may be
 *     the one about to resolve it) → WARN loudly but still claim. The same
 *     override silences the warning.
 *
 * `humanOnly` is NOT consulted here: `start`/`claim` is the human path, and a
 * human is never bound by `humanOnly` (it means "a human must drive this", and
 * the human is here).
 */

export interface ReadinessVerdict {
	/**
	 * `true` when the claim should be REFUSED before the CAS runs (an unmet
	 * `blockedBy`, not overridden). When `true`, the caller claims nothing.
	 */
	refuse: boolean;
	/** Blocker slugs not present in `work/done/` on the arbiter, in order. */
	missing: string[];
	/** Whether the slice declares `needsAnswers: true`. */
	needsAnswers: boolean;
	/**
	 * `true` when an override flag was supplied (the refusal is bypassed and the
	 * `needsAnswers` warning is silenced — loudly).
	 */
	overridden: boolean;
}

export interface ResolveReadinessOptions {
	/** The slug being claimed (`work/backlog/<slug>.md`). */
	slug: string;
	/** Working clone the human path runs in. */
	cwd: string;
	/** Name of the arbiter git remote. */
	arbiter: string;
	/** Override flag (`--force` / `--ignore-not-ready`): bypass refusal + warning. */
	override: boolean;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the readiness of a slice against `<arbiter>/main`. PURE w.r.t. the
 * work tree — it reads only committed objects on the arbiter (the slice file and
 * the `work/done/` listing), the same source of truth the folder check uses.
 *
 * Assumes the caller has already fetched the arbiter (the human path fetches
 * before deciding on the folder). Missing/unparseable slice frontmatter degrades
 * to "no blockers, no needsAnswers" — the folder check, not this guard, owns the
 * "slice exists / is in backlog" decision.
 */
export async function resolveReadiness(
	options: ResolveReadinessOptions,
): Promise<ReadinessVerdict> {
	const {slug, cwd, arbiter, override, env} = options;

	// Resolve the slice + `work/done/` from `<arbiter>/main` THROUGH the read
	// seam's arbiter method — the single insertion point. Same source of truth the
	// folder check uses; behaviour is byte-identical to the inline reads it
	// replaced (slice from `backlog/` or `in-progress/`, done slugs from the tree).
	const {slice, doneSlugs} = await ledgerRead.resolveArbiterState({
		slug,
		cwd,
		arbiter,
		env,
	});
	const fm = parseFrontmatter(slice ?? '');
	const needsAnswers = fm.needsAnswers === true;

	const {missing} = resolveBlockedBy(fm.blockedBy, doneSlugs);

	return {
		refuse: missing.length > 0 && !override,
		missing,
		needsAnswers,
		overridden: override,
	};
}
