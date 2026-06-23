/**
 * The pure SELECTION-ORDER resolver: turn the per-repo `selectionOrder` config
 * value (a PRESET keyword OR an explicit pool-name list) into the canonical
 * ordered list of the FOUR orderable pools, which {@link selectPrioritised}
 * interleaves AFTER the always-first `apply` pool.
 *
 * Two load-bearing rules (ADR `ci-config-policy-and-gate-family`, selection-order
 * section; task `advance-selection-order-config`):
 *
 *  1. **`apply` is PINNED FIRST and is NOT nameable here.** Consuming a human's
 *     committed answer is highest-value, cheap (no model), and someone is waiting
 *     — deprioritizing it is never a real want (consume-always-wins). So this
 *     resolver ranks ONLY the other four; naming `apply` in `selectionOrder` is a
 *     LOUD usage error (it signals a misunderstanding — `apply` cannot be reordered).
 *  2. **The value is a PRESET STRING or an explicit ORDER LIST** (the preset is
 *     sugar over a list; the canonical form is the list). A single recognized
 *     preset keyword EXPANDS to its list; ANYTHING else is parsed as an explicit
 *     pool-name list, validating each name. An unknown pool name OR an unknown
 *     single keyword FAILS LOUDLY naming the offending value.
 *
 * Pure: no I/O, no config read. The callers resolve `config.selectionOrder`
 * through this, then hand the ordered list to {@link selectPrioritised}.
 */

/**
 * The four ORDERABLE pools (the ones `selectionOrder` ranks). `apply` is
 * deliberately ABSENT — it is pinned first and not configurable, so it is not a
 * member of this union and naming it is a usage error.
 *
 *  - `build` — build an eligible task;
 *  - `slice` — task a taskable brief;
 *  - `surface` — render a `needsAnswers` blocker into an answerable sidecar;
 *  - `triage` — triage an untriaged observation.
 */
export type SelectionPool = 'build' | 'slice' | 'surface' | 'triage';

/** The orderable pools, in their canonical "drain" order (the default). */
export const SELECTION_POOLS: readonly SelectionPool[] = [
	'build',
	'slice',
	'surface',
	'triage',
];

/**
 * The recognized PRESET keywords, each sugar over an explicit pool-order list:
 *
 *  - `drain` (the DEFAULT) — drain ready work, then create, then ask:
 *    `[build, slice, surface, triage]`. Reproduces today's drain-first
 *    "drain before create" default (`build` before `slice`).
 *  - `groom` — ask/groom first, build later: `[surface, triage, build, slice]`.
 *
 * Kept deliberately SMALL (the minimize-head-space stance): a third preset earns
 * its place only when a real need appears.
 */
export const SELECTION_ORDER_PRESETS: Record<string, readonly SelectionPool[]> =
	{
		drain: ['build', 'slice', 'surface', 'triage'],
		groom: ['surface', 'triage', 'build', 'slice'],
	};

/** The default `selectionOrder` value when unset (the `drain` preset). */
export const DEFAULT_SELECTION_ORDER = 'drain';

/**
 * The config value a user writes for `selectionOrder`: a preset keyword (or a
 * single explicit pool name) as a STRING, or an explicit ordered LIST of pool
 * names (the env `'list'` coercion always yields the list form).
 */
export type SelectionOrderConfig = string | string[];

const POOL_SET = new Set<string>(SELECTION_POOLS);
const PRESET_NAMES = Object.keys(SELECTION_ORDER_PRESETS);

/**
 * Resolve a `selectionOrder` config value into the canonical ordered list of the
 * four orderable pools. A single recognized preset keyword expands to its list;
 * anything else is treated as an explicit pool-name list (each name validated).
 *
 * FAILS LOUDLY (throws) on:
 *  - an unknown SINGLE keyword (not a preset AND not a pool name);
 *  - an unknown pool name anywhere in an explicit list;
 *  - naming `apply` (it is pinned first, not orderable);
 *  - an empty order (no pools named);
 *  - a duplicate pool name in an explicit list.
 *
 * The list form is taken VERBATIM (no implicit padding of omitted pools — a list
 * names exactly the orderable pools the user wants, in order; an omitted pool is
 * simply ranked nowhere, which only matters if that pool is present, see the gate
 * orthogonality note in {@link selectPrioritised}).
 */
export function resolveSelectionOrder(
	value: SelectionOrderConfig,
): SelectionPool[] {
	// Normalise to a list of trimmed, non-empty tokens. A bare string is one token
	// (so `'drain'` and `['drain']` resolve identically — the env single-keyword
	// case); a list is its trimmed entries.
	const tokens = (typeof value === 'string' ? [value] : value)
		.map((t) => t.trim())
		.filter((t) => t !== '');

	// A SINGLE token that is a recognized preset keyword expands to its list. This
	// is the ONLY place a preset is honoured: a preset keyword mixed into a
	// multi-element list is NOT a pool name and so fails loudly below.
	if (tokens.length === 1 && tokens[0] in SELECTION_ORDER_PRESETS) {
		return [...SELECTION_ORDER_PRESETS[tokens[0]]];
	}

	if (tokens.length === 0) {
		throw new Error(
			`Invalid selectionOrder: empty. Expected a preset ` +
				`(${PRESET_NAMES.join(' / ')}) or an explicit pool-order list ` +
				`(${SELECTION_POOLS.join(', ')}).`,
		);
	}

	// Otherwise an EXPLICIT pool-name list: validate each name is a known orderable
	// pool, failing loudly on `apply` (pinned, not orderable) or any unknown name.
	const seen = new Set<string>();
	const order: SelectionPool[] = [];
	for (const token of tokens) {
		if (token === 'apply') {
			throw new Error(
				`Invalid selectionOrder: 'apply' is pinned FIRST and is not ` +
					`orderable — remove it. selectionOrder ranks only: ` +
					`${SELECTION_POOLS.join(', ')}.`,
			);
		}
		if (!POOL_SET.has(token)) {
			throw new Error(
				`Invalid selectionOrder: unknown pool '${token}'. Expected a preset ` +
					`(${PRESET_NAMES.join(' / ')}) or pool names from: ` +
					`${SELECTION_POOLS.join(', ')}.`,
			);
		}
		if (seen.has(token)) {
			throw new Error(`Invalid selectionOrder: duplicate pool '${token}'.`);
		}
		seen.add(token);
		order.push(token as SelectionPool);
	}
	return order;
}
