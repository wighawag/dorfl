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
 * The seam is honest about the TWO real read sources rather than pretending they
 * are one (per the ADR — do not collapse them):
 *
 *   - **local working tree** — `scan` reads `work/backlog|done|needs-attention`
 *     from the local checkout. OFFLINE. This is the fast cross-repo queue.
 *   - **arbiter `main`** — the human claim guard (`readiness`) and the claim CAS
 *     read the slice + `work/done/` from `<arbiter>/main`.
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
 * The read-seam interface: ONE entry with TWO resolve-methods. The local method
 * is synchronous and OFFLINE; the arbiter method is async (it shells out to git).
 * A future strategy implements this same interface to resolve some states
 * elsewhere — without any reader changing.
 */
export interface LedgerReadStrategy {
	/** Resolve a repo's live `work/` state from its LOCAL working tree (offline). */
	resolveLocalState(input: ResolveLocalStateInput): LocalLedgerState;
	/** Resolve a repo's live `work/` state from the ARBITER (`<arbiter>/main`). */
	resolveArbiterState(
		input: ResolveArbiterStateInput,
	): Promise<ArbiterLedgerState>;
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
	const slugs = new Set<string>();
	const tree = await gitSoft(
		['ls-tree', '--name-only', `${arbiter}/main:work/done`],
		cwd,
		env,
	);
	if (tree.status !== 0) {
		// No `work/done/` on the arbiter yet — nothing is done.
		return slugs;
	}
	for (const name of tree.stdout.split('\n')) {
		const file = name.trim();
		if (file.toLowerCase().endsWith('.md')) {
			slugs.add(file.slice(0, -'.md'.length));
		}
	}
	return slugs;
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
};

/**
 * The active ledger-read strategy. There is exactly one (current behaviour);
 * this indirection is the seam's single insertion point — NOT a selectable mode.
 */
export const ledgerRead: LedgerReadStrategy = currentLedgerRead;
