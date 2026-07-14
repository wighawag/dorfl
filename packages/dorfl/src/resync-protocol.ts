import {
	existsSync,
	readFileSync,
	writeFileSync,
	copyFileSync,
	mkdirSync,
} from 'node:fs';
import {join, relative, dirname} from 'node:path';
import {resolveProtocolDoc} from './prompt.js';
import {WORK_ROOT} from './work-layout.js';

/**
 * The **protocol re-sync** primitive: copy the package's canonical
 * `work/protocol/*` docs into a target repo's `work/protocol/` and bump
 * `work/protocol/VERSION`. This is the deterministic slice of what the `setup`
 * skill does — the SINGLE source of truth for "make this repo carry the current
 * protocol contract".
 *
 * Two verbs drive it:
 *   - `dorfl sync` — the standalone "get the latest protocol" command (a repo
 *     that adopted an OLD protocol picks up the new docs in one command);
 *   - `dorfl prd-to-spec` — the vocabulary-migration engine, which re-syncs the
 *     contract FIRST (before converting the repo's data) so the migrated repo
 *     lands on the new `spec` contract.
 *
 * It was lifted out of `prd-to-spec.ts` (where it began life) into this shared
 * module so both verbs import ONE implementation; `prd-to-spec.ts` re-exports
 * the symbols for backward compatibility.
 */

/**
 * The FULL set of protocol docs `setup` propagates into a repo's
 * `work/protocol/`. The re-sync copies EACH from the package's canonical source
 * (via {@link resolveProtocolDoc}) so a set-up repo carries the current
 * contract. Kept in lockstep with `skills/setup/protocol/` (the source of truth)
 * and the `vendor-protocol` build step (which vendors these into `dist/protocol/`
 * so the published CLI is self-contained).
 */
export const PROTOCOL_DOCS: readonly string[] = [
	'WORK-CONTRACT.md',
	'CLAIM-PROTOCOL.md',
	'REVIEW-PROTOCOL.md',
	'SURFACE-PROTOCOL.md',
	'TASKING-PROTOCOL.md',
	'ADR-FORMAT.md',
	'task-template.md',
	'spec-template.md',
];

/** One protocol doc the re-sync copied (or WOULD copy under `--dry-run`). */
export interface ResyncedDoc {
	/** The doc basename (e.g. `'WORK-CONTRACT.md'`). */
	name: string;
	/** Repo-relative destination (`work/protocol/<name>`). */
	dest: string;
	/** True when the target already had byte-identical content (a no-op copy). */
	unchanged: boolean;
	/**
	 * True when the doc's SOURCE could not be resolved (the package/dev copy is
	 * missing), so NOTHING was copied to `dest`. A skipped doc is NEVER counted as
	 * a change (it must not bump `VERSION` — the latent bug this field guards) and
	 * is surfaced LOUDLY by the caller. Distinct from `unchanged` (which means the
	 * source WAS resolved and matched the dest byte-for-byte).
	 */
	skipped: boolean;
}

/** What the protocol re-sync did (or would do). */
export interface ResyncResult {
	docs: ResyncedDoc[];
	/** Repo-relative `work/protocol/VERSION` path (written unless dry-run). */
	versionPath: string;
}

/**
 * Re-sync the target repo's `work/protocol/*` from the package's canonical
 * source (the deterministic part of the `setup` skill — copy the docs verbatim +
 * bump `VERSION`). Resolves each doc's SOURCE via {@link resolveProtocolDoc} with
 * NO `cwd`, so it reads the package-vendored (`dist/protocol/`) or dev-source
 * (`skills/setup/protocol/`) copy — NEVER the target repo's own (old) copy. This
 * is how a repo picks up the current contract. Idempotent: a doc already
 * byte-identical is reported `unchanged`. A doc whose SOURCE cannot be resolved
 * is reported `skipped` (NOT copied, NEVER a VERSION-bump) rather than silently
 * bumping VERSION with nothing copied.
 *
 * `dryRun` reports what WOULD be copied without writing. `resolveDoc` overrides
 * how a doc's source path is resolved (defaults to {@link resolveProtocolDoc});
 * it exists so a test can force a non-resolvable source (a path that does not
 * exist) to exercise the skip path. `sourceCommit` is stamped into the written
 * `VERSION` provenance line so a reader can tell which verb wrote it.
 */
export function resyncProtocol(
	repoPath: string,
	options: {
		dryRun?: boolean;
		resolveDoc?: (name: string) => string;
		sourceCommit?: string;
	} = {},
): ResyncResult {
	const protocolDir = join(repoPath, WORK_ROOT, 'protocol');
	const resolveDoc = options.resolveDoc ?? ((name) => resolveProtocolDoc(name));
	const docs: ResyncedDoc[] = [];
	for (const name of PROTOCOL_DOCS) {
		// Resolve the SOURCE (package/dev), never the target's adopted copy.
		const source = resolveDoc(name);
		const destAbs = join(protocolDir, name);
		const destRel = relative(repoPath, destAbs);
		const sourceExists = existsSync(source);
		if (!sourceExists) {
			// The source doc could not be resolved: copy NOTHING and record the doc as
			// SKIPPED (never a change). This is the latent-bug fix: a non-resolvable
			// source must not count as `changed` and bump `VERSION` while copying no
			// file. `unchanged: false` here is honest (the dest was not made to match a
			// source), but `skipped: true` keeps it OUT of the VERSION-bump tally.
			docs.push({name, dest: destRel, unchanged: false, skipped: true});
			continue;
		}
		// Source resolved: a doc is CHANGED (VERSION-bump-worthy) only when the dest
		// is absent OR its content differs from the source. An identical dest is a
		// no-op copy (`unchanged`), so an already-synced re-run stays a true no-op.
		const unchanged =
			existsSync(destAbs) &&
			readFileSync(source, 'utf8') === readFileSync(destAbs, 'utf8');
		if (!options.dryRun) {
			mkdirSync(dirname(destAbs), {recursive: true});
			copyFileSync(source, destAbs);
		}
		docs.push({name, dest: destRel, unchanged, skipped: false});
	}

	const versionAbs = join(protocolDir, 'VERSION');
	const versionRel = relative(repoPath, versionAbs);
	// Bump VERSION only when a doc was ACTUALLY COPIED with new content, or when
	// VERSION is absent AND at least one doc was genuinely synced (copied). A
	// SKIPPED doc (unresolvable source, nothing copied) is NEVER a change —
	// counting it would bump VERSION without copying a single doc (the latent bug),
	// and the write-when-absent fallback must ALSO require a real copy so an
	// all-skipped resync leaves no VERSION behind. A re-run on an already-synced
	// repo must stay a true no-op — otherwise the (always-fresh) `synced-at`
	// timestamp would dirty the tree on every idempotent re-run.
	const anyDocChanged = docs.some((d) => !d.unchanged && !d.skipped);
	const anyDocSynced = docs.some((d) => !d.skipped);
	if (
		!options.dryRun &&
		(anyDocChanged || (anyDocSynced && !existsSync(versionAbs)))
	) {
		mkdirSync(dirname(versionAbs), {recursive: true});
		const today = new Date().toISOString().slice(0, 10);
		writeFileSync(
			versionAbs,
			[
				`protocol-version: ${today}`,
				'synced-from: skills/setup/protocol/',
				`synced-at: ${new Date().toISOString()}`,
				`source-commit: ${options.sourceCommit ?? 'dorfl sync'}`,
				'',
			].join('\n'),
		);
	}

	return {docs, versionPath: versionRel};
}
