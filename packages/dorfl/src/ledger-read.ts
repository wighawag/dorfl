import {readdirSync, readFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {parseFrontmatter} from './frontmatter.js';
import {runAsync, type RunResult} from './git.js';
import {
	type WorkFolderKey,
	type SpecFolder,
	workFolderPath,
	workFolderRel,
	isWorkItemFile,
} from './work-layout.js';

/**
 * The **read half** of the ledger-transition seam (ADR
 * `docs/adr/claim-ledger-vs-protected-main.md`, status: accepted — the "Read
 * seam"). ONE entry point — "resolve the live `work/` state for a repo" — that
 * every reader goes through, so a FUTURE strategy could resolve some states from
 * elsewhere (e.g. work-branch tips, a dedicated ledger ref) without each reader
 * (`scan`, eligibility's data, readiness, the claim CAS) learning a new
 * mechanism.
 *
 * It is a PURE REFACTOR: there is exactly ONE strategy ({@link currentLedgerRead})
 * and it does EXACTLY what the code did before — the local method reads the
 * working tree (offline, cross-repo); the arbiter method reads `<arbiter>/main`
 * via `git show`/`ls-tree`. No mode, no config, no `ledgerMode`, no new ref, no
 * new network read.
 *
 * The seam is honest about the real read sources rather than pretending they are
 * one (per the ADR — do not collapse them):
 *
 *   - **local working tree** — a working clone reads `work/tasks/ready|tasks/done`
 *     from its checkout (pool = `tasks/ready`; staging = `tasks/backlog`, surfaced
 *     elsewhere). OFFLINE. (Pre-registry `scan`/`status` used this; `run`'s in-place
 *     checkouts still do.)
 *   - **arbiter `main`** — the human claim guard (`readiness`) and the claim CAS
 *     read the task + `work/done/` from `<arbiter>/main`.
 *   - **hub mirror `main`** — `scan`/`status` (registry model, ADR §1) read the
 *     full `work/` lifecycle from each BARE hub mirror's `main` ref. A mirror has
 *     no working tree, so this reads the committed tree via `git ls-tree`/`git
 *     show` (the SAME mechanism the arbiter `done/` read uses, widened to the
 *     full backlog set). This read itself is offline; the
 *     fetch-first contract (ADR §5/§6 — the old "scan is always offline" invariant
 *     is retired) lives ONE layer up in `scan`/`status`, which refresh the
 *     mirror's `main` before calling this method. The read STRATEGY here is
 *     unchanged either way.
 *
 * The signatures stay at the SEMANTIC level ("resolve live state") and storage-
 * agnostic: the ONLY public distinction is local-vs-arbiter (no `main`/path is
 * baked into the public shape beyond that). `gc` is NOT a consumer — its `work/`
 * reads are job-WORKTREE discovery under `<workspacesDir>/work/*` (the execution
 * substrate), not the `work/` lifecycle ledger this seam resolves, so it has no
 * applicable read to route here.
 */

/**
 * One agent-POOL task's parsed gate/deps, as resolved from the live `work/`
 * state. The pool lives in `work/tasks/ready/` in the new layout (staging is
 * `work/tasks/backlog/`); the type name follows the pool noun (`ready`) so a
 * later reader cannot misread `backlog` as the pool.
 */
export interface LedgerReadyItem {
	/** Filename within `work/tasks/ready/` (e.g. `scan.md`). */
	file: string;
	/** Resolved slug (frontmatter `slug:`, falling back to the filename). */
	slug: string;
	/** Autonomy axis 1 (DECIDED): `true` (human-only) | `undefined` (undeclared). */
	humanOnly: boolean | undefined;
	/** Autonomy axis 2 (DISCOVERED): `true` (open questions) | `undefined`. */
	needsAnswers: boolean | undefined;
	/** Slugs this item is blocked by. */
	blockedBy: string[];
}

/**
 * The result of a spec-existence read (ADR §3a): does a spec named `<slug>` exist,
 * and where. A spec lives at `work/specs/ready/<slug>.md`; once TASKED it rests at
 * `work/specs/tasked/<slug>.md` (the tasked resting state, the source of truth for
 * tasked-ness — task `prd-sliced-folder-step-a`). BOTH folders are consulted (any
 * is enough): a spec that is up-for-tasking OR already tasked still occupies its
 * slug, so collision detection must see it. While a spec IS being tasked its body
 * STAYS in `work/specs/ready/` (the tasking lock no longer moves it — task
 * `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`; the transient
 * `tasking/` folder is retired, the in-flight state is the per-item lock ref), so a
 * mid-tasking spec is detected via its `work/specs/ready/` residence. The slug is resolved
 * from frontmatter `slug:`, falling back to the filename — the SAME shape the task
 * readers use.
 */
export interface SpecExistence {
	/**
	 * Whether a spec named `<slug>` exists in `work/specs/ready/` and/or `work/specs/tasked/`
	 * (up-for-tasking OR already tasked — either still claims the slug).
	 */
	exists: boolean;
	/** The spec source file, when present (`work/specs/ready/<slug>.md`). */
	specFile: string | undefined;
	/**
	 * The tasked resting file, when present (`work/specs/tasked/<slug>.md`) — i.e. the
	 * spec HAS BEEN tasked (the source of truth for tasked-ness, task
	 * `prd-sliced-folder-step-a`). A re-task moves it back `specs/tasked/ -> specs/ready/`.
	 */
	specTaskedFile: string | undefined;
}

/**
 * One spec enumerated for the AUTO-TASK selection pool (ADR §3 — the
 * "tasks-first then specs to task" priority). A spec is NOT in the task
 * scan/candidate model, so the auto-pick pool is built HERE from `work/specs/ready/`
 * through this single shared spec read path (the same path
 * {@link SpecExistence} uses, widened from existence to the gate axes the tasking
 * predicate needs). The tasking-eligibility predicate (`autoslice-gate`'s
 * `resolveTaskingEligibility`) is applied to these by the selection layer; this
 * reader does NOT itself decide eligibility (it just surfaces the inputs).
 */
export interface LedgerSpecItem {
	/** Filename within `work/specs/ready/` (e.g. `auto-slice.md`). */
	file: string;
	/** Resolved slug (frontmatter `slug:`, falling back to the filename). */
	slug: string;
	/** Autonomy axis 1 (DECIDED): `true` (human-only) | `undefined`. */
	humanOnly: boolean | undefined;
	/** Autonomy axis 2 (DISCOVERED): `true` (open questions) | `undefined`. */
	needsAnswers: boolean | undefined;
	/** Spec-only cross-spec order: spec slugs that must already be TASKED first. */
	taskedAfter: string[];
}

/**
 * The spec pool of ONE repo, resolved from `work/specs/ready/` (the auto-task candidate
 * source). Carries every spec's gate axes PLUS the set of already-TASKED slugs so
 * the selection layer can resolve each spec's `taskedAfter` against `work/specs/tasked/`
 * RESIDENCE (task `prd-sliced-folder-step-a` / spec `slicing-coherence` US #9): the
 * FOLDER is the source of truth, like `done/` for tasks (the auto-tasker reads
 * folder-residence; the `tasked:` marker was removed in
 * `remove-sliced-marker-step-b`). Built
 * through the SAME spec read path as {@link SpecExistence}; there is no second spec
 * reader.
 */
export interface LedgerSpecPool {
	/** Every spec in `work/specs/ready/`, sorted by slug. */
	specs: LedgerSpecItem[];
	/** Slugs whose spec resides in `work/specs/tasked/` (resolves `taskedAfter`). */
	taskedSlugs: Set<string>;
}

/**
 * One OBSERVATION's lifecycle-pool fields, as resolved from `work/notes/observations/`
 * (the triage candidate source for the advance auto-pick lifecycle pools, task
 * `advance-autopick-lifecycle-pools`). An observation with NO `triaged:` marker is
 * UNTRIAGED (still in the triage pool); a non-empty `triaged:` value (`keep` /
 * `duplicate`) means it is SETTLED and DROPS OUT of the pool (US #30). This is the
 * FIRST read of `work/notes/observations/` in the seam — `scan`/eligibility read only
 * `backlog`/`done`/`specs*`.
 */
export interface LedgerObservationItem {
	/** Filename within `work/notes/observations/` (e.g. `stray-note.md`). */
	file: string;
	/** Resolved slug (frontmatter `slug:`, falling back to the filename). */
	slug: string;
	/**
	 * The SETTLED marker (`triaged:` frontmatter): a non-empty value (`keep` /
	 * `duplicate`) drops the observation out of the triage pool; `undefined` ⇒
	 * UNTRIAGED (still a triage candidate).
	 */
	triaged: string | undefined;
}

/**
 * The live `work/` lifecycle state of ONE repo as resolved from the LOCAL
 * working tree. Storage-agnostic in shape: it is "the resolved state", not "the
 * files on disk".
 */
export interface LocalLedgerState {
	/** Parsed `work/tasks/ready/*.md` (the agent POOL), sorted by slug. */
	ready: LedgerReadyItem[];
	/** Slugs present in `work/done/` (per-repo; resolves `blockedBy`). */
	doneSlugs: Set<string>;
	/**
	 * `work/notes/observations/*.md` items (sorted by slug) — the triage candidate source
	 * for the advance auto-pick lifecycle pools (task
	 * `advance-autopick-lifecycle-pools`). UNTRIAGED observations (no `triaged:`
	 * marker) are the triage pool; SETTLED ones (`triaged:` non-empty) drop out.
	 */
	observations: LedgerObservationItem[];
}

/** The live `work/` state of ONE repo as resolved from the arbiter. */
export interface ArbiterLedgerState {
	/**
	 * The requested task's raw file contents from the arbiter (it may live in
	 * the POOL `tasks/ready/` or in `in-progress/`), or `undefined` when not found
	 * there.
	 */
	task: string | undefined;
	/** Slugs present in `work/done/` on the arbiter (per-repo; resolves `blockedBy`). */
	doneSlugs: Set<string>;
}

/** What the LOCAL-tree resolve method needs: which repo checkout to read. */
export interface ResolveLocalStateInput {
	/** The repo working-tree root whose `work/` state to resolve. */
	repoPath: string;
}

/** What the spec-existence resolve method needs: which repo + which slug. */
export interface ResolveSpecExistenceInput {
	/** The repo root whose `work/specs/ready/`+`work/specs/tasked/` to read. */
	repoPath: string;
	/** The slug to look up (matched against frontmatter `slug:`, then filename). */
	slug: string;
}

/** What the spec-pool resolve method needs: which repo's `work/specs/ready/` to enumerate. */
export interface ResolveSpecPoolInput {
	/** The repo working-tree root whose `work/specs/ready/` to read. */
	repoPath: string;
}

/**
 * What the MIRROR-ref resolve method needs to read the full `work/` lifecycle
 * from a BARE hub mirror's committed tree.
 */
export interface ResolveMirrorStateInput {
	/** The bare hub mirror directory (`<workspacesDir>/repos/<key>.git`). */
	mirrorPath: string;
	/**
	 * The mirror-LOCAL ref whose `work/` tree to read (default `main`). A hub
	 * mirror is bare, so `main` is a LOCAL branch — read `main:work/...`, NOT
	 * `origin/main:work/...`.
	 */
	ref?: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
}

/**
 * What the MIRROR-ref spec-pool method needs: which bare hub mirror's committed
 * `work/specs/ready/`+`work/specs/tasked/` tree to enumerate.
 */
export interface ResolveMirrorSpecPoolInput {
	/** The bare hub mirror directory (`<workspacesDir>/repos/<key>.git`). */
	mirrorPath: string;
	/** The mirror-LOCAL ref whose `work/specs*` tree to read (default `main`). */
	ref?: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
}

/** What the ARBITER resolve method needs to read committed `work/` state. */
export interface ResolveArbiterStateInput {
	/** The slug whose task file to resolve (`work/{backlog,in-progress}/<slug>.md`). */
	slug: string;
	/** A working clone whose remotes include the arbiter (the reads run here). */
	cwd: string;
	/** Name of the arbiter git remote (its `main` is the source of truth). */
	arbiter: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
}

/**
 * The read-seam interface: ONE entry with THREE resolve-methods. The local
 * method is synchronous and OFFLINE; the arbiter and mirror methods are async
 * (they shell out to git). A future strategy implements this same interface to
 * resolve some states elsewhere — without any reader changing.
 */
export interface LedgerReadStrategy {
	/** Resolve a repo's live `work/` state from its LOCAL working tree (offline). */
	resolveLocalState(input: ResolveLocalStateInput): LocalLedgerState;
	/** Resolve a repo's live `work/` state from the ARBITER (`<arbiter>/main`). */
	resolveArbiterState(
		input: ResolveArbiterStateInput,
	): Promise<ArbiterLedgerState>;
	/**
	 * Resolve the FULL live `work/` lifecycle (backlog + done + observations) of
	 * a repo from its BARE hub mirror's `main` ref. Mirrors have no working
	 * tree, so `resolveLocalState`'s `readdirSync`/`readFileSync` cannot read them
	 * — this reads the committed tree via `git ls-tree`/`git show` (the same
	 * mechanism the arbiter method uses for `done/`, widened to the full set).
	 */
	resolveMirrorState(input: ResolveMirrorStateInput): Promise<LocalLedgerState>;
	/**
	 * Enumerate the repo's spec pool from a BARE hub mirror's committed `work/specs/ready/`
	 * tree (+ already-TASKED slugs from `work/specs/tasked/` residence) — the
	 * mirror-ref counterpart of {@link LedgerReadStrategy.resolveSpecPool}, for the
	 * NO-CHECKOUT mirror-side auto-pick (`run`'s isolated loop + the one-shot/CI
	 * `advance --remote -n`). A mirror is bare, so this reads the committed tree via
	 * `git ls-tree`/`git show` (the SAME mechanism {@link resolveMirrorState} uses),
	 * not a working-tree `readdirSync`. Returns the SAME {@link LedgerSpecPool} shape
	 * the working-tree reader returns, so the tasking-eligibility predicate
	 * (`taskableSpecs`) applies byte-identically to either source.
	 */
	resolveMirrorSpecPool(
		input: ResolveMirrorSpecPoolInput,
	): Promise<LedgerSpecPool>;
	/**
	 * Resolve whether a spec named `<slug>` exists in the LOCAL working tree's
	 * `work/specs/ready/` (the spec source — where a mid-tasking spec ALSO rests now that the
	 * `tasking/` folder is retired) and/or `work/specs/tasked/` (the tasked resting
	 * state). The slug is resolved from each candidate file's frontmatter `slug:`,
	 * falling back to the filename — the SAME shape the task readers use.
	 *
	 * This is the FIRST spec read path in the seam: `ledger-read.ts`/`scan.ts` read
	 * only `backlog`/`done`, NEVER `work/specs/ready/`. It is added here
	 * so the §3a slug-namespace resolver, and later the auto-tasking / `do prd:` work,
	 * share ONE spec read path rather than each growing a bespoke scan. Synchronous
	 * and OFFLINE (a working-tree read), like {@link resolveLocalState}.
	 */
	resolveSpecExistence(input: ResolveSpecExistenceInput): SpecExistence;
	/**
	 * Enumerate the repo's spec pool from `work/specs/ready/` (the auto-task candidate
	 * source for the `do`/`run` "tasks-first then specs to task" priority, ADR
	 * §3). Returns every spec's gate axes (`humanOnly`/`needsAnswers`/`taskedAfter`)
	 * PLUS the set of already-TASKED slugs so the selection layer can resolve
	 * `taskedAfter` against `work/specs/tasked/` residence (the FOLDER is the source of
	 * truth) and apply `autoslice-gate`'s
	 * predicate. This is the SAME spec read path {@link resolveSpecExistence} uses,
	 * widened from a single-slug existence check to a full enumeration — NOT a
	 * second spec reader. Synchronous and OFFLINE (a working-tree read), like
	 * {@link resolveLocalState}.
	 */
	resolveSpecPool(input: ResolveSpecPoolInput): LedgerSpecPool;
	/**
	 * Enumerate `work/tasks/backlog/*.md` (the TASK STAGING folder) into the SAME
	 * {@link LedgerReadyItem} shape `resolveLocalState().ready` returns for the pool
	 * — the SURFACE-on-staging widening (spec
	 * `staging-surface-and-apply-promote-safety` F2). Synchronous + OFFLINE
	 * (working-tree read), like {@link resolveLocalState}. The pool / staging
	 * folders are distinct durable status folders (one-slug-one-folder — a slug
	 * is in at most one), so the two reads compose without de-duplication
	 * gymnastics. Missing folder reads as empty. CONSUMED ONLY by the lifecycle
	 * GATHER under the `surfaceStaging` gate — the BUILD/claim pool stays
	 * pool-only (`resolveLocalState().ready`), untouched by this read.
	 */
	resolveLocalTaskStaging(input: ResolveLocalStateInput): LedgerReadyItem[];
	/**
	 * Enumerate `work/specs/proposed/*.md` (the SPEC STAGING folder) into the
	 * SAME {@link LedgerSpecItem} shape `resolveSpecPool().specs` returns for the
	 * pool — the SPEC-symmetric `surfaceStaging` widening (spec
	 * `staging-surface-and-apply-promote-safety` F2, spec q4 answer). Sync + OFFLINE.
	 */
	resolveLocalSpecStaging(input: ResolveSpecPoolInput): LedgerSpecItem[];
	/**
	 * Enumerate `work/specs/tasked/*.md` (the TASKED resting folder) into the SAME
	 * {@link LedgerSpecItem} shape `resolveSpecPool().specs` returns. UNLIKE the pool
	 * (`specs/ready/`) and staging (`specs/proposed/`) readers, this exists so the
	 * lifecycle GATHER can surface/apply a `needsAnswers:true` spec that drifted
	 * AFTER it was tasked and rests IN PLACE in `specs/tasked/` (WORK-CONTRACT
	 * "A SPEC that has drifted AFTER it was TASKED"). Without it, such a spec's
	 * ANSWERED sidecar is enumerated by no pool and the human's answer is STRANDED
	 * (observation `tasked-prd-needsanswers-sidecar-stranded-no-apply-pool`).
	 * `resolveSpecPool` deliberately returns tasked specs only as `taskedSlugs`
	 * (residence, for `taskedAfter`), NOT as enumerable gate-bearing items, so this
	 * is a SEPARATE read. Sync + OFFLINE.
	 */
	resolveLocalSpecTasked(input: ResolveSpecPoolInput): LedgerSpecItem[];
	/**
	 * Mirror-ref counterpart of {@link resolveLocalTaskStaging}: read
	 * `<ref>:work/tasks/backlog/*.md` from a BARE hub mirror via `git ls-tree` +
	 * `git show` (the SAME mechanism `resolveMirrorState` uses for the pool).
	 */
	resolveMirrorTaskStaging(
		input: ResolveMirrorStateInput,
	): Promise<LedgerReadyItem[]>;
	/**
	 * Mirror-ref counterpart of {@link resolveLocalSpecStaging}: read
	 * `<ref>:work/specs/proposed/*.md` from a bare mirror.
	 */
	resolveMirrorSpecStaging(
		input: ResolveMirrorSpecPoolInput,
	): Promise<LedgerSpecItem[]>;
	/**
	 * Mirror-ref counterpart of {@link resolveLocalSpecTasked}: read
	 * `<ref>:work/specs/tasked/*.md` from a bare mirror, so a `needsAnswers` tasked
	 * spec's answered sidecar is never stranded on the mirror-side advance path
	 * either.
	 */
	resolveMirrorSpecTasked(
		input: ResolveMirrorSpecPoolInput,
	): Promise<LedgerSpecItem[]>;
}

// --- The sole strategy: exactly today's behaviour -------------------------

function listMarkdown(dir: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries.filter((name) => isWorkItemFile(name)).sort();
}

function slugForFile(dir: string, file: string): string {
	const content = readFileSync(join(dir, file), 'utf8');
	const fm = parseFrontmatter(content);
	return fm.slug ?? basename(file, '.md');
}

/**
 * Read a folder of TASK items (`tasks-ready` or `tasks-backlog`) from the local
 * tree into the {@link LedgerReadyItem[]} shape. Factored so the POOL reader
 * (`tasks/ready`) and the STAGING reader (`tasks/backlog`, the `surfaceStaging`
 * widening) share one parse path — the two folders carry the SAME item shape
 * (frontmatter + body), only the trust polarity differs.
 */
function readLocalTaskFolder(
	repoPath: string,
	folder: 'tasks-ready' | 'tasks-backlog',
): LedgerReadyItem[] {
	const dir = workFolderPath(repoPath, folder);
	const items: LedgerReadyItem[] = [];
	for (const file of listMarkdown(dir)) {
		const content = readFileSync(join(dir, file), 'utf8');
		const fm = parseFrontmatter(content);
		items.push({
			file,
			slug: fm.slug ?? basename(file, '.md'),
			humanOnly: fm.humanOnly,
			needsAnswers: fm.needsAnswers,
			blockedBy: fm.blockedBy,
		});
	}
	return items.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Read `work/tasks/ready/*.md` (the agent POOL) from the local tree, parsed and sorted by slug. */
function readLocalReady(repoPath: string): LedgerReadyItem[] {
	return readLocalTaskFolder(repoPath, 'tasks-ready');
}

/**
 * Read `work/tasks/backlog/*.md` (the TASK STAGING folder, spec
 * `staging-surface-and-apply-promote-safety` F2) from the local tree. Same
 * {@link LedgerReadyItem} shape as the pool reader — the SURFACE-on-staging
 * widening only enumerates items; it does NOT promote them.
 */
function readLocalTaskStaging(repoPath: string): LedgerReadyItem[] {
	return readLocalTaskFolder(repoPath, 'tasks-backlog');
}

/**
 * Read `work/specs/proposed/*.md` (the SPEC STAGING folder, the spec twin
 * of {@link readLocalTaskStaging}, spec q4 answer) from the local tree. Returns
 * the SAME {@link LedgerSpecItem} shape `resolveSpecPool().specs` returns.
 */
function readLocalSpecStaging(repoPath: string): LedgerSpecItem[] {
	return readLocalSpecFolder(repoPath, 'specs-proposed');
}

/**
 * Read `work/specs/tasked/*.md` (the TASKED resting folder) into the SAME
 * {@link LedgerSpecItem} shape. Used by the lifecycle gather to surface/apply a
 * `needsAnswers` spec that drifted after tasking and rests in place in
 * `specs/tasked/` — so its answered sidecar is never stranded.
 */
function readLocalSpecTasked(repoPath: string): LedgerSpecItem[] {
	return readLocalSpecFolder(repoPath, 'specs-tasked');
}

/** Shared body for the local spec-FOLDER readers (proposed/tasked) — same item shape. */
function readLocalSpecFolder(
	repoPath: string,
	folder: 'specs-proposed' | 'specs-tasked',
): LedgerSpecItem[] {
	const dir = workFolderPath(repoPath, folder);
	const specs: LedgerSpecItem[] = [];
	for (const file of listMarkdown(dir)) {
		const content = readFileSync(join(dir, file), 'utf8');
		const fm = parseFrontmatter(content);
		specs.push({
			file,
			slug: fm.slug ?? basename(file, '.md'),
			humanOnly: fm.humanOnly,
			needsAnswers: fm.needsAnswers,
			taskedAfter: fm.taskedAfter,
		});
	}
	return specs.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Collect the slugs present in `work/done/` on the local tree. */
function readLocalDoneSlugs(repoPath: string): Set<string> {
	const dir = workFolderPath(repoPath, 'done');
	const slugs = new Set<string>();
	for (const file of listMarkdown(dir)) {
		slugs.add(slugForFile(dir, file));
	}
	return slugs;
}

/**
 * Read `work/notes/observations/*.md` (slug-sorted) from the local tree.
 *
 * Identity rule (task `observation-identity-is-its-filename-not-a-foreign-slug`):
 * an observation's IDENTITY is its FILENAME, NEVER a foreign frontmatter `slug:`.
 * Earlier this read `fm.slug ?? basename(file)`, which let the review-nits minting
 * (which wrote the REVIEWED TASK's slug into `slug:` as a back-pointer) drive the
 * lifecycle pool to emit `obs:<reviewed-slug>` — a key that did not round-trip
 * through `findItemPath` (filename-only) and collided with the reviewed task in
 * `work/done/`. Identity is now ALWAYS the basename, so the enumerate→resolve
 * round-trip is total by construction and a stray frontmatter `slug:` cannot
 * re-break it. The back-pointer lives in `reviewOf:` instead.
 */
function readLocalObservations(repoPath: string): LedgerObservationItem[] {
	const dir = workFolderPath(repoPath, 'observations');
	const items: LedgerObservationItem[] = [];
	for (const file of listMarkdown(dir)) {
		const content = readFileSync(join(dir, file), 'utf8');
		const fm = parseFrontmatter(content);
		items.push({
			file,
			slug: basename(file, '.md'),
			triaged: fm.triaged,
		});
	}
	return items.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Does a spec named `slug` exist in `<repoPath>/work/<folder>/`? A spec source file
 * is `work/specs/ready/*.md` (where a mid-tasking spec also rests — the `tasking/` folder is
 * retired); a tasked spec rests at `work/specs/tasked/*.md` (the source of truth for
 * tasked-ness). We match the slug against each file's
 * frontmatter `slug:` (falling back to the filename) — the SAME shape the task
 * readers use — so a renamed file whose frontmatter slug matches still resolves.
 * Returns the matching filename, or `undefined`.
 */
function findSpecFileBySlug(
	repoPath: string,
	folder: SpecFolder,
	slug: string,
): string | undefined {
	const dir = workFolderPath(repoPath, folder);
	for (const file of listMarkdown(dir)) {
		if (slugForFile(dir, file) === slug) {
			return file;
		}
	}
	return undefined;
}

/**
 * Enumerate `work/specs/ready/*.md` into the auto-task spec pool (the tasks-first/spec
 * priority's spec source) — the SAME spec read path {@link findSpecFileBySlug} uses,
 * widened from a single-slug existence check to a full enumeration. Each spec's
 * slug is resolved from frontmatter `slug:` (falling back to the filename) and
 * its gate axes (`humanOnly`/`needsAnswers`/`taskedAfter`) parsed. The
 * already-TASKED set is RESIDENCE in `work/specs/tasked/` (task
 * `prd-sliced-folder-step-a` / spec `slicing-coherence` US #9): the FOLDER is the
 * source of truth (the build-machine `done/` analogue), so `taskedAfter` resolves
 * against `specs/tasked/` residence (mirroring `blockedBy` -> `done/`). The `tasked:`
 * frontmatter marker was removed entirely in `remove-sliced-marker-step-b`. This
 * matches `tasking.ts`'s `readTaskedSlugs`. Missing folders read as empty.
 */
function readLocalSpecPool(repoPath: string): LocalSpecPool {
	const dir = workFolderPath(repoPath, 'specs-ready');
	const specs: LedgerSpecItem[] = [];
	for (const file of listMarkdown(dir)) {
		const content = readFileSync(join(dir, file), 'utf8');
		const fm = parseFrontmatter(content);
		specs.push({
			file,
			slug: fm.slug ?? basename(file, '.md'),
			humanOnly: fm.humanOnly,
			needsAnswers: fm.needsAnswers,
			taskedAfter: fm.taskedAfter,
		});
	}
	specs.sort((a, b) => a.slug.localeCompare(b.slug));

	// Tasked-ness is RESIDENCE in `work/specs/tasked/` — the FOLDER is the source of
	// truth, like `done/` for tasks (the `tasked:` marker was removed in
	// `remove-sliced-marker-step-b`), mirroring tasking.ts's readTaskedSlugs. Missing
	// folder reads as empty.
	const taskedSlugs = new Set<string>();
	const taskedDir = workFolderPath(repoPath, 'specs-tasked');
	for (const file of listMarkdown(taskedDir)) {
		const content = readFileSync(join(taskedDir, file), 'utf8');
		const fm = parseFrontmatter(content);
		taskedSlugs.add(fm.slug ?? basename(file, '.md'));
	}
	return {specs, taskedSlugs};
}

/** Internal alias for {@link LedgerSpecPool} (kept local to the reader). */
type LocalSpecPool = LedgerSpecPool;

/** Run git, returning the raw result (no throw) — for soft checks. */
function gitSoft(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	return runAsync('git', args, cwd, {env});
}

/**
 * Read the task file's contents from `<arbiter>/main`. It may live in `backlog/`
 * (the normal claim case) or `in-progress/` (start --resume); read whichever
 * exists. Returns `undefined` when the task is not found there.
 */
async function readTaskOnArbiter(
	slug: string,
	arbiter: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string | undefined> {
	for (const folder of ['tasks-ready', 'in-progress'] as const) {
		const object = `${arbiter}/main:${workFolderRel(folder)}/${slug}.md`;
		const show = await gitSoft(['show', object], cwd, env);
		if (show.status === 0) {
			return show.stdout;
		}
	}
	return undefined;
}

/**
 * Collect the slugs present in `work/done/` on `<arbiter>/main`, read from the
 * committed arbiter tree (`ls-tree`). The slug is the filename minus `.md`
 * (matching how claim/done moves name the file after its slug).
 */
async function readDoneSlugsOnArbiter(
	arbiter: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<Set<string>> {
	return readDoneSlugsFromTree(`${arbiter}/main`, cwd, env);
}

// --- Reading a committed `work/` tree (ref-based; bare-mirror or arbiter) ----
//
// These helpers read `work/{backlog,done}` from a git REF via
// `git ls-tree`/`git show` — the ONLY mechanism that works against a BARE repo
// (no working tree). `treeBase` is the `<ref>:work/<folder>` prefix; `cwd` is
// the repo the `git -C <cwd>` commands run in (the mirror itself for the mirror
// method, a working clone for the arbiter method).

/** `git ls-tree --name-only <base>` → the `.md` filenames (sorted), or `[]`. */
async function listMarkdownInTree(
	base: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string[]> {
	const tree = await gitSoft(['ls-tree', '--name-only', base], cwd, env);
	if (tree.status !== 0) {
		// The folder does not exist on this ref — nothing there.
		return [];
	}
	return tree.stdout
		.split('\n')
		.map((s) => s.trim())
		.filter((name) => isWorkItemFile(name))
		.sort();
}

/** `git show <base>/<file>` → the file's raw contents, or `undefined`. */
async function showInTree(
	base: string,
	file: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string | undefined> {
	const show = await gitSoft(['show', `${base}/${file}`], cwd, env);
	return show.status === 0 ? show.stdout : undefined;
}

/** Collect the slugs in `<ref>:work/done` (filename minus `.md`). */
async function readDoneSlugsFromTree(
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<Set<string>> {
	const slugs = new Set<string>();
	for (const file of await listMarkdownInTree(
		`${ref}:${workFolderRel('done')}`,
		cwd,
		env,
	)) {
		slugs.add(file.slice(0, -'.md'.length));
	}
	return slugs;
}

/**
 * Parse `<ref>:work/tasks/<folder>/*.md` from a committed tree into
 * {@link LedgerReadyItem[]}, sorted by slug. Factored so the POOL + STAGING
 * mirror reads share ONE parse path (mirrors `readLocalTaskFolder`).
 */
async function readTaskFolderFromTree(
	folder: 'tasks-ready' | 'tasks-backlog',
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LedgerReadyItem[]> {
	const base = `${ref}:${workFolderRel(folder)}`;
	const items: LedgerReadyItem[] = [];
	for (const file of await listMarkdownInTree(base, cwd, env)) {
		const content = await showInTree(base, file, cwd, env);
		if (content === undefined) {
			continue;
		}
		const fm = parseFrontmatter(content);
		items.push({
			file,
			slug: fm.slug ?? basename(file, '.md'),
			humanOnly: fm.humanOnly,
			needsAnswers: fm.needsAnswers,
			blockedBy: fm.blockedBy,
		});
	}
	return items.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Parse `<ref>:work/tasks/ready/*.md` into pool items, sorted by slug. */
async function readReadyFromTree(
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LedgerReadyItem[]> {
	return readTaskFolderFromTree('tasks-ready', ref, cwd, env);
}

/** Parse `<ref>:work/tasks/backlog/*.md` (TASK STAGING) into items, sorted by slug. */
async function readTaskStagingFromTree(
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LedgerReadyItem[]> {
	return readTaskFolderFromTree('tasks-backlog', ref, cwd, env);
}

/** Parse `<ref>:work/specs/proposed/*.md` (SPEC STAGING) into spec items, sorted by slug. */
async function readSpecStagingFromTree(
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LedgerSpecItem[]> {
	return readSpecFolderFromTree('specs-proposed', ref, cwd, env);
}

/** Parse `<ref>:work/specs/tasked/*.md` (TASKED resting) into spec items, sorted by slug. */
async function readSpecTaskedFromTree(
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LedgerSpecItem[]> {
	return readSpecFolderFromTree('specs-tasked', ref, cwd, env);
}

/** Shared body for the mirror-ref spec-FOLDER readers (proposed/tasked) — same item shape. */
async function readSpecFolderFromTree(
	folder: 'specs-proposed' | 'specs-tasked',
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LedgerSpecItem[]> {
	const base = `${ref}:${workFolderRel(folder)}`;
	const specs: LedgerSpecItem[] = [];
	for (const file of await listMarkdownInTree(base, cwd, env)) {
		const content = await showInTree(base, file, cwd, env);
		if (content === undefined) {
			continue;
		}
		const fm = parseFrontmatter(content);
		specs.push({
			file,
			slug: fm.slug ?? basename(file, '.md'),
			humanOnly: fm.humanOnly,
			needsAnswers: fm.needsAnswers,
			taskedAfter: fm.taskedAfter,
		});
	}
	return specs.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Parse `<ref>:work/specs/ready/*.md` into the auto-task spec pool, sorted by slug, plus
 * the already-TASKED slugs from `<ref>:work/specs/tasked/` RESIDENCE (the folder is
 * the source of truth, mirroring the working-tree {@link readLocalSpecPool}). Reads
 * a committed tree (bare-mirror or any ref) via `ls-tree`/`show`. Missing folders
 * read as empty.
 */
async function readSpecPoolFromTree(
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LedgerSpecPool> {
	const specBase = `${ref}:${workFolderRel('specs-ready')}`;
	const specs: LedgerSpecItem[] = [];
	for (const file of await listMarkdownInTree(specBase, cwd, env)) {
		const content = await showInTree(specBase, file, cwd, env);
		if (content === undefined) {
			continue;
		}
		const fm = parseFrontmatter(content);
		specs.push({
			file,
			slug: fm.slug ?? basename(file, '.md'),
			humanOnly: fm.humanOnly,
			needsAnswers: fm.needsAnswers,
			taskedAfter: fm.taskedAfter,
		});
	}
	specs.sort((a, b) => a.slug.localeCompare(b.slug));

	// Tasked-ness is RESIDENCE in `work/specs/tasked/` — the FOLDER is the source of
	// truth (the `tasked:` marker was removed in `remove-sliced-marker-step-b`),
	// exactly as the working-tree reader resolves it.
	const taskedBase = `${ref}:${workFolderRel('specs-tasked')}`;
	const taskedSlugs = new Set<string>();
	for (const file of await listMarkdownInTree(taskedBase, cwd, env)) {
		const content = await showInTree(taskedBase, file, cwd, env);
		if (content === undefined) {
			continue;
		}
		const fm = parseFrontmatter(content);
		taskedSlugs.add(fm.slug ?? basename(file, '.md'));
	}
	return {specs, taskedSlugs};
}

/**
 * Parse `<ref>:work/notes/observations/*.md` into items, sorted by slug. Identity is the
 * FILENAME (mirrors {@link readLocalObservations}) so the in-place + mirror
 * enumerations agree, and a foreign frontmatter `slug:` cannot break the
 * enumerate→resolve round-trip.
 */
async function readObservationsFromTree(
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LedgerObservationItem[]> {
	const base = `${ref}:${workFolderRel('observations')}`;
	const items: LedgerObservationItem[] = [];
	for (const file of await listMarkdownInTree(base, cwd, env)) {
		const content = await showInTree(base, file, cwd, env);
		if (content === undefined) {
			continue;
		}
		const fm = parseFrontmatter(content);
		items.push({
			file,
			slug: basename(file, '.md'),
			triaged: fm.triaged,
		});
	}
	return items.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * The ONLY ledger-read strategy: current behaviour. The local method reads the
 * working tree (offline); the arbiter method reads `<arbiter>/main`. A future
 * strategy would be a different object implementing the same interface — chosen
 * NOWHERE today (no mode/config selects it).
 */
export const currentLedgerRead: LedgerReadStrategy = {
	resolveLocalState({repoPath}) {
		return {
			ready: readLocalReady(repoPath),
			doneSlugs: readLocalDoneSlugs(repoPath),
			observations: readLocalObservations(repoPath),
		};
	},
	async resolveArbiterState({slug, cwd, arbiter, env}) {
		const task = await readTaskOnArbiter(slug, arbiter, cwd, env);
		const doneSlugs = await readDoneSlugsOnArbiter(arbiter, cwd, env);
		return {task, doneSlugs};
	},
	resolveSpecExistence({repoPath, slug}) {
		const specFile = findSpecFileBySlug(repoPath, 'specs-ready', slug);
		const specTaskedFile = findSpecFileBySlug(repoPath, 'specs-tasked', slug);
		return {
			exists: specFile !== undefined || specTaskedFile !== undefined,
			specFile,
			specTaskedFile,
		};
	},
	resolveSpecPool({repoPath}) {
		return readLocalSpecPool(repoPath);
	},
	resolveLocalTaskStaging({repoPath}) {
		return readLocalTaskStaging(repoPath);
	},
	resolveLocalSpecStaging({repoPath}) {
		return readLocalSpecStaging(repoPath);
	},
	resolveLocalSpecTasked({repoPath}) {
		return readLocalSpecTasked(repoPath);
	},
	async resolveMirrorTaskStaging({mirrorPath, ref = 'main', env}) {
		return readTaskStagingFromTree(ref, mirrorPath, env);
	},
	async resolveMirrorSpecStaging({mirrorPath, ref = 'main', env}) {
		return readSpecStagingFromTree(ref, mirrorPath, env);
	},
	async resolveMirrorSpecTasked({mirrorPath, ref = 'main', env}) {
		return readSpecTaskedFromTree(ref, mirrorPath, env);
	},
	async resolveMirrorState({mirrorPath, ref = 'main', env}) {
		// A hub mirror is BARE — read the full `work/` lifecycle from its committed
		// `<ref>:work/...` tree, running git INSIDE the mirror (`git -C <mirror>`).
		// The ref is mirror-LOCAL (`main`), never `origin/main`.
		const [ready, doneSlugs, observations] = await Promise.all([
			readReadyFromTree(ref, mirrorPath, env),
			readDoneSlugsFromTree(ref, mirrorPath, env),
			readObservationsFromTree(ref, mirrorPath, env),
		]);
		return {ready, doneSlugs, observations};
	},
	async resolveMirrorSpecPool({mirrorPath, ref = 'main', env}) {
		// The spec pool from the bare mirror's committed `<ref>:work/specs*` tree — the
		// mirror-ref counterpart of `resolveSpecPool` (a working-tree read). Same shape,
		// so `taskableSpecs` applies identically to either source.
		return readSpecPoolFromTree(ref, mirrorPath, env);
	},
};

/**
 * The active ledger-read strategy. There is exactly one (current behaviour);
 * this indirection is the seam's single insertion point — NOT a selectable mode.
 */
export const ledgerRead: LedgerReadStrategy = currentLedgerRead;
