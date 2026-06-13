import type {Config, IntegrationMode, PartialConfig} from './config.js';

/**
 * The CLI flags that select WHICH agent runs and HOW it is launched — shared,
 * verbatim, by `run` and `do`. Both commands offer `--harness`/`--agent-cmd`/
 * `--pi-bin`/`--model`; this is the single place their string→`PartialConfig`
 * mapping lives so there is exactly ONE override path (not a parallel one per
 * command). `cli.ts`'s `runFlagOverrides` and {@link doFlagOverrides} both fold
 * this in.
 */
export interface HarnessFlags {
	agentCmd?: string;
	model?: string;
	harness?: string;
	piBin?: string;
	/**
	 * The HOST-ONLY root folder under which a job's pi session FILE is generated
	 * (`--sessions-dir`). Forwarded verbatim like `piBin`; the path generator turns
	 * it into `<sessionsDir>/<unique-id>.jsonl` at launch (unset ⇒ pi's per-cwd
	 * default folder).
	 */
	sessionsDir?: string;
}

/**
 * Map the shared harness/adapter flags into a {@link PartialConfig} of overrides
 * — the per-key mapping `run` and `do` both reuse. Only flags actually present
 * contribute (absent flag ⇒ absent key), so the override layer never clobbers a
 * lower precedence source with `undefined`. `--harness` is validated against the
 * `HarnessAdapter` union (an out-of-range value is dropped, matching `run`).
 */
export function harnessFlagOverrides(flags: HarnessFlags): PartialConfig {
	const overrides: PartialConfig = {};
	if (flags.agentCmd !== undefined) {
		overrides.agentCmd = flags.agentCmd;
	}
	if (flags.model !== undefined) {
		overrides.model = flags.model;
	}
	if (flags.harness === 'null' || flags.harness === 'pi') {
		overrides.harness = flags.harness;
	}
	if (flags.piBin !== undefined) {
		overrides.piBin = flags.piBin;
	}
	if (flags.sessionsDir !== undefined) {
		overrides.sessionsDir = flags.sessionsDir;
	}
	return overrides;
}

/**
 * Build the flag-override `PartialConfig` for the `do` command. This is the FIX
 * for the silent-drop bug: `do` DECLARES `--harness`/`--agent-cmd`/`--pi-bin`/
 * `--model`, so its action MUST thread them into `resolveRepoConfig`'s `flags`
 * — not just `{integration}`. It reuses the SAME per-key mapping `run` uses
 * ({@link harnessFlagOverrides}), then folds in the integrate-time mode (the
 * already-resolved `--merge`/`--propose`, via `integrationFromFlags`) so the
 * full set rides the same precedence chain (flag > env > per-repo > global >
 * default).
 */
export function doFlagOverrides(
	flags: HarnessFlags & ReviewFlags & SlicerLoopFlags & SelectionOrderFlags,
	integration?: IntegrationMode,
): PartialConfig {
	const overrides = {
		...harnessFlagOverrides(flags),
		// `--selection-order <order>` rides the SAME flag-override chain (flag > env >
		// per-repo > global > default): a comma-separated value becomes a list (an
		// explicit pool order), otherwise the verbatim string (a preset keyword). The
		// resolver (`select-order.ts`) validates/expands it at selection time.
		...selectionOrderFlagOverrides(flags),
		// Gate 2 (PR/code review) flags ride the SAME flag-override path so
		// `--review`/`--auto-merge`/`--review-model`/`--review-max-rounds` resolve
		// flag > env > per-repo > global > default, exactly like the harness flags.
		...reviewFlagOverrides(flags),
		// The slicer IMPROVER-loop family (`--slicer-loop`/`--no-slicer-loop`/
		// `--slicer-loop-max`/`--slicer-loop-model`) rides the same chain — a DISTINCT
		// family from the gate's `--review*`, never sharing a flag/key/field name.
		...slicerLoopFlagOverrides(flags),
	};
	if (integration !== undefined) {
		overrides.integration = integration;
	}
	return overrides;
}

/**
 * The Gate-2 (PR/code review) CLI flags, offered by `do` AND `complete`
 * (`--review`/`--no-review`, `--auto-merge`/`--no-auto-merge`,
 * `--review-model`, `--review-max-rounds`). Both commands resolve them through
 * the SAME `flag > env > per-repo > global > default` chain as `integration`, so
 * the mapping lives in ONE place (not a parallel copy per command).
 */
export interface ReviewFlags {
	/** `--review` ⇒ true, `--no-review` ⇒ false, absent ⇒ undefined. */
	review?: boolean;
	/** `--auto-merge` ⇒ true, `--no-auto-merge` ⇒ false, absent ⇒ undefined. */
	autoMerge?: boolean;
	/** `--review-model <id>` — the de-correlated review model (routing intent). */
	reviewModel?: string;
	/** `--review-max-rounds <n>` — the revise↔review loop bound (parsed to a number). */
	reviewMaxRounds?: string;
}

/**
 * The slicer IMPROVER-loop CLI flags (`do` only): `--slicer-loop` /
 * `--no-slicer-loop` (the on/off toggle), `--slicer-loop-max <n>` (the in-context
 * convergence cap), and `--slicer-loop-model <id>` (the loop reviewer's
 * de-correlated model). A DISTINCT family from the acceptance gate's `--review*`
 * (see {@link ReviewFlags}) — no flag/key/field name spans both. Resolved through
 * the SAME `flag > env > per-repo > global > default` chain.
 */
export interface SlicerLoopFlags {
	/** `--slicer-loop` ⇒ true, `--no-slicer-loop` ⇒ false, absent ⇒ undefined. */
	slicerLoop?: boolean;
	/** `--slicer-loop-max <n>` — the loop's in-context convergence cap (parsed to a number). */
	slicerLoopMax?: string;
	/** `--slicer-loop-model <id>` — the loop reviewer's de-correlated model (routing intent). */
	slicerLoopModel?: string;
}

/**
 * Map the Gate-2 review flags into a {@link PartialConfig} of overrides — the
 * per-key mapping `do` and `complete` both reuse. Only flags actually present
 * contribute (absent flag ⇒ absent key), so the override layer never clobbers a
 * lower-precedence source with `undefined`. `--review-max-rounds` is parsed to a
 * number; a non-numeric value is dropped (the lower layer / default decides).
 */
export function reviewFlagOverrides(flags: ReviewFlags): PartialConfig {
	const overrides: PartialConfig = {};
	if (flags.review !== undefined) {
		overrides.review = flags.review;
	}
	if (flags.autoMerge !== undefined) {
		overrides.autoMerge = flags.autoMerge;
	}
	if (flags.reviewModel !== undefined) {
		overrides.reviewModel = flags.reviewModel;
	}
	if (flags.reviewMaxRounds !== undefined) {
		const n = Number(flags.reviewMaxRounds);
		if (flags.reviewMaxRounds.trim() !== '' && !Number.isNaN(n)) {
			overrides.reviewMaxRounds = n;
		}
	}
	return overrides;
}

/**
 * Map the slicer IMPROVER-loop flags into a {@link PartialConfig} of overrides.
 * Only flags actually present contribute (absent flag ⇒ absent key), so the
 * override layer never clobbers a lower-precedence source with `undefined`.
 * `--slicer-loop-max` is parsed to a number; a non-numeric value is dropped (the
 * lower layer / default decides). A DISTINCT family from {@link reviewFlagOverrides}.
 */
export function slicerLoopFlagOverrides(flags: SlicerLoopFlags): PartialConfig {
	const overrides: PartialConfig = {};
	if (flags.slicerLoop !== undefined) {
		overrides.slicerLoop = flags.slicerLoop;
	}
	if (flags.slicerLoopMax !== undefined) {
		const n = Number(flags.slicerLoopMax);
		if (flags.slicerLoopMax.trim() !== '' && !Number.isNaN(n)) {
			overrides.slicerLoopMax = n;
		}
	}
	if (flags.slicerLoopModel !== undefined) {
		overrides.slicerLoopModel = flags.slicerLoopModel;
	}
	return overrides;
}

/**
 * The selection-order CLI flag (`do` AND `advance`): `--selection-order <order>`
 * (a preset keyword like `drain`/`groom`, or a comma-separated explicit pool
 * order like `build,slice,surface,triage`). Resolved through the SAME
 * `flag > env > per-repo > global > default` chain as the other `do` flags.
 */
export interface SelectionOrderFlags {
	/** `--selection-order <order>` — a preset keyword or comma-separated pool list. */
	selectionOrder?: string;
}

/**
 * Map the `--selection-order` flag into a {@link PartialConfig} override. Only a
 * present flag contributes (absent ⇒ absent key). A value CONTAINING a comma is
 * parsed into a trimmed, non-empty list (an explicit pool order, mirroring the
 * env `'list'` coercion); otherwise it is the verbatim string (a preset keyword
 * or a single pool name). The resolver (`select-order.ts`) does the
 * validation/expansion + loud failure at selection time — this only normalises
 * the flag's surface syntax.
 */
export function selectionOrderFlagOverrides(
	flags: SelectionOrderFlags,
): PartialConfig {
	const overrides: PartialConfig = {};
	if (flags.selectionOrder !== undefined) {
		const raw = flags.selectionOrder;
		overrides.selectionOrder = raw.includes(',')
			? raw
					.split(',')
					.map((s) => s.trim())
					.filter((s) => s !== '')
			: raw;
	}
	return overrides;
}

/**
 * The null-default guard: the `null` adapter shells out to `agentCmd`, so it is
 * required there; the `pi` adapter invokes the pi CLI directly and does not
 * consume `agentCmd`. Returns `true` when the resolved config selects the null
 * adapter with no `agentCmd` — the case `do`/`run`/`--remote` must reject with a
 * clear error ({@link NO_AGENT_CMD_MESSAGE}). All three CLI sites call THIS one
 * predicate (named here so the fix's no-regression test can pin it).
 */
export function doNeedsAgentCmd(config: Config): boolean {
	return config.harness !== 'pi' && config.agentCmd.trim() === '';
}

/**
 * The shared up-front message for the {@link doNeedsAgentCmd} refusal. Names BOTH
 * escape hatches: the `--harness pi` adapter (which needs no agentCmd) and
 * setting `harness`/`agentCmd` in config. Shared so `do`/`run`/`--remote` speak
 * with one voice (and the test that pins `--harness pi` only has to pin it once).
 */
export const NO_AGENT_CMD_MESSAGE =
	'no harness configured and no agentCmd set — nothing would run. Pass ' +
	'--harness pi (or set harness/agentCmd in .agent-runner.json or global config).';
