import {existsSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {
	workFolderName,
	workFolderPath,
	type WorkFolderKey,
} from './work-layout.js';

/**
 * The **co-located task/spec sidecar GUARD** (WORK-CONTRACT.md rule 8, the
 * `notes/*`-only scoping).
 *
 * WHAT IT ENFORCES. A `<slug>/` asset sidecar folder co-located with a work item
 * is ALLOWED for `notes/*` ONLY (`ideas`/`observations`/`findings` — they do NOT
 * flow; a note leaves by deletion, so its sidecar never moves). It is FORBIDDEN
 * for a `tasks/*` or `specs/*` item, because those regimes FLOW through status
 * folders (`tasks/ready → tasks/done`, `specs/ready → specs/tasked`, …): a
 * co-located sidecar shares the item's lifecycle and must be `git mv`'d in
 * lockstep on every transition, and in practice gets STRANDED — the `<slug>.md`
 * moves to the new status folder while the `<slug>/` sidecar is left behind in
 * the old one, splitting ONE item across TWO status folders (a
 * one-slug-one-folder violation, the SAME invariant `ledger-lint.ts` reads and
 * the integration core enforces). A task's/spec's durable companion artifacts
 * belong in the STABLE, non-flowing `docs/spikes/<slug>/` home (referenced by
 * path from the `<slug>.md`), NOT a co-located sidecar.
 *
 * WHERE IT RUNS. This is the DETECTOR half; the integration core (`integration-core.ts`)
 * wires it as a HARD BLOCK at LAND, BEFORE the durable `git mv` — a detected
 * sidecar routes the item to needs-attention with {@link formatSidecarGuardReason},
 * consistent with the status=folder / one-item-one-location contract the stranding
 * violates. Fix = `git mv` the sidecar contents to `docs/spikes/<slug>/` + a
 * reference edit in the `<slug>.md`.
 *
 * NO FALSE POSITIVES on: (a) the `work/questions/<type>-<slug>.md` needs-attention
 * file — it is a tooling-owned STATUS-MECHANISM file, NOT scanned here (only
 * `tasks/*` + `specs/*` FLOWING folders are); (b) a legitimate `notes/*` sidecar —
 * the note buckets are deliberately EXCLUDED from the scan set; (c) a
 * `docs/spikes/<slug>/` outside `work/` — this only ever looks INSIDE the FLOWING
 * `work/` status folders.
 */

/**
 * The FLOWING status folders a `tasks/*` / `specs/*` item moves through — the ONLY
 * folders scanned for an illegal co-located sidecar. Deliberately EXCLUDES the
 * `notes/*` capture buckets (`ideas`/`observations`/`findings`, which legitimately
 * MAY carry a sidecar) and the top-level `questions`/`protocol` surfaces (neither
 * holds a flowing work item). A sidecar under any of THESE is a rule-8 violation
 * because the item it sits beside will be `git mv`'d to another status folder and
 * strand it.
 */
export const SIDECAR_GUARD_FLOWING_FOLDERS = [
	'tasks-backlog',
	'tasks-ready',
	'done',
	'cancelled',
	'specs-proposed',
	'specs-ready',
	'specs-tasked',
	'specs-dropped',
] as const satisfies readonly WorkFolderKey[];

/** One illegal co-located `<slug>/` sidecar found beside a flowing task/spec item. */
export interface ColocatedSidecar {
	/** The flowing status folder the sidecar was found in. */
	folder: WorkFolderKey;
	/** The slug of the offending `<slug>/` sidecar directory. */
	slug: string;
	/** The repo-relative path of the sidecar directory (`work/<folder>/<slug>/`). */
	dirRel: string;
}

/** Does `<dir>/<name>` exist AND is it a directory? (a sidecar is a folder). */
function isDir(dir: string, name: string): boolean {
	try {
		return statSync(join(dir, name)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Detect a co-located `<slug>/` asset sidecar directory sitting beside the
 * `<slug>.md` of a FLOWING task/spec item, in the given `cwd`'s working tree.
 * Scans ONLY {@link SIDECAR_GUARD_FLOWING_FOLDERS} for a `<slug>/` DIRECTORY whose
 * sibling `<slug>.md` FILE is present (both must be there: a lone `<slug>/`
 * directory with no item file is not this item's sidecar). Returns every offender
 * found (typically at most one, for the item being landed), or `[]` when clean.
 *
 * PURE-ish: reads the filesystem, no writes, no throws. The integration core
 * passes the specific `slug` being landed so the block is scoped to THAT item.
 */
export function detectColocatedSidecars(
	cwd: string,
	slug: string,
): ColocatedSidecar[] {
	const found: ColocatedSidecar[] = [];
	for (const folder of SIDECAR_GUARD_FLOWING_FOLDERS) {
		const dir = workFolderPath(cwd, folder);
		// The item file `<slug>.md` AND the sidecar dir `<slug>/` must BOTH be
		// present for this to be the item's stranded-able sidecar. A stray `<slug>/`
		// with no `<slug>.md` in the same folder is not an item's sidecar.
		if (!existsSync(join(dir, `${slug}.md`))) {
			continue;
		}
		if (isDir(dir, slug)) {
			found.push({
				folder,
				slug,
				dirRel: `work/${workFolderName(folder)}/${slug}/`,
			});
		}
	}
	return found;
}

/**
 * Format the ACTIONABLE needs-attention reason for a detected co-located sidecar
 * (the message the LAND-time hard block surfaces VERBATIM). Names the offending
 * path, the correct destination, and the exact fix — a `git mv` to
 * `docs/spikes/<slug>/` plus a reference edit.
 */
export function formatSidecarGuardReason(
	sidecars: readonly ColocatedSidecar[],
): string {
	if (sidecars.length === 0) {
		return '';
	}
	const lines = [
		'task/spec artifacts belong in docs/spikes/<slug>/, not a co-located ' +
			'work/tasks|specs/<slug>/ sidecar; only notes/* may carry a sidecar ' +
			'(WORK-CONTRACT rule 8) — relocate + reference by path:',
	];
	for (const s of sidecars) {
		lines.push(
			`  - ${s.dirRel}: git mv its contents to docs/spikes/${s.slug}/ ` +
				`(a STABLE, non-flowing home), then reference them by that path from ` +
				`work/${workFolderName(s.folder)}/${s.slug}.md (a flowing item's ` +
				`co-located sidecar strands on the ready→done move).`,
		);
	}
	return lines.join('\n');
}
