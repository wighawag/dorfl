import {readdirSync, readFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {parseFrontmatter} from './frontmatter.js';
import {runAsync, type RunResult} from './git.js';

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
 *   - **local working tree** — a working clone reads `work/backlog|done|
 *     needs-attention` from its checkout. OFFLINE. (Pre-registry `scan`/`status`
 *     used this; `run`'s in-place checkouts still do.)
 *   - **arbiter `main`** — the human claim guard (`readiness`) and the claim CAS
 *     read the slice + `work/done/` from `<arbiter>/main`.
 *   - **hub mirror `main`** — `scan`/`status` (registry model, ADR §1) read the
 *     full `work/` lifecycle from each BARE hub mirror's `main` ref. A mirror has
 *     no working tree, so this reads the committed tree via `git ls-tree`/`git
 *     show` (the SAME mechanism the arbiter `done/` read uses, widened to the
 *     full backlog + needs-attention set).
 *
 * The signatures stay at the SEMANTIC level ("resolve live state") and storage-
 * agnostic: the ONLY public distinction is local-vs-arbiter (no `main`/path is
 * baked into the public shape beyond that). `gc` is NOT a consumer — its `work/`
 * reads are job-WORKTREE discovery under `<workspacesDir>/work/*` (the execution
 * substrate), not the `work/` lifecycle ledger this seam resolves, so it has no
 * applicable read to route here.
 */

/** One backlog item's parsed gate/deps, as resolved from the live `work/` state. */
export interface LedgerBacklogItem {
	/** Filename within `work/backlog/` (e.g. `scan.md`). */
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
 * and where. A PRD lives at `work/prd/<slug>.md`; once sliced its slicing record
 * lives at `work/slicing/<slug>.md`. Both are consulted (either is enough). The
 * slug is resolved from frontmatter `slug:`, falling back to the filename — the
 * SAME shape the slice readers use.
 */
export interface PrdExistence {
	/** Whether a PRD named `<slug>` exists in `work/prd/` and/or `work/slicing/`. */
	exists: boolean;
	/** The PRD source file, when present (`work/prd/<slug>.md`). */
	prdFile: string | undefined;
	/** The slicing record, when present (`work/slicing/<slug>.md`). */
	slicingFile: string | undefined;
}

/** One needs-attention item's surface fields, as resolved from the live state. */
export interface LedgerNeedsAttentionItem {
	/** Filename within `work/needs-attention/` (e.g. `alpha.md`). */
	file: string;
	/** Resolved slug (frontmatter `slug:`, falling back to the filename). */
	slug: string;
	/** Raw file contents (the reader extracts the reason prose from the body). */
	content: string;
}

/**
 * The live `work/` lifecycle state of ONE repo as resolved from the LOCAL
 * working tree. Storage-agnostic in shape: it is "the resolved state", not "the
 * files on disk".
 */
export interface LocalLedgerState {
	/** Parsed `work/backlog/*.md`, sorted by slug. */
	backlog: LedgerBacklogItem[];
	/** Slugs present in `work/done/` (per-repo; resolves `blockedBy`). */
	doneSlugs: Set<string>;
	/** `work/needs-attention/*.md` surface items, sorted by filename. */
	needsAttention: LedgerNeedsAttentionItem[];
}

/** The live `work/` state of ONE repo as resolved from the arbiter. */
export interface ArbiterLedgerState {
	/**
	 * The requested slice's raw file contents from the arbiter (it may live in
	 * `backlog/` or `in-progress/`), or `undefined` when not found there.
	 */
	slice: string | undefined;
	/** Slugs present in `work/done/` on the arbiter (per-repo; resolves `blockedBy`). */
	doneSlugs: Set<string>;
}

/** What the LOCAL-tree resolve method needs: which repo checkout to read. */
export interface ResolveLocalStateInput {
	/** The repo working-tree root whose `work/` state to resolve. */
	repoPath: string;
}

/** What the PRD-existence resolve method needs: which repo + which slug. */
export interface ResolvePrdExistenceInput {
	/** The repo working-tree root whose `work/prd/`+`work/slicing/` to read. */
	repoPath: string;
	/** The slug to look up (matched against frontmatter `slug:`, then filename). */
	slug: string;
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
	 * Resolve the FULL live `work/` lifecycle (backlog + done + needs-attention)
	 * of a repo from its BARE hub mirror's `main` ref. Mirrors have no working
	 * tree, so `resolveLocalState`'s `readdirSync`/`readFileSync` cannot read them
	 * — this reads the committed tree via `git ls-tree`/`git show` (the same
	 * mechanism the arbiter method uses for `done/`, widened to the full set).
	 */
	resolveMirrorState(input: ResolveMirrorStateInput): Promise<LocalLedgerState>;
	/**
	 * Resolve whether a PRD named `<slug>` exists in the LOCAL working tree's
	 * `work/prd/` (the PRD source) and/or `work/slicing/` (its post-slice record).
	 * The slug is resolved from each candidate file's frontmatter `slug:`, falling
	 * back to the filename — the SAME shape the slice readers use.
	 *
	 * This is the FIRST PRD read path in the seam: `ledger-read.ts`/`scan.ts` read
	 * only `backlog`/`done`/`needs-attention`, NEVER `work/prd/`. It is added here
	 * so the §3a slug-namespace resolver, and later the autoslice / `do prd:` work,
	 * share ONE PRD read path rather than each growing a bespoke scan. Synchronous
	 * and OFFLINE (a working-tree read), like {@link resolveLocalState}.
	 */
	resolvePrdExistence(input: ResolvePrdExistenceInput): PrdExistence;
}

// --- The sole strategy: exactly today's behaviour -------------------------

function listMarkdown(dir: string): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries.filter((name) => name.toLowerCase().endsWith('.md')).sort();
}

function slugForFile(dir: string, file: string): string {
	const content = readFileSync(join(dir, file), 'utf8');
	const fm = parseFrontmatter(content);
	return fm.slug ?? basename(file, '.md');
}

/** Read `work/backlog/*.md` from the local tree, parsed and sorted by slug. */
function readLocalBacklog(repoPath: string): LedgerBacklogItem[] {
	const dir = join(repoPath, 'work', 'backlog');
	const items: LedgerBacklogItem[] = [];
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

/** Collect the slugs present in `work/done/` on the local tree. */
function readLocalDoneSlugs(repoPath: string): Set<string> {
	const dir = join(repoPath, 'work', 'done');
	const slugs = new Set<string>();
	for (const file of listMarkdown(dir)) {
		slugs.add(slugForFile(dir, file));
	}
	return slugs;
}

/** Read `work/needs-attention/*.md` (filename-sorted) from the local tree. */
function readLocalNeedsAttention(repoPath: string): LedgerNeedsAttentionItem[] {
	const dir = join(repoPath, 'work', 'needs-attention');
	const items: LedgerNeedsAttentionItem[] = [];
	for (const file of listMarkdown(dir)) {
		const content = readFileSync(join(dir, file), 'utf8');
		const fm = parseFrontmatter(content);
		items.push({
			file,
			slug: fm.slug ?? basename(file, '.md'),
			content,
		});
	}
	return items;
}

/**
 * Does a PRD named `slug` exist in `<repoPath>/work/<folder>/`? A PRD source file
 * is `work/prd/*.md`; its post-slice record is `work/slicing/*.md`. We match the
 * slug against each file's frontmatter `slug:` (falling back to the filename) —
 * the SAME shape the slice readers use — so a renamed file whose frontmatter slug
 * matches still resolves. Returns the matching filename, or `undefined`.
 */
function findPrdFileBySlug(
	repoPath: string,
	folder: 'prd' | 'slicing',
	slug: string,
): string | undefined {
	const dir = join(repoPath, 'work', folder);
	for (const file of listMarkdown(dir)) {
		if (slugForFile(dir, file) === slug) {
			return file;
		}
	}
	return undefined;
}

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
async function readSliceOnArbiter(
	slug: string,
	arbiter: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<string | undefined> {
	for (const folder of ['backlog', 'in-progress'] as const) {
		const object = `${arbiter}/main:work/${folder}/${slug}.md`;
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
// These helpers read `work/{backlog,done,needs-attention}` from a git REF via
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
		.filter((name) => name.toLowerCase().endsWith('.md'))
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
	for (const file of await listMarkdownInTree(`${ref}:work/done`, cwd, env)) {
		slugs.add(file.slice(0, -'.md'.length));
	}
	return slugs;
}

/** Parse `<ref>:work/backlog/*.md` into backlog items, sorted by slug. */
async function readBacklogFromTree(
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LedgerBacklogItem[]> {
	const base = `${ref}:work/backlog`;
	const items: LedgerBacklogItem[] = [];
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

/** Parse `<ref>:work/needs-attention/*.md` into items, sorted by filename. */
async function readNeedsAttentionFromTree(
	ref: string,
	cwd: string,
	env: NodeJS.ProcessEnv | undefined,
): Promise<LedgerNeedsAttentionItem[]> {
	const base = `${ref}:work/needs-attention`;
	const items: LedgerNeedsAttentionItem[] = [];
	for (const file of await listMarkdownInTree(base, cwd, env)) {
		const content = await showInTree(base, file, cwd, env);
		if (content === undefined) {
			continue;
		}
		const fm = parseFrontmatter(content);
		items.push({file, slug: fm.slug ?? basename(file, '.md'), content});
	}
	return items;
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
			backlog: readLocalBacklog(repoPath),
			doneSlugs: readLocalDoneSlugs(repoPath),
			needsAttention: readLocalNeedsAttention(repoPath),
		};
	},
	async resolveArbiterState({slug, cwd, arbiter, env}) {
		const slice = await readSliceOnArbiter(slug, arbiter, cwd, env);
		const doneSlugs = await readDoneSlugsOnArbiter(arbiter, cwd, env);
		return {slice, doneSlugs};
	},
	resolvePrdExistence({repoPath, slug}) {
		const prdFile = findPrdFileBySlug(repoPath, 'prd', slug);
		const slicingFile = findPrdFileBySlug(repoPath, 'slicing', slug);
		return {
			exists: prdFile !== undefined || slicingFile !== undefined,
			prdFile,
			slicingFile,
		};
	},
	async resolveMirrorState({mirrorPath, ref = 'main', env}) {
		// A hub mirror is BARE — read the full `work/` lifecycle from its committed
		// `<ref>:work/...` tree, running git INSIDE the mirror (`git -C <mirror>`).
		// The ref is mirror-LOCAL (`main`), never `origin/main`.
		const [backlog, doneSlugs, needsAttention] = await Promise.all([
			readBacklogFromTree(ref, mirrorPath, env),
			readDoneSlugsFromTree(ref, mirrorPath, env),
			readNeedsAttentionFromTree(ref, mirrorPath, env),
		]);
		return {backlog, doneSlugs, needsAttention};
	},
};

/**
 * The active ledger-read strategy. There is exactly one (current behaviour);
 * this indirection is the seam's single insertion point — NOT a selectable mode.
 */
export const ledgerRead: LedgerReadStrategy = currentLedgerRead;
