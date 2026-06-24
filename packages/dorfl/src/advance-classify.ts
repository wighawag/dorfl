/**
 * The pure `advance` TICK classifier (prd `advance-loop`, task
 * `advance-tick-classifier`) — the substrate-agnostic, read-only seam BOTH the
 * one-shot driver and the loop (`run`) driver wrap. Mirrors the existing pure
 * `categorise.ts` / `eligibility.ts` seams: NO model, NO lock, NO file mutation
 * — it returns WHICH rung on WHICH item from EXACTLY two signals plus the item
 * type, and nothing executes here (the rung EXECUTION is later tasks).
 *
 * The two signals (and ONLY these two):
 *   1. the item's `needsAnswers` flag (from `frontmatter.ts`); and
 *   2. the sidecar's ANSWERED-STATE (from the `advance-sidecar-contract`
 *      keystone: {@link allAnswered} / {@link pendingEntries} over the entries).
 *
 * The per-item state machine (the deterministic trigger — two signals only):
 *
 *   needsAnswers: true?
 *   ├─ NO  → ANALYSE (state-appropriate rung: build a ready task / task a ready
 *   │        prd / triage an untriaged observation). Analysis MAY advance, OR
 *   │        SURFACE questions.
 *   └─ YES → sidecar exists?
 *            ├─ NO  → ANALYSE (first pass: generate questions → write the sidecar)
 *            │        [transitional — surfacing normally writes the sidecar atomically]
 *            └─ YES → all entries answered?
 *                     ├─ YES → ANALYSE: apply the answers + advance.
 *                     └─ NO  → NO-OP (awaiting human).
 *
 * Two invariants this classifier (and the downstream that executes the rung)
 * MUST preserve:
 *   1. `needsAnswers:false ⟺ NO active sidecar` (clear-flag and delete-sidecar are
 *      the SAME atomic step — enforced in `advance-sidecar-contract`'s
 *      `applyAtomic`, asserted HERE at the classifier boundary). A
 *      contradictory input (one set without the other) is the only state the
 *      classifier REFUSES to classify into an ANALYSE/NO-OP rung — it returns the
 *      explicit `invariant-violation` kind so a caller can route it rather than
 *      silently mis-advance.
 *   2. A PENDING (not-all-answered) sidecar makes the tick a clean NO-OP (so a
 *      `run` daemon never spins hot re-surfacing the same question). A SUBSET of
 *      answered entries is still pending ⇒ SKIP (NO-OP).
 *
 * "ANALYSE" is NOT "always advance" — surface-and-pause is itself a rung, so the
 * ANALYSE branch resolves to the per-TYPE rung the executor will run (the cells
 * of the prd's "Per-item-type transitions" table): `build-task` (task),
 * `task-prd` (prd), `triage-observation` (observation) when there are no open
 * questions; `surface` (first-pass question generation) when `needsAnswers` but
 * no sidecar yet; `apply` when all entries are answered.
 */

import type {SidecarModel, SidecarType} from './sidecar.js';
import {allAnswered} from './sidecar.js';

/**
 * One TICK input: an item's TYPE + its two classification signals. `needsAnswers`
 * is the item-body flag (`undefined`/`false` ⇒ not gated; `true` ⇒ gated). The
 * `sidecar` is the parsed ACTIVE sidecar model when one exists, else `undefined`
 * — the classifier reads its answered-state via the keystone's derived helpers,
 * never a third state store.
 */
export interface TickItem {
	/** The item type — the state machine is per-TYPE (task / prd / observation). */
	type: SidecarType;
	/** Autonomy axis 2 (DISCOVERED): `true` ⇒ open questions block autonomous work. */
	needsAnswers: boolean | undefined;
	/** The parsed ACTIVE sidecar, or `undefined` when none exists. */
	sidecar: SidecarModel | undefined;
}

/**
 * The CLASSIFIED rung kinds (a discriminated union NAMING the rung WITHOUT
 * executing it). The ANALYSE rungs split per-type; `surface`/`apply` are
 * type-agnostic transitions; `no-op` is the calm-at-rest result; and
 * `invariant-violation` is the explicit refusal an inconsistent input yields.
 */
export type TickRungKind =
	// --- ANALYSE rungs (no open questions; advance one lifecycle rung) ---
	/** A ready task → build it (later: invoke the `do <slug>` machinery). */
	| 'build-task'
	/** A ready prd → task it (later: invoke the `do prd:<slug>` machinery). */
	| 'task-prd'
	/** An untriaged observation → triage it (auto-disposition or surface a question). */
	| 'triage-observation'
	// --- Transitional ANALYSE rungs (driven by the two signals) ---
	/** `needsAnswers` but NO sidecar yet → first-pass question generation. */
	| 'surface'
	/** A sidecar with EVERY entry answered → apply the answers + advance. */
	| 'apply'
	// --- Calm-at-rest ---
	/** Nothing to do: a PENDING sidecar (awaiting human) or nothing eligible. */
	| 'no-op'
	// --- The refused state ---
	/** The `needsAnswers:false ⟺ no active sidecar` invariant is broken. */
	| 'invariant-violation';

/**
 * The classifier's verdict: the rung kind, the item type it was classified for,
 * and a short machine-stable `reason` tag for the NO-OP / refusal cases (so a
 * caller — or a test — can distinguish "pending sidecar" from "nothing eligible"
 * without re-deriving the signals).
 */
export interface TickClassification {
	kind: TickRungKind;
	type: SidecarType;
	/**
	 * A machine-stable tag explaining a `no-op` / `invariant-violation`:
	 *   - `pending-sidecar` — an active sidecar still has unanswered entries.
	 *   - `needsAnswers-without-sidecar` — `needsAnswers:true` but no sidecar AND
	 *     this should have surfaced (kept for completeness; `surface` covers the
	 *     normal first pass, so this only appears on the refusal path below).
	 *   - `sidecar-without-needsAnswers` — a sidecar exists but `needsAnswers` is
	 *     not `true` (invariant 1 broken — the flag and the sidecar disagree).
	 * `undefined` for the ANALYSE rungs and `apply`/`surface`.
	 */
	reason?:
		| 'pending-sidecar'
		| 'needsAnswers-without-sidecar'
		| 'sidecar-without-needsAnswers';
}

/** The per-TYPE ANALYSE rung when there are no open questions (the no-gate path). */
const ANALYSE_RUNG_FOR_TYPE: Record<SidecarType, TickRungKind> = {
	task: 'build-task',
	prd: 'task-prd',
	observation: 'triage-observation',
};

/**
 * Classify ONE tick PURELY from the item's two signals + its type — read-only,
 * no model, no lock, no file mutation. Returns the classified rung the executor
 * will later run (or `no-op` / `invariant-violation`). The decision tree is the
 * prd's per-item state machine, with invariant 1 asserted at the boundary:
 *
 *   - `needsAnswers` NOT true:
 *       - a sidecar present ⇒ INVARIANT 1 BROKEN (`sidecar-without-needsAnswers`)
 *         → `invariant-violation`. (`needsAnswers:false ⟺ no active sidecar`.)
 *       - no sidecar ⇒ ANALYSE: the per-type rung (`build-task` / `task-prd` /
 *         `triage-observation`).
 *   - `needsAnswers` true:
 *       - NO sidecar ⇒ `surface` (first-pass question generation — transitional).
 *       - a PENDING sidecar (a subset/none answered) ⇒ `no-op` (`pending-sidecar`)
 *         — the clean NO-OP that keeps a `run` daemon from spinning hot; a SUBSET
 *         of answered entries SKIPS here too.
 *       - an ALL-ANSWERED sidecar ⇒ `apply` (apply the answers + advance; the
 *         executor may append new Qs and re-pause, or resolve fully).
 */
export function classifyTick(item: TickItem): TickClassification {
	const {type, needsAnswers, sidecar} = item;
	const gated = needsAnswers === true;

	if (!gated) {
		// Invariant 1: `needsAnswers:false ⟺ no active sidecar`. A sidecar present
		// here means the flag and the sidecar DISAGREE — refuse rather than
		// silently advance past an open question the flag forgot to declare.
		if (sidecar !== undefined) {
			return {
				kind: 'invariant-violation',
				type,
				reason: 'sidecar-without-needsAnswers',
			};
		}
		// ANALYSE: the per-type lifecycle rung (read-only classification only).
		return {kind: ANALYSE_RUNG_FOR_TYPE[type], type};
	}

	// `needsAnswers` is true.
	if (sidecar === undefined) {
		// First pass: no sidecar yet → surface the questions (write it). This is the
		// transitional cell — surfacing normally writes the sidecar atomically, so a
		// gated item without a sidecar is the moment to generate questions.
		return {kind: 'surface', type};
	}

	// A sidecar exists: the two signals AGREE (invariant 1 holds). The answered-
	// state — derived from the ENTRIES, never the frontmatter mirror — decides.
	if (allAnswered(sidecar)) {
		// Every entry answered → apply + advance (the executor may re-pause).
		return {kind: 'apply', type};
	}

	// A PENDING sidecar (a SUBSET answered, or none) ⇒ clean NO-OP. This is the
	// invariant-2 cell: the loop never thrashes on a half-answered item; it idles
	// until the human answers the rest (equivalent to `pendingEntries.length > 0`).
	return {kind: 'no-op', type, reason: 'pending-sidecar'};
}

/**
 * Is this classified rung a CLASSIFIED-NO-OP (the calm-at-rest result)? A small
 * predicate the loop/convergence tests use to assert "the candidate pool is
 * STABLE" — a `no-op` OR an `invariant-violation` is NOT an advanceable rung. The
 * ANALYSE rungs + `surface` + `apply` ARE advanceable.
 */
export function isAdvanceable(classification: TickClassification): boolean {
	return (
		classification.kind !== 'no-op' &&
		classification.kind !== 'invariant-violation'
	);
}
