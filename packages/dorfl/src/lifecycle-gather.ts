import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';
import {
	parseSidecar,
	sidecarPathCandidates,
	type SidecarModel,
} from './sidecar.js';
import {runAsync} from './git.js';
import {
	buildLifecyclePools,
	type LifecyclePoolGates,
	type NeedsAnswersCandidate,
	type ObservationCandidate,
} from './lifecycle-pools.js';
import type {SelectedLifecyclePools} from './select-priority.js';

/**
 * The per-substrate I/O that FEEDS the shared, pure {@link buildLifecyclePools}
 * enumeration (task `advance-autopick-lifecycle-pools`). The ENUMERATION LOGIC
 * (which item becomes triage / surface / apply, the gates, the four-pool order)
 * lives in ONE place ({@link buildLifecyclePools} + {@link selectPrioritised}); this
 * module only reads the inputs that logic needs from each substrate:
 *
 *   - IN-PLACE (sync, a working checkout) \u2014 {@link gatherLifecycleInPlace}: reads
 *     `work/notes/observations/` + the per-item `work/questions/<type>-<slug>.md` sidecar
 *     through the read seam + the filesystem, exactly as the in-place build-pool
 *     scan + `readItemSignals` already read in-place.
 *   - MIRROR-SIDE (async, a bare hub mirror's committed `main`) \u2014
 *     {@link gatherLifecycleMirror}: reads the SAME logical inputs from the mirror's
 *     committed tree via `git show` (the sidecar) + the read seam's
 *     `resolveMirrorState` (observations + the `needsAnswers` pool), so the
 *     two substrates AGREE.
 *
 * Both then call the SAME {@link buildLifecyclePools} \u2014 so the in-place and
 * mirror-side enumerations are ONE unit, not two divergent ones. The gates default
 * BOTH OFF (the interim hardcoded-off; the gate tasks flip them on).
 */

/** A `needsAnswers:true` task/spec pulled from the live `work/` state (pre-sidecar). */
interface BlockedItem {
	namespace: 'task' | 'spec';
	slug: string;
}

/**
 * Read the ACTIVE sidecar for `<namespace>:<slug>` from a WORKING checkout (sync),
 * or `undefined` when none exists. Identity-keyed at `work/questions/<type>-<slug>.md`
 * \u2014 the SAME path `readItemSignals` reads in-place.
 */
function readSidecarInPlace(
	repoPath: string,
	namespace: 'task' | 'spec' | 'observation',
	slug: string,
): SidecarModel | undefined {
	// Probe every candidate path (spec-<slug>.md, then the legacy prd-<slug>.md the
	// migration command has not converted yet) and read the FIRST that exists.
	for (const rel of sidecarPathCandidates(`${namespace}:${slug}`)) {
		const abs = join(repoPath, rel);
		if (existsSync(abs)) {
			return parseSidecar(readFileSync(abs, 'utf8'));
		}
	}
	return undefined;
}

/**
 * Collect every `needsAnswers:true` task (from `work/backlog`) + spec (from
 * `work/specs`) for the in-place repo, through the read seam (the SAME readers the
 * build-pool scan uses). These are the SURFACE/APPLY candidates this task draws
 * into the selection (today they are build/task-INELIGIBLE, so nothing else
 * surfaces them).
 */
function blockedItemsInPlace(
	read: LedgerReadStrategy,
	repoPath: string,
	surfaceStaging: boolean,
): BlockedItem[] {
	const out: BlockedItem[] = [];
	const state = read.resolveLocalState({repoPath});
	for (const item of state.ready) {
		if (item.needsAnswers === true) {
			out.push({namespace: 'task', slug: item.slug});
		}
	}
	const pool = read.resolveSpecPool({repoPath});
	for (const spec of pool.specs) {
		if (spec.needsAnswers === true) {
			out.push({namespace: 'spec', slug: spec.slug});
		}
	}
	// TASKED resting prds (`specs/tasked/`) — enumerated UNCONDITIONALLY (NOT behind
	// `surfaceStaging`), because a spec may legitimately carry `needsAnswers:true`
	// while resting in `specs/tasked/` (WORK-CONTRACT "A SPEC that has drifted AFTER
	// it was TASKED"). This is NOT a staging widening: a tasked spec is a durable
	// resting state, like the pool, so it is enumerated like the pool. Routing
	// still respects the gates in `buildLifecyclePools` (an ANSWERED sidecar -> the
	// always-on APPLY pool so the human's answer is never STRANDED; a NO-sidecar
	// tasked spec -> SURFACE, still gated by `surfaceBlockers`). Without this, a
	// tasked spec's answered sidecar is enumerated by no pool and apply never runs
	// on it (observation `tasked-prd-needsanswers-sidecar-stranded-no-apply-pool`).
	for (const spec of read.resolveLocalSpecTasked({repoPath})) {
		if (spec.needsAnswers === true) {
			out.push({namespace: 'spec', slug: spec.slug});
		}
	}
	// SURFACE-on-STAGING widening (spec
	// `staging-surface-and-apply-promote-safety` F2): when `surfaceStaging` is
	// ON, the candidate set ADDITIONALLY enumerates `needsAnswers` items resting
	// in STAGING (`tasks/backlog/` + `specs/proposed/`), so a tasked item
	// surfaces its questions BEFORE the human promotes it. BUILD/claim still
	// reads POOL-only (`scoreItems` over `state.ready`); only the surface polarity
	// widens here.
	if (surfaceStaging) {
		for (const item of read.resolveLocalTaskStaging({repoPath})) {
			if (item.needsAnswers === true) {
				out.push({namespace: 'task', slug: item.slug});
			}
		}
		for (const spec of read.resolveLocalSpecStaging({repoPath})) {
			if (spec.needsAnswers === true) {
				out.push({namespace: 'spec', slug: spec.slug});
			}
		}
	}
	return out;
}

/**
 * Gather + build the lifecycle pools for an IN-PLACE working checkout (sync).
 * Reads `work/notes/observations/` + the per-item sidecar state through the read seam +
 * the filesystem, then hands them to the shared {@link buildLifecyclePools}. The
 * gates default BOTH OFF (the interim hardcoded-off, calm by default).
 */
export function gatherLifecycleInPlace(input: {
	repoPath: string;
	read?: LedgerReadStrategy;
	gates?: LifecyclePoolGates;
}): SelectedLifecyclePools {
	const read = input.read ?? ledgerRead;
	const repoPath = input.repoPath;

	const rawObservations = read.resolveLocalState({repoPath}).observations;
	const observations: ObservationCandidate[] = rawObservations.map((obs) => ({
		slug: obs.slug,
		triaged: obs.triaged,
		sidecar: readSidecarInPlace(repoPath, 'observation', obs.slug),
	}));
	const surfaceStaging = input.gates?.surfaceStaging === true;
	const needsAnswers: NeedsAnswersCandidate[] = blockedItemsInPlace(
		read,
		repoPath,
		surfaceStaging,
	).map((item) => ({
		repoPath,
		namespace: item.namespace,
		slug: item.slug,
		sidecar: readSidecarInPlace(repoPath, item.namespace, item.slug),
	}));

	return buildLifecyclePools({
		repoPath,
		observations,
		needsAnswers,
		gates: input.gates,
	});
}

/**
 * Read the ACTIVE sidecar for `<namespace>:<slug>` from a BARE hub mirror's
 * committed `<ref>:work/questions/<type>-<slug>.md` via `git show` (the SAME
 * mechanism the mirror-ref ledger reads use), or `undefined` when none exists.
 */
async function readSidecarMirror(
	mirrorPath: string,
	ref: string,
	namespace: 'task' | 'spec' | 'observation',
	slug: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<SidecarModel | undefined> {
	// Probe every candidate committed path (spec-<slug>.md, then the legacy
	// prd-<slug>.md the migration command has not converted yet) via `git show`,
	// returning the FIRST that resolves.
	for (const rel of sidecarPathCandidates(`${namespace}:${slug}`)) {
		const object = `${ref}:${rel}`;
		const show = await runAsync('git', ['show', object], mirrorPath, {env});
		if (show.status === 0) {
			return parseSidecar(show.stdout);
		}
	}
	return undefined;
}

/**
 * Gather + build the lifecycle pools for a MIRROR-SIDE bare hub mirror (async).
 * Reads the SAME logical inputs as {@link gatherLifecycleInPlace} \u2014 observations +
 * the `needsAnswers` pool from the mirror's committed `main` (via
 * `resolveMirrorState`), the spec pool via `resolveMirrorSpecPool`, and each item's
 * sidecar via `git show` \u2014 then hands them to the SAME shared
 * {@link buildLifecyclePools}, so the in-place + mirror enumerations AGREE.
 */
export async function gatherLifecycleMirror(input: {
	mirrorPath: string;
	ref?: string;
	read?: LedgerReadStrategy;
	gates?: LifecyclePoolGates;
	env?: NodeJS.ProcessEnv;
}): Promise<SelectedLifecyclePools> {
	const read = input.read ?? ledgerRead;
	const mirrorPath = input.mirrorPath;
	const ref = input.ref ?? 'main';
	const env = input.env;

	const state = await read.resolveMirrorState({mirrorPath, ref, env});
	const specPool = await read.resolveMirrorSpecPool({mirrorPath, ref, env});
	const surfaceStaging = input.gates?.surfaceStaging === true;
	const [taskStaging, specStaging] = surfaceStaging
		? await Promise.all([
				read.resolveMirrorTaskStaging({mirrorPath, ref, env}),
				read.resolveMirrorSpecStaging({mirrorPath, ref, env}),
			])
		: [[], []];

	const blocked: BlockedItem[] = [];
	for (const item of state.ready) {
		if (item.needsAnswers === true) {
			blocked.push({namespace: 'task', slug: item.slug});
		}
	}
	for (const spec of specPool.specs) {
		if (spec.needsAnswers === true) {
			blocked.push({namespace: 'spec', slug: spec.slug});
		}
	}
	// TASKED resting prds (`<ref>:work/specs/tasked/`) — enumerated UNCONDITIONALLY,
	// the mirror-side counterpart of the in-place tasked-spec enumeration above
	// (so a `needsAnswers` tasked spec's answered sidecar is never stranded on the
	// mirror/CI advance path either). Routing still respects the gates.
	const specTasked = await read.resolveMirrorSpecTasked({mirrorPath, ref, env});
	for (const spec of specTasked) {
		if (spec.needsAnswers === true) {
			blocked.push({namespace: 'spec', slug: spec.slug});
		}
	}
	// SURFACE-on-STAGING widening (spec
	// `staging-surface-and-apply-promote-safety` F2): mirror-side counterpart of
	// the in-place widening above — enumerate `needsAnswers` items in
	// STAGING (`tasks/backlog/` + `specs/proposed/`) from the bare mirror's
	// committed `<ref>` tree, so the in-place + mirror surfaces AGREE. The
	// staging reads are skipped entirely when the gate is OFF (no extra git
	// ls-tree work in the legacy mode).
	for (const item of taskStaging) {
		if (item.needsAnswers === true) {
			blocked.push({namespace: 'task', slug: item.slug});
		}
	}
	for (const spec of specStaging) {
		if (spec.needsAnswers === true) {
			blocked.push({namespace: 'spec', slug: spec.slug});
		}
	}

	const needsAnswers: NeedsAnswersCandidate[] = await Promise.all(
		blocked.map(async (item) => ({
			repoPath: mirrorPath,
			namespace: item.namespace,
			slug: item.slug,
			sidecar: await readSidecarMirror(
				mirrorPath,
				ref,
				item.namespace,
				item.slug,
				env,
			),
		})),
	);

	const observations: ObservationCandidate[] = await Promise.all(
		state.observations.map(async (obs) => ({
			slug: obs.slug,
			triaged: obs.triaged,
			sidecar: await readSidecarMirror(
				mirrorPath,
				ref,
				'observation',
				obs.slug,
				env,
			),
		})),
	);

	return buildLifecyclePools({
		repoPath: mirrorPath,
		observations,
		needsAnswers,
		gates: input.gates,
	});
}
