import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {workItemRel} from './work-layout.js';
import {resolveSidecarIdentity, type SidecarType} from './sidecar.js';
import type {WorkFolderKey} from './work-layout.js';

/**
 * The NEUTRAL identity-keyed item-path resolver (task
 * `agentic-apply-retire-disposition-vocabulary`) — extracted OUT of the hot
 * `apply-persist.ts` so it is a STABLE, OWNED seam re-exported from the package
 * index. The apply rung imports it from here; the sibling CLI verb
 * (`direct-delete-question-cli-helper`) and the orphan-sidecar gc sweep
 * (`orphan-sidecar-gc-sweep`) reuse the SAME resolver WITHOUT importing the
 * rewritten hot file (the file-orthogonality fix: keeping it in `apply-persist.ts`
 * would force those tasks into a stale-read coupling on a file this task rewrites).
 *
 * It is the symmetric twin of `sidecarPathFor`: where the sidecar path is derived
 * from `(type, slug)`, the item path is RESOLVED by scanning the lifecycle folders
 * the type may rest in (the identity is the source of truth; the folder is not).
 */

/**
 * The lifecycle folders an item may rest in at APPLY-write-time, BY TYPE — the
 * scan set for {@link resolveItemPathByIdentity}. Includes the STAGING folders
 * (`tasks-backlog`, `prds-proposed`) on purpose: a concurrent `promote` may have
 * just `git mv`'d the item from staging into the pool between an apply's CAPTURE
 * and WRITE, and the apply must resolve to the post-move path — the whole point of
 * folder-agnostic apply (F3a of prd `staging-surface-and-apply-promote-safety`).
 * Terminal-only folders (`cancelled`, `prds-dropped`, `needs-attention`) are NOT
 * here — once an item has reached a terminal, the apply is OVER, and a re-resolve
 * into a terminal would mean the item has effectively vanished from the active
 * lifecycle (callers handle that as the clean-exit `vanished` outcome).
 */
export const APPLY_LIFECYCLE_FOLDERS: Record<
	SidecarType,
	readonly WorkFolderKey[]
> = {
	task: ['tasks-backlog', 'tasks-ready', 'in-progress', 'done'],
	// `spec` rests in the parent-spec regime folders (a `spec:<slug>` identity
	// resolves against these).
	spec: ['specs-proposed', 'specs-ready', 'specs-tasked'],
	observation: ['observations'],
};

/**
 * Resolve the item's CURRENT on-disk path by IDENTITY — the apply-side
 * folder-agnostic resolver, the symmetric twin of `sidecarPathFor`. Mirrors the
 * sidecar's identity-keyed resolution shape: the path is derived from the
 * `(type, slug)` identity at WRITE-TIME, never from a captured `ItemPath`.
 *
 * Scans the lifecycle folders the type may rest in ({@link APPLY_LIFECYCLE_FOLDERS}),
 * including STAGING, and returns the FIRST match (one slug per type, so there is at
 * most one). Returns `undefined` when the item file is GONE between capture and
 * write (a concurrent `promote` to a terminal, a human delete, or a sibling triage
 * move) — the apply rung then exits CLEAN (no commit, no ghost file), routed as the
 * `vanished` outcome.
 *
 * This is the F3a fix from prd `staging-surface-and-apply-promote-safety`: the
 * sidecar is already identity-keyed and folder-agnostic; the item path is now the
 * same. A concurrent `promote` that `git mv`'d the item out from under a captured
 * path can no longer cause a stale-path write.
 */
export function resolveItemPathByIdentity(
	cwd: string,
	item: string,
): string | undefined {
	const {type, slug} = resolveSidecarIdentity(item);
	for (const folder of APPLY_LIFECYCLE_FOLDERS[type]) {
		const rel = workItemRel(folder, `${slug}.md`);
		if (existsSync(join(cwd, rel))) {
			return rel;
		}
	}
	return undefined;
}
