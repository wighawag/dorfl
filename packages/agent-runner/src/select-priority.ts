import {selectCandidates, type Candidate, type SelectCaps} from './select.js';
import type {ScanReport} from './scan.js';
import {
	resolveSlicingEligibility,
	type HumanOnlyGate,
} from './slicing-eligibility.js';

/**
 * The SHARED, PURE selection-and-ordering helper for the multi-item `do` forms
 * (`do` auto-pick / `do -n <x>` / `do <a> <b> …`) and the slices-first priority
 * (ADR `command-surface-and-journeys` §3 — "eligible slices first, then PRDs to
 * slice (drain ready work before creating more), with a per-repo toggle to flip
 * it").
 *
 * It is the ONE place the two-pool priority lives, so it is not duplicated when
 * `run`'s tick later adopts the SAME "slices-first, then PRDs to slice" priority
 * (ADR §3: "the `run`/`do` auto-slice step"). This slice (`do-autopick`) OWNS and
 * builds this helper; it does NOT retro-wire `run` to call it (at `do-autopick`
 * time `run`'s tick is slice-only — concurrent + looped — and adopting this
 * helper, so `run` also auto-slices eligible PRDs, is a noted FOLLOW-UP once both
 * land). Build it standalone; do not assume `run` already calls it.
 *
 * **Two POOLS, not one.** The `scan`/`selectCandidates`/eligibility model is
 * SLICE-ONLY (there is no PRD candidate). So this helper composes:
 *
 *   - the **slices pool** — the EXISTING {@link selectCandidates} path (round-robin
 *     across repos, capped). This is the EXACT slice-selection primitive `run`
 *     uses, so `run` and this helper SHARE it (the criterion "the shared helper is
 *     the one `run` uses" — they share `selectCandidates`, the slice-pool core).
 *   - the **PRD-to-slice pool** — a NEW pool the caller builds from the PRD reader
 *     (`ledgerRead.resolvePrdPool`) filtered by `autoslice-gate`'s pure predicate
 *     ({@link resolveSlicingEligibility}); see {@link sliceablePrds}. The helper
 *     does NOT reinvent PRD eligibility.
 *
 * `do` is STRICTLY SEQUENTIAL (parallelism is `run`'s job, ADR §3) — this helper
 * only ORDERS + COUNTS the items; the caller runs the existing `do` pipeline per
 * item one at a time. `count` bounds how many items are taken (auto-pick = 1,
 * `-n <x>` = x). It is NOT a parallelism knob.
 */

/**
 * Which namespace a selected item names (mirrors the slug-namespace split). The
 * `do` selection only ever produces `slice`/`prd`; the `advance` selection ALSO
 * produces `observation` (the lifecycle triage pool, slice
 * `advance-autopick-lifecycle-pools`), so a selected lifecycle item carries which
 * rung the driver dispatches to. The widening is BACKWARD-COMPATIBLE: `do` never
 * emits `observation` (its lifecycle pools default to none, see
 * {@link selectPrioritised}).
 */
export type SelectedNamespace = 'slice' | 'prd' | 'observation';

/** One item the selection layer picked, in run order. */
export interface SelectedItem {
	/** The repo this item lives in (a working checkout for in-place `do`). */
	repoPath: string;
	/** The bare slug to act on. */
	slug: string;
	/**
	 * `'slice'` ⇒ run the slice-build `do` pipeline; `'prd'` ⇒ dispatch to the
	 * `do prd:<slug>` slicing path (slicing itself is `autoslice-command`, not
	 * here); `'observation'` ⇒ (advance only) the triage rung via `obs:<slug>`. The
	 * caller turns this into the right `do`/`advance` arg/dispatch.
	 */
	namespace: SelectedNamespace;
}

/**
 * A lifecycle-pool selected item (slice `advance-autopick-lifecycle-pools`). It is
 * a {@link SelectedItem} — the same shape — carrying the lifecycle namespace
 * (`observation` for triage; `slice`/`prd` for a `needsAnswers`-blocked item the
 * tick will surface/apply). A distinct alias names the lifecycle pools at the
 * call sites WITHOUT a structural difference (the discriminator is `namespace`).
 */
export type LifecycleSelectedItem = SelectedItem;

/** A PRD candidate for the slicing pool, before the eligibility gate runs. */
export interface PrdCandidate {
	repoPath: string;
	slug: string;
	humanOnly: HumanOnlyGate;
	needsAnswers: HumanOnlyGate;
	sliceAfter: string[];
}

/** Inputs to {@link sliceablePrds}: the raw PRD pool + the gate context. */
export interface SliceablePrdsInput {
	/** Every PRD enumerated from `work/prd/` (the auto-slice candidate source). */
	candidates: PrdCandidate[];
	/** Slugs whose PRD resides in `work/prd-sliced/` (resolves `sliceAfter`). */
	slicedSlugs: Set<string>;
	/** The repo's resolved `autoSlice` policy (`autoslice-gate`'s per-repo key). */
	autoSlice: boolean;
}

/**
 * Filter a raw PRD pool down to the SLICEABLE PRDs, in declaration order, using
 * `autoslice-gate`'s pure predicate ({@link resolveSlicingEligibility}) — NOT a
 * reinvented eligibility model. A PRD is sliceable iff `needsAnswers !== true &&
 * humanOnly !== true && autoSlice` AND every `sliceAfter` PRD is already sliced.
 * Pure: no I/O (the caller reads the pool through `ledgerRead.resolvePrdPool`).
 */
export function sliceablePrds(input: SliceablePrdsInput): PrdCandidate[] {
	return input.candidates.filter(
		(prd) =>
			resolveSlicingEligibility({
				humanOnly: prd.humanOnly,
				needsAnswers: prd.needsAnswers,
				sliceAfter: prd.sliceAfter,
				slicedSlugs: input.slicedSlugs,
				autoSlice: input.autoSlice,
			}).sliceable,
	);
}

/** Inputs to {@link selectPrioritised}: the two pools + ordering + count. */
export interface SelectPrioritisedInput {
	/**
	 * The slice pool source — a `scan` report (slice-only, the existing model) +
	 * the concurrency/selection caps. The helper runs the EXISTING
	 * {@link selectCandidates} over it, so the slice ordering is byte-identical to
	 * what `run` selects (the shared primitive).
	 */
	report: ScanReport;
	/** Caps for the slice-pool selection (round-robin/per-repo/total). */
	caps: SelectCaps;
	/**
	 * The ALREADY-FILTERED sliceable PRD pool (run {@link sliceablePrds} first).
	 * In declaration order; this helper does not re-gate them.
	 */
	prds: PrdCandidate[];
	/**
	 * Pool order: `false` (default) ⇒ **slices first, then PRDs to slice** (ADR §3,
	 * "drain ready work before creating more"); `true` ⇒ flip (PRDs to slice
	 * first). The per-repo `prdsFirst` toggle.
	 */
	prdsFirst?: boolean;
	/**
	 * How many items to take across ALL pools, in priority order. Auto-pick = 1;
	 * `do -n <x>` = x. Unset ⇒ take ALL eligible items (the priority order is still
	 * applied). Sequential — NOT a parallelism knob.
	 */
	count?: number;
	/**
	 * The OPTIONAL lifecycle pools (slice `advance-autopick-lifecycle-pools`),
	 * constructed CALLER-SIDE (the `advance` callers only) and passed in — exactly
	 * as {@link prds} is. DEFAULTS to none, so `performDoAuto` (which passes only
	 * its two pools) is provably UNCHANGED: `do` auto-pick never selects an
	 * observation or a `needsAnswers` item. ONLY the `advance` callers
	 * (`performAdvanceAuto` / the mirror-side advance path) supply these.
	 *
	 * The INTERIM four-pool order (this slice; the configurable order is the sibling
	 * `advance-selection-order-config`): drain BUILDABLE work first (eligible slices
	 * → sliceable PRDs, today's slices-first generalized), THEN the lifecycle pools
	 * (apply → surface → triage — consume before the two create rungs). `prdsFirst`
	 * still only flips the slice/PRD pair within the buildable group.
	 */
	lifecycle?: SelectedLifecyclePools;
}

/** The (optional) lifecycle pools handed to {@link selectPrioritised}, pre-built. */
export interface SelectedLifecyclePools {
	/** `apply` items (answered sidecars; CONSUME, always present when supplied). */
	apply: LifecycleSelectedItem[];
	/** `surface` items (blocked, no all-answered sidecar; already gate-filtered). */
	surface: LifecycleSelectedItem[];
	/** `triage` items (untriaged observations; already gate-filtered). */
	triage: LifecycleSelectedItem[];
}

/**
 * Build the ordered, counted list of items to do across the two pools, applying
 * the slices-first (or flipped) priority and the count bound. The slice pool is
 * selected via the EXISTING {@link selectCandidates} (the shared primitive `run`
 * uses); the PRD pool is the pre-filtered {@link sliceablePrds} output. The two
 * are concatenated in the priority order, then truncated to `count`.
 *
 * Deterministic + pure. The caller runs the existing `do` pipeline per returned
 * item, SEQUENTIALLY.
 */
export function selectPrioritised(
	input: SelectPrioritisedInput,
): SelectedItem[] {
	const sliceItems: SelectedItem[] = selectCandidates(
		input.report,
		input.caps,
	).map((candidate: Candidate) => ({
		repoPath: candidate.repoPath,
		slug: candidate.slug,
		namespace: 'slice' as const,
	}));

	const prdItems: SelectedItem[] = input.prds.map((prd) => ({
		repoPath: prd.repoPath,
		slug: prd.slug,
		namespace: 'prd' as const,
	}));

	const buildable = input.prdsFirst
		? [...prdItems, ...sliceItems]
		: [...sliceItems, ...prdItems];

	// The INTERIM four-pool order: BUILDABLE work first (the buildable group above),
	// THEN the lifecycle pools (apply → surface → triage — consume before the two
	// create rungs). The lifecycle pools default to none, so `do` is unchanged. The
	// CONFIGURABLE order (presets / explicit list / apply-pinned-first, subsuming
	// `prdsFirst`) is the sibling slice `advance-selection-order-config`.
	const lifecycle = input.lifecycle;
	const lifecycleItems: SelectedItem[] = lifecycle
		? [...lifecycle.apply, ...lifecycle.surface, ...lifecycle.triage]
		: [];
	const ordered = [...buildable, ...lifecycleItems];

	if (input.count === undefined) {
		return ordered;
	}
	return ordered.slice(0, Math.max(0, input.count));
}
