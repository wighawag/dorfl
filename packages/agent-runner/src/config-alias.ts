import type {PartialConfig} from './config.js';

/**
 * Deprecated config-key aliases and the legacy resolution surface they cover.
 *
 * A breaking config RENAME (e.g. `allowAgents` → `autoBuild`, the build member of
 * the symmetric `autoBuild`/`autoSlice`/`autoTriage` gate family) cannot just
 * drop the old name: an upgrade must not break a repo's committed
 * `.agent-runner.json`, a CI job's `AGENT_RUNNER_*` env, or a human's muscle-
 * memory flag. So the OLD name keeps WORKING for a deprecation window, mapped to
 * the new key, with a one-line deprecation warning telling the user to migrate.
 *
 * This module is the SINGLE source of truth for that mapping so every layer
 * (global config file, per-repo file, env, CLI flag) deprecates the SAME old
 * names identically. When the window closes, deleting an entry here removes the
 * alias everywhere at once.
 */

/** One deprecated config-key alias: the old key, the new key it maps to. */
export interface ConfigKeyAlias {
	/** The retired key as it appears in a config FILE (camelCase). */
	readonly oldKey: string;
	/** The current key it maps onto. */
	readonly newKey: keyof PartialConfig;
}

/**
 * The active deprecated config-key aliases. Each old FILE key (camelCase) maps to
 * its current name. Empty once every window has closed.
 *
 * `allowAgents` → `autoBuild`: the build-gate rename (PRD `advance-loop` US #36)
 * that made the per-action gate family symmetric. `allowAgents` read like a
 * master ("may agents act at all?") but only ever gated the BUILD selection — a
 * naming trap beside `autoSlice`/`autoTriage`.
 */
export const CONFIG_KEY_ALIASES: readonly ConfigKeyAlias[] = [
	{oldKey: 'allowAgents', newKey: 'autoBuild'},
];

/**
 * The deprecation message for one alias, naming the SOURCE so the user knows
 * which file/env/flag to migrate. Stable wording so callers can match it in
 * tests.
 */
export function aliasDeprecationMessage(
	alias: ConfigKeyAlias,
	source: string,
): string {
	return (
		`Deprecated config key '${alias.oldKey}' (${source}) is an alias for ` +
		`'${alias.newKey}'; it still works for now but will be removed. ` +
		`Rename it to '${alias.newKey}'.`
	);
}

/**
 * Rewrite any DEPRECATED old key in an already-parsed config object to its
 * current name, IN PLACE, emitting a deprecation `warn` (naming `source`) per
 * alias actually present. The new key WINS if both are present (a half-migrated
 * file should not silently revert), and the old key is deleted so it never leaks
 * past this point. Returns the SAME object for convenience.
 *
 * Applied wherever a config object is parsed from bytes a user wrote — the global
 * config file ({@link loadConfig}) and the per-repo `.agent-runner.json`
 * ({@link loadRepoConfigFromContent}) — so a committed config keeps resolving
 * across the rename. Env + CLI flags handle their own legacy surface (different
 * key shapes) but reuse {@link aliasDeprecationMessage} for identical wording.
 */
export function applyConfigKeyAliases(
	parsed: Record<string, unknown>,
	options: {source: string; warn?: (message: string) => void},
): Record<string, unknown> {
	const {source, warn} = options;
	for (const alias of CONFIG_KEY_ALIASES) {
		if (!(alias.oldKey in parsed)) {
			continue;
		}
		const legacyValue = parsed[alias.oldKey];
		delete parsed[alias.oldKey];
		warn?.(aliasDeprecationMessage(alias, source));
		// The new key WINS if both were present (a half-migrated file must not
		// silently revert to the old value); otherwise the old value carries over.
		if (!(alias.newKey in parsed) && legacyValue !== undefined) {
			parsed[alias.newKey] = legacyValue;
		}
	}
	return parsed;
}
