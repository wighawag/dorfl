import type {SidecarModel} from './sidecar.js';
import {allAnswered} from './sidecar.js';
import type {LifecycleSelectedItem} from './select-priority.js';

/**
 * The SHARED, PURE enumeration of the advance auto-pick's LIFECYCLE POOLS (task
 * `advance-autopick-lifecycle-pools`) \u2014 the MISSING FOUNDATION a 2026-06-12 review
 * found. Before this, `performAdvanceAuto` (in-place) and `scanMirrorPool`
 * (mirror-side) enumerated ONLY the two BUILD pools (eligible tasks + taskable
 * prds), so a bare / `-n` / loop / CI `advance` could ONLY build tasks + task
 * prds. The lifecycle rungs (triage / surface / apply) were EXPLICIT-INVOCATION-
 * ONLY because NOTHING enumerated observations or `needsAnswers`-blocked items
 * into the selection. This unit closes that gap, at the SELECTION layer ONLY (it
 * does NOT touch the classifier `advance-classify.ts` or the rung bodies \u2014 the
 * tick still re-classifies each selected item and runs the right rung).
 *
 * It is ONE shared unit reused by BOTH the in-place caller (`performAdvanceAuto`)
 * and the mirror-side caller (`scanMirrorPool` \u2192 the loop/CI drivers), NOT two
 * divergent enumerations. The per-substrate I/O (reading `work/notes/observations/` +
 * the per-item sidecar state) is done CALLER-SIDE through the read seam (sync
 * in-place, async mirror-ref) and the already-resolved inputs are handed here \u2014
 * exactly as `taskablePrds` is fed by each caller. This unit is then pure: no I/O.
 *
 * **Three lifecycle sub-pools, gated by PURPOSE (ADR `ci-config-policy-and-gate-
 * family.md` \u00a74 \u2014 gates govern CREATE only; CONSUME is always-on):**
 *
 *   - **triage** \u2014 UNTRIAGED observations (no `triaged:` settled marker). A CREATE
 *     act (the bot mints a promote/keep/delete question), so gated by
 *     {@link LifecyclePoolGates.triage} (the future `observationTriage` gate).
 *   - **surface** \u2014 `needsAnswers`-blocked tasks/prds with NO all-answered sidecar
 *     (no sidecar yet, or a still-pending one). A CREATE act (the bot mints the
 *     blocker question), so gated by {@link LifecyclePoolGates.surface} (the future
 *     `surfaceBlockers` gate). A PENDING sidecar is NOT enumerated (it would only
 *     no-op \u2014 leaving it out keeps the pool calm + thrash-free).
 *   - **apply** \u2014 `needsAnswers`-blocked items WITH an all-answered sidecar. A
 *     CONSUME act (the bot applies the human's committed answer), ALWAYS allowed,
 *     never gated \u2014 gating it would STRAND a human's answer (\u00a74's create-vs-consume
 *     invariant). So an answered sidecar is selected even with BOTH create-gates
 *     off.
 *
 * **INTERIM SAFETY (task `## Decisions`, DECIDED): the create-gates are born
 * OFF.** The gate tasks (`observation-triage-tri-state-gate` /
 * `surface-blockers-gate`) land AFTER this one, so this task must be SAFE
 * STANDALONE: {@link LifecyclePoolGates} default `triage:false` + `surface:false`,
 * so the triage + surface sub-pools contribute NOTHING by default and landing this
 * task alone auto-triages / auto-surfaces NOTHING (it changes no repo's
 * behaviour). The gate tasks REPLACE the hardcoded-off the callers pass with the
 * real `observationTriage` / `surfaceBlockers` config read. The apply sub-pool is
 * NOT gated (consume is always-on), so an answered sidecar always applies.
 */

/**
 * The create-side gates for the lifecycle pools (ADR \u00a72/\u00a74). Both default OFF
 * (the calm interim state) \u2014 the gate tasks flip them on by reading
 * `observationTriage` / `surfaceBlockers` from config. `apply` is NOT here: it is
 * the CONSUME phase, ALWAYS allowed (never gated).
 */
export interface LifecyclePoolGates {
	/**
	 * May the TRIAGE sub-pool (untriaged observations) contribute to the selection?
	 * Default `false` (the interim hardcoded-off; the `observationTriage` gate
	 * replaces this). OFF \u21d2 observations are never auto-selected.
	 */
	triage?: boolean;
	/**
	 * May the SURFACE sub-pool (`needsAnswers`-blocked, no all-answered sidecar)
	 * contribute? Default `false` (the interim hardcoded-off; the `surfaceBlockers`
	 * gate replaces this). OFF \u21d2 blocked items are never auto-surfaced.
	 */
	surface?: boolean;
	/**
	 * Does the SURFACE candidate set widen to include STAGING (`tasks/backlog/` +
	 * `prds/proposed/`), or stay POOL-ONLY? This field is CONSUMED BY THE
	 * GATHER (`lifecycle-gather.ts`), NOT by {@link buildLifecyclePools} — the
	 * builder is pure and only routes already-resolved candidates between surface
	 * / apply by sidecar-answered-state. The gather decides WHICH items become
	 * candidates in the first place; this gate widens that input set when `true`.
	 * Default `false` at THIS library boundary (calm; the CLI threads
	 * `config.surfaceStaging` which itself defaults to `true`, so the user-visible
	 * default is `true`). Prd `staging-surface-and-apply-promote-safety` F2.
	 * BUILD/claim eligibility is UNCHANGED in either mode — staging items stay
	 * non-claimable, the trust model is untouched.
	 */
	surfaceStaging?: boolean;
}

/**
 * One `needsAnswers`-blocked task/prd candidate for the SURFACE/APPLY sub-pools,
 * before this unit routes it. The caller resolves the item's namespace + slug
 * (from `work/backlog` tasks + `work/prds` prds carrying `needsAnswers:true`) and
 * its ACTIVE sidecar (parsed from `work/questions/<type>-<slug>.md`, or
 * `undefined` when none exists) \u2014 through the read seam (sync in-place / async
 * mirror-ref). This unit then routes it to APPLY (sidecar all-answered, consume,
 * always-on) or SURFACE (no all-answered sidecar, create, gated). PURE: no I/O.
 */
export interface NeedsAnswersCandidate {
	/** The repo this item lives in (a working checkout in-place, the mirror path remote). */
	repoPath: string;
	/** `'task'` (a `work/backlog/` task) or `'prd'` (a `work/prds/` prd). */
	namespace: 'task' | 'prd';
	/** The bare slug. */
	slug: string;
	/** The parsed ACTIVE sidecar, or `undefined` when none exists yet. */
	sidecar: SidecarModel | undefined;
}

/**
 * One OBSERVATION candidate for the TRIAGE/APPLY sub-pools, resolved through
 * the same read seam as its `needsAnswers` task/prd siblings (task
 * `route-answered-observation-sidecar-to-apply-pool`). The classifier receives
 * a sidecar-aware observation shape so an ANSWERED observation sidecar routes
 * to the always-on APPLY pool (a CONSUME act — the human's answer is never
 * stranded), while a NO/PENDING sidecar UNTRIAGED observation stays a TRIAGE
 * candidate (gated) as today. PURE: the caller resolves the active sidecar (via
 * {@link sidecarPathFor} — the SAME resolver the task/prd `needsAnswers`
 * candidates use); this unit only routes.
 */
export interface ObservationCandidate {
	/** The observation's identity — its FILENAME slug (never a foreign frontmatter `slug:`). */
	slug: string;
	/**
	 * The SETTLED marker (`triaged:` frontmatter): a non-empty value drops the
	 * observation out of the TRIAGE pool; `undefined` ⇒ UNTRIAGED. IGNORED for
	 * the APPLY routing (an ANSWERED sidecar wins regardless of the marker: a
	 * human's answer must never be stranded — task `## Decisions`).
	 */
	triaged: string | undefined;
	/** The parsed ACTIVE sidecar (`work/questions/observation-<slug>.md`), or `undefined`. */
	sidecar: SidecarModel | undefined;
}

/** Inputs to {@link buildLifecyclePools}: the raw lifecycle candidates + the gates. */
export interface LifecyclePoolsInput {
	/** The repo whose lifecycle items these are (carried onto each selected item). */
	repoPath: string;
	/**
	 * Every observation in `work/notes/observations/` (the read seam's observation
	 * read), each with its resolved active sidecar (task
	 * `route-answered-observation-sidecar-to-apply-pool`). This unit routes each
	 * to APPLY (sidecar all-answered, consume, always-on) or TRIAGE (untriaged, no
	 * all-answered sidecar; create, gated).
	 */
	observations: ObservationCandidate[];
	/**
	 * Every `needsAnswers:true` task/prd (the create-side blocked items), each
	 * with its resolved active sidecar. This unit routes each to SURFACE or APPLY.
	 */
	needsAnswers: NeedsAnswersCandidate[];
	/**
	 * The create-side gates (default BOTH OFF \u2014 the interim hardcoded-off). The
	 * apply sub-pool is never gated.
	 */
	gates?: LifecyclePoolGates;
}

/**
 * The three lifecycle sub-pools, each an ordered {@link LifecycleSelectedItem[]}.
 * The caller concatenates them into the overall selection in the four-pool order
 * (see {@link selectPrioritised}); `apply` is consume (always present), `triage` /
 * `surface` are present only when their gate is on.
 */
export interface LifecyclePools {
	/** `apply` items (answered sidecars; CONSUME, always present). */
	apply: LifecycleSelectedItem[];
	/** `surface` items (blocked, no all-answered sidecar; gated by `gates.surface`). */
	surface: LifecycleSelectedItem[];
	/** `triage` items (untriaged observations; gated by `gates.triage`). */
	triage: LifecycleSelectedItem[];
}

/**
 * Build the three lifecycle sub-pools from the raw candidates + the gates, PURE.
 * Each selected item carries the lifecycle `namespace` discriminator so the
 * driver's per-item dispatch can map it to the right TICK arg (observation \u2192
 * `obs:<slug>`; a blocked task/prd \u2192 `task:`/`prd:<slug>`, which the tick then
 * classifies into surface/apply/no-op). This unit decides WHICH sub-pool each item
 * belongs to (and whether its gate lets it through); the TICK re-classifies and
 * runs the actual rung (the classifier + rung bodies are unchanged).
 *
 * Routing:
 *   - an UNTRIAGED observation \u2192 `triage` (gated by `gates.triage`);
 *   - a `needsAnswers` item with an ALL-ANSWERED sidecar \u2192 `apply` (always);
 *   - a `needsAnswers` item with NO all-answered sidecar \u2192 `surface` (gated by
 *     `gates.surface`); a PENDING sidecar is NOT enumerated into either pool (it
 *     would only no-op \u2014 leaving it out keeps the pool calm).
 */
export function buildLifecyclePools(
	input: LifecyclePoolsInput,
): LifecyclePools {
	const gates = input.gates ?? {};
	const triageOn = gates.triage === true;
	const surfaceOn = gates.surface === true;

	// --- observation routing: apply (all-answered sidecar) vs triage (untriaged) ---
	const triage: LifecycleSelectedItem[] = [];
	const apply: LifecycleSelectedItem[] = [];
	for (const obs of input.observations) {
		const answered = obs.sidecar !== undefined && allAnswered(obs.sidecar);
		if (answered) {
			// CONSUME (apply the human's committed answer) — ALWAYS allowed, even
			// with the triage create-gate off (the create-vs-consume invariant, ADR
			// `ci-config-policy-and-gate-family` §4). An answered sidecar wins even
			// when the observation body also carries a `triaged:` marker: a human's
			// answer must never be stranded (task `## Decisions`).
			apply.push({
				repoPath: input.repoPath,
				slug: obs.slug,
				namespace: 'observation',
			});
		} else if (obs.triaged === undefined && triageOn) {
			// CREATE (mint the promote/keep/delete question) — gated by
			// `observationTriage`. An untriaged observation with NO sidecar or a
			// PENDING sidecar is a triage candidate as today.
			triage.push({
				repoPath: input.repoPath,
				slug: obs.slug,
				namespace: 'observation',
			});
		}
		// else: SETTLED (triaged:) with no answered sidecar — NOT enumerated.
	}

	// --- surface / apply: split `needsAnswers` items by sidecar answered-state ---
	const surface: LifecycleSelectedItem[] = [];
	for (const candidate of input.needsAnswers) {
		const answered =
			candidate.sidecar !== undefined && allAnswered(candidate.sidecar);
		if (answered) {
			// CONSUME (apply the human's committed answer) \u2014 ALWAYS allowed, even with
			// both create-gates off (the create-vs-consume invariant, ADR \u00a74).
			apply.push({
				repoPath: candidate.repoPath,
				slug: candidate.slug,
				namespace: candidate.namespace,
			});
		} else if (candidate.sidecar === undefined && surfaceOn) {
			// CREATE (mint the blocker question) \u2014 gated by `surfaceBlockers`. Only an
			// item with NO sidecar yet is a surface candidate; a PENDING sidecar would
			// only no-op, so it is left OUT of the pool (keeps the selection calm).
			surface.push({
				repoPath: candidate.repoPath,
				slug: candidate.slug,
				namespace: candidate.namespace,
			});
		}
		// else: a PENDING sidecar (exists, not all-answered) \u2014 NOT enumerated.
	}

	return {apply, surface, triage};
}
