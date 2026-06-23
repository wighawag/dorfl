import {readdirSync, readFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {parseFrontmatter} from './frontmatter.js';
import {runAsync, type RunResult} from './git.js';
import {
	type WorkFolderKey,
	type BriefFolder,
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
 *   - **local working tree** — a working clone reads `work/tasks/todo|tasks/done`
 *     from its checkout (pool = `tasks/todo`; staging = `tasks/backlog`, surfaced
 *     elsewhere). OFFLINE. (Pre-registry `scan`/`status` used this; `run`'s in-place
 *     checkouts still do.)
 *   - **arbiter `main`** — the human claim guard (`readiness`) and the claim CAS
 *     read the slice + `work/done/` from `<arbiter>/main`.
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
 * state. The pool lives in `work/tasks/todo/` in the new layout (staging is
 * `work/tasks/backlog/`); the type name follows the pool noun (`todo`) so a
 * later reader cannot misread `backlog` as the pool.
 */
export interface LedgerTodoItem {
	/** Filename within `work/tasks/todo/` (e.g. `scan.md`). */
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
 * The result of a PRD-existence read (ADR §3a): does a PRD named `<slug>` exist,
 * and where. A PRD lives at `work/prd/<slug>.md`; once SLICED it rests at
 * `work/prd-sliced/<slug>.md` (the sliced resting state, the source of truth for
 * sliced-ness — slice `prd-sliced-folder-step-a`). BOTH folders are consulted (any
 * is enough): a PRD that is up-for-slicing OR already sliced still occupies its
 * slug, so collision detection must see it. While a PRD IS being sliced its body
 * STAYS in `work/prd/` (the slicing lock no longer moves it — slice
 * `cutover-retire-slicing-advancing-markers-and-trim-folder-sets`; the transient
 * `slicing/` folder is retired, the in-flight state is the per-item lock ref), so a
 * mid-slice PRD is detected via its `work/prd/` residence. The slug is resolved
 * from frontmatter `slug:`, falling back to the filename — the SAME shape the slice
 * readers use.
 */
export interface BriefExistence {
	/**
	 * Whether a PRD named `<slug>` exists in `work/prd/` and/or `work/prd-sliced/`
	 * (up-for-slicing OR already sliced — either still claims the slug).
	 */
	exists: boolean;
	/** The PRD source file, when present (`work/prd/<slug>.md`). */
	briefFile: string | undefined;
	/**
	 * The sliced resting file, when present (`work/prd-sliced/<slug>.md`) — i.e. the
	 * PRD HAS BEEN sliced (the source of truth for sliced-ness, slice
	 * `prd-sliced-folder-step-a`). A re-slice moves it back `prd-sliced/ -> prd/`.
	 */
	briefTaskedFile: string | undefined;
}

/**
 * One PRD enumerated for the AUTO-SLICE selection pool (ADR §3 — the
 * "slices-first then PRDs to slice" priority). A PRD is NOT in the slice
 * scan/candidate model, so the auto-pick pool is built HERE from `work/prd/`
 * through this single shared PRD read path (the same path
 * {@link BriefExistence} uses, widened from existence to the gate axes the slicing
 * predicate needs). The slicing-eligibility predicate (`autoslice-gate`'s
 * `resolveTaskingEligibility`) is applied to these by the selection layer; this
 * reader does NOT itself decide eligibility (it just surfaces the inputs).
 */
export interface LedgerBriefItem {
	/** Filename within `work/prd/` (e.g. `auto-slice.md`). */
	file: string;
	/** Resolved slug (frontmatter `slug:`, falling back to the filename). */
	slug: string;
	/** Autonomy axis 1 (DECIDED): `true` (human-only) | `undefined`. */
	humanOnly: boolean | undefined;
	/** Autonomy axis 2 (DISCOVERED): `true` (open questions) | `undefined`. */
	needsAnswers: boolean | undefined;
	/** PRD-only cross-PRD order: PRD slugs that must already be SLICED first. */
	briefAfter: string[];
}

/**
 * The PRD pool of ONE repo, resolved from `work/prd/` (the auto-slice candidate
 * source). Carries every PRD's gate axes PLUS the set of already-SLICED slugs so
 * the selection layer can resolve each PRD's `briefAfter` against `work/prd-sliced/`
 * RESIDENCE (slice `prd-sliced-folder-step-a` / PRD `slicing-coherence` US #9): the
 * FOLDER is the source of truth, like `done/` for slices (the auto-slicer reads
 * folder-residence; the `sliced:` marker was removed in
 * `remove-sliced-marker-step-b`). Built
 * through the SAME PRD read path as {@link BriefExistence}; there is no second PRD
 * reader.
 */
export interface LedgerBriefPool {
	/** Every PRD in `work/prd/`, sorted by slug. */
	briefs: LedgerBriefItem[];
	/** Slugs whose PRD resides in `work/prd-sliced/` (resolves `briefAfter`). */
	taskedSlugs: Set<string>;
}

/**
 * One OBSERVATION's lifecycle-pool fields, as resolved from `work/observations/`
 * (the triage candidate source for the advance auto-pick lifecycle pools, slice
 * `advance-autopick-lifecycle-pools`). An observation with NO `triaged:` marker is
 * UNTRIAGED (still in the triage pool); a non-empty `triaged:` value (`keep` /
 * `duplicate`) means it is SETTLED and DROPS OUT of the pool (US #30). This is the
 * FIRST read of `work/observations/` in the seam — `scan`/eligibility read only
 * `backlog`/`done`/`prd*`.
 */
export interface LedgerObservationItem {
	/** Filename within `work/observations/` (e.g. `stray-note.md`). */
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
	/** Parsed `work/tasks/todo/*.md` (the agent POOL), sorted by slug. */
	todo: LedgerTodoItem[];
	/** Slugs present in `work/done/` (per-repo; resolves `blockedBy`). */
	doneSlugs: Set<string>;
	/**
	 * `work/observations/*.md` items (sorted by slug) — the triage candidate source
	 * for the advance auto-pick lifecycle pools (slice
	 * `advance-autopick-lifecycle-pools`). UNTRIAGED observations (no `triaged:`
	 * marker) are the triage pool; SETTLED ones (`triaged:` non-empty) drop out.
	 */
	observations: LedgerObservationItem[];
}

/** The live `work/` state of ONE repo as resolved from the arbiter. */
export interface ArbiterLedgerState {
	/**
	 * The requested slice's raw file contents from the arbiter (it may live in
	 * the POOL `tasks/todo/` or in `in-progress/`), or `undefined` when not found
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

/** What the PRD-existence resolve method needs: which repo + which slug. */
export interface ResolveBriefExistenceInput {
	/** The repo root whose `work/prd/`+`work/prd-sliced/` to read. */
	repoPath: string;
	/** The slug to look up (matched against frontmatter `slug:`, then filename). */
	slug: string;
}

/** What the PRD-pool resolve method needs: which repo's `work/prd/` to enumerate. */
export interface ResolveBriefPoolInput {
	/** The repo working-tree root whose `work/prd/` to read. */
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
 * What the MIRROR-ref PRD-pool method needs: which bare hub mirror's committed
 * `work/prd/`+`work/prd-sliced/` tree to enumerate.
 */
export interface ResolveMirrorBriefPoolInput {
	/** The bare hub mirror directory (`<workspacesDir>/repos/<key>.git`). */
	mirrorPath: string;
	/** The mirror-LOCAL ref whose `work/prd*` tree to read (default `main`). */
	ref?: string;
	/** Environment for child git processes. */
	env?: NodeJS.ProcessEnv;
}

/** What the ARBITER resolve method needs to read committed `work/` state. */
export interface ResolveArbiterStateInput {
	/** The slug whose slice file to resolve (`work/{backlog,in-progress}/<slug>.md`). */
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
	 * Enumerate the repo's PRD pool from a BARE hub mirror's committed `work/prd/`
	 * tree (+ already-SLICED slugs from `work/prd-sliced/` residence) — the
	 * mirror-ref counterpart of {@link LedgerReadStrategy.resolvePrdPool}, for the
	 * NO-CHECKOUT mirror-side auto-pick (`run`'s isolated loop + the one-shot/CI
	 * `advance --remote -n`). A mirror is bare, so this reads the committed tree via
	 * `git ls-tree`/`git show` (the SAME mechanism {@link resolveMirrorState} uses),
	 * not a working-tree `readdirSync`. Returns the SAME {@link LedgerBriefPool} shape
	 * the working-tree reader returns, so the slicing-eligibility predicate
	 * (`taskableBriefs`) applies byte-identically to either source.
	 */
	resolveMirrorBriefPool(
		input: ResolveMirrorBriefPoolInput,
	): Promise<LedgerBriefPool>;
	/**
	 * Resolve whether a PRD named `<slug>` exists in the LOCAL working tree's
	 * `work/prd/` (the PRD source — where a mid-slice PRD ALSO rests now that the
	 * `slicing/` folder is retired) and/or `work/prd-sliced/` (the sliced resting
	 * state). The slug is resolved from each candidate file's frontmatter `slug:`,
	 * falling back to the filename — the SAME shape the slice readers use.
	 *
	 * This is the FIRST PRD read path in the seam: `ledger-read.ts`/`scan.ts` read
	 * only `backlog`/`done`, NEVER `work/prd/`. It is added here
	 * so the §3a slug-namespace resolver, and later the autoslice / `do prd:` work,
	 * share ONE PRD read path rather than each growing a bespoke scan. Synchronous
	 * and OFFLINE (a working-tree read), like {@link resolveLocalState}.
	 */
	resolveBriefExistence(input: ResolveBriefExistenceInput): BriefExistence;
	/**
	 * Enumerate the repo's PRD pool from `work/prd/` (the auto-slice candidate
	 * source for the `do`/`run` "slices-first then PRDs to slice" priority, ADR
	 * §3). Returns every PRD's gate axes (`humanOnly`/`needsAnswers`/`briefAfter`)
	 * PLUS the set of already-SLICED slugs so the selection layer can resolve
	 * `briefAfter` against `work/prd-sliced/` residence (the FOLDER is the source of
	 * truth) and apply `autoslice-gate`'s
	 * predicate. This is the SAME PRD read path {@link resolveBriefExistence} uses,
	 * widened from a single-slug existence check to a full enumeration — NOT a
	 * second PRD reader. Synchronous and OFFLINE (a working-tree read), like
	 * {@link resolveLocalState}.
	 */
	resolveBriefPool(input: ResolveBriefPoolInput): LedgerBriefPool;
	/**
	 * Enumerate `work/tasks/backlog/*.md` (the TASK STAGING folder) into the SAME
	 * {@link LedgerTodoItem} shape `resolveLocalState().todo` returns for the pool
	 * — the SURFACE-on-staging widening (brief
	 * `staging-surface-and-apply-promote-safety` F2). Synchronous + OFFLINE
	 * (working-tree read), like {@link resolveLocalState}. The pool / staging
	 * folders are distinct durable status folders (one-slug-one-folder — a slug
	 * is in at most one), so the two reads compose without de-duplication
	 * gymnastics. Missing folder reads as empty. CONSUMED ONLY by the lifecycle
	 * GATHER under the `surfaceStaging` gate — the BUILD/claim pool stays
	 * pool-only (`resolveLocalState().todo`), untouched by this read.
	 */
	resolveLocalTaskStaging(input: ResolveLocalStateInput): LedgerTodoItem[];
	/**
	 * Enumerate `work/briefs/proposed/*.md` (the BRIEF STAGING folder) into the
	 * SAME {@link LedgerBriefItem} shape `resolvePrdPool().prds` returns for the
	 * pool — the BRIEF-symmetric `surfaceStaging` widening (brief
	 * `staging-surface-and-apply-promote-safety` F2, PRD q4 answer). Sync + OFFLINE.
	 */
	resolveLocalBriefStaging(input: ResolveBriefPoolInput): LedgerBriefItem[];
	/**
	 * Mirror-ref counterpart of {@link resolveLocalTaskStaging}: read
	 * `<ref>:work/tasks/backlog/*.md` from a BARE hub mirror via `git ls-tree` +
	 * `git show` (the SAME mechanism `resolveMirrorState` uses for the pool).
	 */
	resolveMirrorTaskStaging(
		input: ResolveMirrorStateInput,
	): Promise<LedgerTodoItem[]>;
	/**
	 * Mirror-ref counterpart of {@link resolveLocalBriefStaging}: read
	 * `<ref>:work/briefs/proposed/*.md` from a bare mirror.
	 */
	resolveMirrorBriefStaging(
		input: ResolveMirrorBriefPoolInput,
	): Promise<LedgerBriefItem[]>;
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
 * Read a folder of TASK items (`tasks-todo` or `tasks-backlog`) from the local
 * tree into the {@link LedgerTodoItem[]} shape. Factored so the POOL reader
 * (`tasks/todo`) and the STAGING reader (`tasks/backlog`, the `surfaceStaging`
 * widening) share one parse path — the two folders carry the SAME item shape
 * (frontmatter + body), only the trust polarity differs.
 */
function readLocalTaskFolder(
	repoPath: string,
	folder: 'tasks-todo' | 'tasks-backlog',
): LedgerTodoItem[] {
	const dir = workFolderPath(repoPath, folder);
	const items: LedgerTodoItem[] = [];
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

/** Read `work/tasks/todo/*.md` (the agent POOL) from the local tree, parsed and sorted by slug. */
function readLocalTodo(repoPath: string): LedgerTodoItem[] {
	return readLocalTaskFolder(repoPath, 'tasks-todo');
}

/**
 * Read `work/tasks/backlog/*.md` (the TASK STAGING folder, brief
 * `staging-surface-and-apply-promote-safety` F2) from the local tree. Same
 * {@link LedgerTodoItem} shape as the pool reader — the SURFACE-on-staging
 * widening only enumerates items; it does NOT promote them.
 */
function readLocalTaskStaging(repoPath: string): LedgerTodoItem[] {
	return readLocalTaskFolder(repoPath, 'tasks-backlog');
}

/**
 * Read `work/briefs/proposed/*.md` (the BRIEF STAGING folder, the brief twin
 * of {@link readLocalTaskStaging}, PRD q4 answer) from the local tree. Returns
 * the SAME {@link LedgerBriefItem} shape `resolvePrdPool().prds` returns.
 */
function readLocalBriefStaging(repoPath: string): LedgerBriefItem[] {
	const dir = workFolderPath(repoPath, 'briefs-proposed');
	const briefs: LedgerBriefItem[] = [];
	for (const file of listMarkdown(dir)) {
		const content = readFileSync(join(dir, file), 'utf8');
		const fm = parseFrontmatter(content);
		briefs.push({
			file,
			slug: fm.slug ?? basename(file, '.md'),
			humanOnly: fm.humanOnly,
			needsAnswers: fm.needsAnswers,
			briefAfter: fm.briefAfter,
		});
	}
	return briefs.sort((a, b) => a.slug.localeCompare(b.slug));
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
 * Read `work/observations/*.md` (slug-sorted) from the local tree.
 *
 * Identity rule (slice `observation-identity-is-its-filename-not-a-foreign-slug`):
 * an observation's IDENTITY is its FILENAME, NEVER a foreign frontmatter `slug:`.
 * Earlier this read `fm.slug ?? basename(file)`, which let the review-nits minting
 * (which wrote the REVIEWED SLICE's slug into `slug:` as a back-pointer) drive the
 * lifecycle pool to emit `obs:<reviewed-slug>` — a key that did not round-trip
 * through `findItemPath` (filename-only) and collided with the reviewed slice in
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
 * Does a PRD named `slug` exist in `<repoPath>/work/<folder>/`? A PRD source file
 * is `work/prd/*.md` (where a mid-slice PRD also rests — the `slicing/` folder is
 * retired); a sliced PRD rests at `work/prd-sliced/*.md` (the source of truth for
 * sliced-ness). We match the slug against each file's
 * frontmatter `slug:` (falling back to the filename) — the SAME shape the slice
 * readers use — so a renamed file whose frontmatter slug matches still resolves.
 * Returns the matching filename, or `undefined`.
 */
function findBriefFileBySlug(
	repoPath: string,
	folder: BriefFolder,
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
 * Enumerate `work/prd/*.md` into the auto-slice PRD pool (the slices-first/PRD
 * priority's PRD source) — the SAME PRD read path {@link findBriefFileBySlug} uses,
 * widened from a single-slug existence check to a full enumeration. Each PRD's
 * slug is resolved from frontmatter `slug:` (falling back to the filename) and
 * its gate axes (`humanOnly`/`needsAnswers`/`briefAfter`) parsed. The
 * already-SLICED set is RESIDENCE in `work/prd-sliced/` (slice
 * `prd-sliced-folder-step-a` / PRD `slicing-coherence` US #9): the FOLDER is the
 * source of truth (the build-machine `done/` analogue), so `briefAfter` resolves
 * against `prd-sliced/` residence (mirroring `blockedBy` -> `done/`). The `sliced:`
 * frontmatter marker was removed entirely in `remove-sliced-marker-step-b`. This
 * matches `tasking.ts`'s `readSlicedSlugs`. Missing folders read as empty.
 */
function readLocalBriefPool(repoPath: string): LocalBriefPool {
	const dir = workFolderPath(repoPath, 'briefs-ready');
	const briefs: LedgerBriefItem[] = [];
	for (const file of listMarkdown(dir)) {
		const content = readFileSync(join(dir, file), 'utf8');
		const fm = parseFrontmatter(content);
		briefs.push({
			file,
			slug: fm.slug ?? basename(file, '.md'),
			humanOnly: fm.humanOnly,
			needsAnswers: fm.needsAnswers,
			briefAfter: fm.briefAfter,
		});
	}
	briefs.sort((a, b) => a.slug.localeCompare(b.slug));

	// Sliced-ness is RESIDENCE in `work/prd-sliced/` — the FOLDER is the source of
	// truth, like `done/` for slices (the `sliced:` marker was removed in
	// `remove-sliced-marker-step-b`), mirroring tasking.ts's readSlicedSlugs. Missing
	// folder reads as empty.
	const taskedSlugs = new Set<string>();
	const taskedDir = workFolderPath(repoPath, 'briefs-tasked');
	for (const file of listMarkdown(taskedDir)) {
		const content = readFileSync(join(taskedDir, file), 'utf8');
		const fm = parseFrontmatter(content);
		taskedSlugs.add(fm.slug ?? basename(file, '.md'));
	}
	return {briefs, taskedSlugs};
}

/** Internal alias for {@link LedgerBriefPool} (kept local to the reader). */
type LocalBriefPool = LedgerBriefPool;

/** Run git, returning the raw result (no throw) — for soft checks. */
function gitSoft(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<RunResult> {
	return runAsync('git', args, cwd, {env});
}

/**
 * Read the slice file's contents from `<arbiter>/main`. It may live in `backlog/`
 * (the normal claim case) or `in-progress/` (start --resume); read whichever
 * exists. Returns `undefined` when the slice is not found there.
 */
async function readTaskOnArbiter(
	slug: string,
	arbiter: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string | undefined> {
	for (const folder of ['tasks-todo', 'in-progress'] as const) {
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
 * {@link LedgerTodoItem[]}, sorted by slug. Factored so the POOL + STAGING
 * mirror reads share ONE parse path (mirrors `readLocalTaskFolder`).
 */
async function readTaskFolderFromTree(
	folder: 'tasks-todo' | 'tasks-backlog',
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LedgerTodoItem[]> {
	const base = `${ref}:${workFolderRel(folder)}`;
	const items: LedgerTodoItem[] = [];
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

/** Parse `<ref>:work/tasks/todo/*.md` into pool items, sorted by slug. */
async function readTodoFromTree(
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LedgerTodoItem[]> {
	return readTaskFolderFromTree('tasks-todo', ref, cwd, env);
}

/** Parse `<ref>:work/tasks/backlog/*.md` (TASK STAGING) into items, sorted by slug. */
async function readTaskStagingFromTree(
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LedgerTodoItem[]> {
	return readTaskFolderFromTree('tasks-backlog', ref, cwd, env);
}

/** Parse `<ref>:work/briefs/proposed/*.md` (BRIEF STAGING) into PRD items, sorted by slug. */
async function readBriefStagingFromTree(
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LedgerBriefItem[]> {
	const base = `${ref}:${workFolderRel('briefs-proposed')}`;
	const briefs: LedgerBriefItem[] = [];
	for (const file of await listMarkdownInTree(base, cwd, env)) {
		const content = await showInTree(base, file, cwd, env);
		if (content === undefined) {
			continue;
		}
		const fm = parseFrontmatter(content);
		briefs.push({
			file,
			slug: fm.slug ?? basename(file, '.md'),
			humanOnly: fm.humanOnly,
			needsAnswers: fm.needsAnswers,
			briefAfter: fm.briefAfter,
		});
	}
	return briefs.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Parse `<ref>:work/prd/*.md` into the auto-slice PRD pool, sorted by slug, plus
 * the already-SLICED slugs from `<ref>:work/prd-sliced/` RESIDENCE (the folder is
 * the source of truth, mirroring the working-tree {@link readLocalBriefPool}). Reads
 * a committed tree (bare-mirror or any ref) via `ls-tree`/`show`. Missing folders
 * read as empty.
 */
async function readBriefPoolFromTree(
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LedgerBriefPool> {
	const briefBase = `${ref}:${workFolderRel('briefs-ready')}`;
	const briefs: LedgerBriefItem[] = [];
	for (const file of await listMarkdownInTree(briefBase, cwd, env)) {
		const content = await showInTree(briefBase, file, cwd, env);
		if (content === undefined) {
			continue;
		}
		const fm = parseFrontmatter(content);
		briefs.push({
			file,
			slug: fm.slug ?? basename(file, '.md'),
			humanOnly: fm.humanOnly,
			needsAnswers: fm.needsAnswers,
			briefAfter: fm.briefAfter,
		});
	}
	briefs.sort((a, b) => a.slug.localeCompare(b.slug));

	// Sliced-ness is RESIDENCE in `work/prd-sliced/` — the FOLDER is the source of
	// truth (the `sliced:` marker was removed in `remove-sliced-marker-step-b`),
	// exactly as the working-tree reader resolves it.
	const taskedBase = `${ref}:${workFolderRel('briefs-tasked')}`;
	const taskedSlugs = new Set<string>();
	for (const file of await listMarkdownInTree(taskedBase, cwd, env)) {
		const content = await showInTree(taskedBase, file, cwd, env);
		if (content === undefined) {
			continue;
		}
		const fm = parseFrontmatter(content);
		taskedSlugs.add(fm.slug ?? basename(file, '.md'));
	}
	return {briefs, taskedSlugs};
}

/**
 * Parse `<ref>:work/observations/*.md` into items, sorted by slug. Identity is the
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
			todo: readLocalTodo(repoPath),
			doneSlugs: readLocalDoneSlugs(repoPath),
			observations: readLocalObservations(repoPath),
		};
	},
	async resolveArbiterState({slug, cwd, arbiter, env}) {
		const task = await readTaskOnArbiter(slug, arbiter, cwd, env);
		const doneSlugs = await readDoneSlugsOnArbiter(arbiter, cwd, env);
		return {task, doneSlugs};
	},
	resolveBriefExistence({repoPath, slug}) {
		const briefFile = findBriefFileBySlug(repoPath, 'briefs-ready', slug);
		const briefTaskedFile = findBriefFileBySlug(
			repoPath,
			'briefs-tasked',
			slug,
		);
		return {
			exists: briefFile !== undefined || briefTaskedFile !== undefined,
			briefFile,
			briefTaskedFile,
		};
	},
	resolveBriefPool({repoPath}) {
		return readLocalBriefPool(repoPath);
	},
	resolveLocalTaskStaging({repoPath}) {
		return readLocalTaskStaging(repoPath);
	},
	resolveLocalBriefStaging({repoPath}) {
		return readLocalBriefStaging(repoPath);
	},
	async resolveMirrorTaskStaging({mirrorPath, ref = 'main', env}) {
		return readTaskStagingFromTree(ref, mirrorPath, env);
	},
	async resolveMirrorBriefStaging({mirrorPath, ref = 'main', env}) {
		return readBriefStagingFromTree(ref, mirrorPath, env);
	},
	async resolveMirrorState({mirrorPath, ref = 'main', env}) {
		// A hub mirror is BARE — read the full `work/` lifecycle from its committed
		// `<ref>:work/...` tree, running git INSIDE the mirror (`git -C <mirror>`).
		// The ref is mirror-LOCAL (`main`), never `origin/main`.
		const [todo, doneSlugs, observations] = await Promise.all([
			readTodoFromTree(ref, mirrorPath, env),
			readDoneSlugsFromTree(ref, mirrorPath, env),
			readObservationsFromTree(ref, mirrorPath, env),
		]);
		return {todo, doneSlugs, observations};
	},
	async resolveMirrorBriefPool({mirrorPath, ref = 'main', env}) {
		// The PRD pool from the bare mirror's committed `<ref>:work/prd*` tree — the
		// mirror-ref counterpart of `resolvePrdPool` (a working-tree read). Same shape,
		// so `taskableBriefs` applies identically to either source.
		return readBriefPoolFromTree(ref, mirrorPath, env);
	},
};

/**
 * The active ledger-read strategy. There is exactly one (current behaviour);
 * this indirection is the seam's single insertion point — NOT a selectable mode.
 */
export const ledgerRead: LedgerReadStrategy = currentLedgerRead;
