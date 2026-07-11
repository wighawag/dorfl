import {selectCandidates, type Candidate, type SelectCaps} from './select.js';
import type {ScanReport} from './scan.js';
import {
	resolveTaskingEligibility,
	type HumanOnlyGate,
} from './tasking-eligibility.js';
import {
	resolveSelectionOrder,
	DEFAULT_SELECTION_ORDER,
	type SelectionPool,
	type SelectionOrderConfig,
} from './select-order.js';

/**
 * The SHARED, PURE selection-and-ordering helper for the multi-item `do`/`advance`
 * forms (auto-pick / `-n <x>` / `<a> <b> …`) and the CONFIGURABLE selection ORDER
 * (task `advance-selection-order-config`; ADR `ci-config-policy-and-gate-family`,
 * selection-order section). `apply` is PINNED FIRST (consume-always-wins); the
 * other four pools (`build` / `task` / `surface` / `triage`) are ranked by the
 * per-repo `selectionOrder` field (a PRESET keyword or an explicit pool-name
 * list), whose `drain` default reproduces today's tasks-first "drain ready work
 * before creating more".
 *
 * It is the ONE place the cross-pool ordering lives, so it is not duplicated when
 * `run`'s tick later adopts the SAME priority
 * (ADR §3: "the `run`/`do` auto-task step"). This task (`do-autopick`) OWNS and
 * builds this helper; it does NOT retro-wire `run` to call it (at `do-autopick`
 * time `run`'s tick is task-only — concurrent + looped — and adopting this
 * helper, so `run` also auto-tasks eligible prds, is a noted FOLLOW-UP once both
 * land). Build it standalone; do not assume `run` already calls it.
 *
 * **Up to FIVE pools.** The `scan`/`selectCandidates`/eligibility model is
 * TASK-ONLY (there is no spec candidate). So this helper composes:
 *
 *   - the **`build` pool** (eligible TASKS) — the EXISTING {@link selectCandidates}
 *     path (round-robin across repos, capped). This is the EXACT task-selection
 *     primitive `run` uses, so `run` and this helper SHARE it (they share
 *     `selectCandidates`, the task-pool core).
 *   - the **`task` pool** (spec-to-task) — a pool the caller builds from the spec reader
 *     (`ledgerRead.resolveSpecPool`) filtered by `autoslice-gate`'s pure predicate
 *     ({@link resolveTaskingEligibility}); see {@link taskableSpecs}. The helper
 *     does NOT reinvent spec eligibility.
 *
 * `do` is STRICTLY SEQUENTIAL (parallelism is `run`'s job, ADR §3) — this helper
 * only ORDERS + COUNTS the items; the caller runs the existing `do` pipeline per
 * item one at a time. `count` bounds how many items are taken (auto-pick = 1,
 * `-n <x>` = x). It is NOT a parallelism knob.
 */

/**
 * Which namespace a selected item names (mirrors the slug-namespace split). The
 * `do` selection only ever produces `task`/`spec`; the `advance` selection ALSO
 * produces `observation` (the lifecycle triage pool, task
 * `advance-autopick-lifecycle-pools`), so a selected lifecycle item carries which
 * rung the driver dispatches to. The widening is BACKWARD-COMPATIBLE: `do` never
 * emits `observation` (its lifecycle pools default to none, see
 * {@link selectPrioritised}).
 */
export type SelectedNamespace = 'task' | 'spec' | 'observation';

/** One item the selection layer picked, in run order. */
export interface SelectedItem {
	/** The repo this item lives in (a working checkout for in-place `do`). */
	repoPath: string;
	/** The bare slug to act on. */
	slug: string;
	/**
	 * `'task'` ⇒ run the task-build `do` pipeline; `'spec'` ⇒ dispatch to the
	 * `do spec:<slug>` tasking path (tasking itself is `autoslice-command`, not
	 * here); `'observation'` ⇒ (advance only) the triage rung via `obs:<slug>`. The
	 * caller turns this into the right `do`/`advance` arg/dispatch.
	 */
	namespace: SelectedNamespace;
}

/**
 * A lifecycle-pool selected item (task `advance-autopick-lifecycle-pools`). It is
 * a {@link SelectedItem} — the same shape — carrying the lifecycle namespace
 * (`observation` for triage; `task`/`spec` for a `needsAnswers`-blocked item the
 * tick will surface/apply). A distinct alias names the lifecycle pools at the
 * call sites WITHOUT a structural difference (the discriminator is `namespace`).
 */
export type LifecycleSelectedItem = SelectedItem;

/** A spec candidate for the tasking pool, before the eligibility gate runs. */
export interface SpecCandidate {
	repoPath: string;
	slug: string;
	humanOnly: HumanOnlyGate;
	needsAnswers: HumanOnlyGate;
	taskedAfter: string[];
}

/** Inputs to {@link taskableSpecs}: the raw spec pool + the gate context. */
export interface TaskableSpecsInput {
	/** Every spec enumerated from `work/specs/ready/` (the auto-task candidate source). */
	candidates: SpecCandidate[];
	/** Slugs whose spec resides in `work/specs/tasked/` (resolves `taskedAfter`). */
	taskedSlugs: Set<string>;
	/** The repo's resolved `autoTask` policy (`autoslice-gate`'s per-repo key). */
	autoTask: boolean;
}

/**
 * Filter a raw spec pool down to the TASKABLE prds, in declaration order, using
 * `autoslice-gate`'s pure predicate ({@link resolveTaskingEligibility}) — NOT a
 * reinvented eligibility model. A spec is taskable iff `needsAnswers !== true &&
 * humanOnly !== true && autoTask` AND every `taskedAfter` spec is already tasked.
 * Pure: no I/O (the caller reads the pool through `ledgerRead.resolveSpecPool`).
 */
export function taskableSpecs(input: TaskableSpecsInput): SpecCandidate[] {
	return input.candidates.filter(
		(spec) =>
			resolveTaskingEligibility({
				humanOnly: spec.humanOnly,
				needsAnswers: spec.needsAnswers,
				taskedAfter: spec.taskedAfter,
				taskedSlugs: input.taskedSlugs,
				autoTask: input.autoTask,
			}).taskable,
	);
}

/** Inputs to {@link selectPrioritised}: the pools + ordering + count. */
export interface SelectPrioritisedInput {
	/**
	 * The task pool source — a `scan` report (task-only, the existing model) +
	 * the concurrency/selection caps. The helper runs the EXISTING
	 * {@link selectCandidates} over it, so the task ordering is byte-identical to
	 * what `run` selects (the shared primitive).
	 */
	report: ScanReport;
	/** Caps for the task-pool selection (round-robin/per-repo/total). */
	caps: SelectCaps;
	/**
	 * The ALREADY-FILTERED taskable spec pool (run {@link taskableSpecs} first).
	 * In declaration order; this helper does not re-gate them.
	 */
	specs: SpecCandidate[];
	/**
	 * The configurable selection ORDER across the four ORDERABLE pools (`build` /
	 * `task` / `surface` / `triage`), as a PRESET keyword or an explicit pool-name
	 * list (task `advance-selection-order-config`; the `selectionOrder` config
	 * field). Resolved through {@link resolveSelectionOrder} (apply is pinned first
	 * and NOT nameable here). OMITTED ⇒ the `drain` default (`[build, task,
	 * surface, triage]`), which reproduces today's tasks-first "drain before
	 * create" two-pool default. `[task, build, ...]` reproduces the old
	 * `prdsFirst: true`. An unknown name/keyword FAILS LOUDLY.
	 */
	selectionOrder?: SelectionOrderConfig;
	/**
	 * How many items to take across ALL pools, in priority order. Auto-pick = 1;
	 * `do -n <x>` = x. Unset ⇒ take ALL eligible items (the priority order is still
	 * applied). Sequential — NOT a parallelism knob.
	 */
	count?: number;
	/**
	 * The OPTIONAL lifecycle pools (task `advance-autopick-lifecycle-pools`),
	 * constructed CALLER-SIDE (the `advance` callers only) and passed in — exactly
	 * as {@link prds} is. DEFAULTS to none, so `performDoAuto` (which passes only
	 * its two pools) is provably UNCHANGED: `do` auto-pick never selects an
	 * observation or a `needsAnswers` item. ONLY the `advance` callers
	 * (`performAdvanceAuto` / the mirror-side advance path) supply these.
	 *
	 * Ordered per the resolved {@link selectionOrder}: `apply` is ALWAYS prepended
	 * (pinned first — consume-always-wins), then the four orderable pools (`build` /
	 * `task` / `surface` / `triage`) in the configured order, truncated to
	 * {@link count}. A pool NAMED in the order but absent here (gated off — empty)
	 * is simply a no-op (it contributes no items), so the gates (what is PRESENT)
	 * and `selectionOrder` (what runs first) compose ORTHOGONALLY.
	 */
	lifecycle?: SelectedLifecyclePools;
	/**
	 * The HELD-SLUG set to SUBTRACT from the `build` pool (eligible TASKS) — spec
	 * `ledger-status-per-item-lock-refs` US #15, task
	 * `claim-acquires-unified-lock-no-body-move`. A task whose per-item lock is
	 * currently held is dropped from selection, so the eligible pool is "in
	 * `backlog/` on `main` AND no lock held". Normally the `report` is already
	 * subtracted at {@link scoreItems} time (the readers gather held locks), so this
	 * is a SECOND, explicit guard for callers that build the report WITHOUT the
	 * subtraction; OMITTED ⇒ no extra filtering. Redundant-but-harmless while the
	 * body still moves to `in-progress/`; in force for task #9.
	 */
	heldSlugs?: Set<string>;
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
 * Build the ordered, counted list of items to do across the (up to) FIVE pools,
 * applying the configurable {@link selectionOrder} with `apply` PINNED FIRST and
 * the count bound. The task pool is selected via the EXISTING
 * {@link selectCandidates} (the shared primitive `run` uses); the spec pool is the
 * pre-filtered {@link taskableSpecs} output; the lifecycle pools (`apply` /
 * `surface` / `triage`) are caller-built (none for `do`).
 *
 * Ordering: `apply` is always prepended (consume-always-wins; not orderable),
 * then the four orderable pools (`build` = eligible tasks, `task` = taskable
 * prds, `surface`, `triage`) interleaved in the resolved {@link selectionOrder}
 * (default `drain` = `[build, task, surface, triage]`, which reproduces today's
 * tasks-first two-pool default). A pool named in the order but EMPTY (gated off)
 * contributes nothing — a no-op, not an error (gates decide what is PRESENT,
 * `selectionOrder` ranks what is present). Then truncated to `count`.
 *
 * Deterministic + pure. The caller runs the existing `do` pipeline per returned
 * item, SEQUENTIALLY.
 */
export function selectPrioritised(
	input: SelectPrioritisedInput,
): SelectedItem[] {
	const held = input.heldSlugs;
	const buildItems: SelectedItem[] = selectCandidates(input.report, input.caps)
		.filter((candidate: Candidate) => !held || !held.has(candidate.slug))
		.map((candidate: Candidate) => ({
			repoPath: candidate.repoPath,
			slug: candidate.slug,
			namespace: 'task' as const,
		}));

	const taskItems: SelectedItem[] = input.specs.map((spec) => ({
		repoPath: spec.repoPath,
		slug: spec.slug,
		namespace: 'spec' as const,
	}));

	const lifecycle = input.lifecycle;

	// The per-pool item lists, keyed by the orderable pool name. NOTE the
	// vocabulary bridge: `build` = the eligible-TASK pool (namespace `task`),
	// `task` = the taskable-spec pool (namespace `spec`) — the action names, not the
	// item namespaces (task `advance-selection-order-config`).
	const byPool: Record<SelectionPool, SelectedItem[]> = {
		build: buildItems,
		task: taskItems,
		surface: lifecycle?.surface ?? [],
		triage: lifecycle?.triage ?? [],
	};

	// Resolve the configured order (preset or explicit list; unknown name/keyword
	// FAILS LOUDLY here). OMITTED ⇒ the `drain` default.
	const order = resolveSelectionOrder(
		input.selectionOrder ?? DEFAULT_SELECTION_ORDER,
	);

	// `apply` is ALWAYS first (pinned, not orderable), then the four orderable
	// pools in the resolved order. An absent (gated-off) pool's list is empty, so it
	// drops out cleanly — no special-casing.
	const applyItems = lifecycle?.apply ?? [];
	const ordered: SelectedItem[] = [
		...applyItems,
		...order.flatMap((pool) => byPool[pool]),
	];

	if (input.count === undefined) {
		return ordered;
	}
	return ordered.slice(0, Math.max(0, input.count));
}
