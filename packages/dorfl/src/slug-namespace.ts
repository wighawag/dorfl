import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';

/**
 * The **§3a slug-namespace resolver** (`docs/adr/command-surface-and-
 * journeys.md` §3a). A prd and a task can share a slug (e.g. prd `auto-slice`),
 * and `do` spans BOTH namespaces (build a task OR task a prd), so a bare slug
 * is ambiguous. This module is the pure resolver that turns a CLI slug argument
 * into a resolved target, plus the guard the TASK-ONLY commands use to reject a
 * `prd:` argument.
 *
 * | input            | resolves to     | on collision (a task AND a prd share `<slug>`) |
 * | ---------------- | --------------- | ----------------------------------------------- |
 * | `<slug>` (bare)  | the **task**    | **ERROR** — "use task:<slug> or prd:<slug>"   |
 * | `task:<slug>`    | the task        | always unambiguous                              |
 * | `prd:<slug>`   | the prd       | always unambiguous                              |
 *
 * The two load-bearing rules:
 *
 *   - **Bare `<slug>` is human convenience ONLY.** It resolves to the task, but
 *     ONLY after a cheap cross-namespace existence check confirms NO prd shares
 *     the slug; on a collision it ERRORS loudly (it never silently guesses). CI /
 *     automation MUST use explicit prefixes (collision-proof across time).
 *   - **Task-only commands** (`claim`, `start`, `resume`, `complete`, `prompt`,
 *     `requeue`, `work-on`) accept bare (= task) + `task:` and **reject `prd:`**
 *     with a clear "operates on tasks, not prds" error.
 *
 * It is PURE: no git, no mutation, no side effects beyond the two cheap EXISTENCE
 * reads (task through the existing read seam; prd through the seam's new
 * `resolvePrdExistence` prd reader — the single shared prd read path the later
 * tasking / `do prd:` work reuses).
 *
 * This mirrors the field-level namespace split the contract already makes (task
 * `blockedBy` resolves against tasks; prd `taskedAfter` against prds); the
 * `task:`/`prd:` prefixes are the command-line form of that one rule.
 */

/**
 * The namespaces a slug can name. `task`/`prd` are the original §3a pair that
 * `do` spans (renamed from `task`/`prd` in the hard cutover); `observation` is
 * the NEW namespace the `advance` verb adds (prd `advance-loop`, task
 * `advance-verb-resolver`) so `advance obs:<slug>` can name an observation to
 * triage. The `do`-family resolvers (`resolveSlug`, `resolveTaskOnlyArg`)
 * deliberately do NOT span `observation` — only the `advance` resolver does (see
 * {@link resolveAdvanceArg}).
 */
/**
 * EXPAND step (prd `prd-to-spec-vocabulary-cutover-and-migration-command`): the
 * parent-spec namespace is being renamed `prd → spec`. Both literals are members
 * BESIDE each other through the cutover so every existing site that emits or reads
 * `'prd'` keeps compiling; the migrate batches move call sites onto `'spec'` one
 * at a time, and the contract task removes `'prd'`. `spec:<slug>` and `prd:<slug>`
 * both resolve; `work/spec-<slug>` and `work/prd-<slug>` branch refs both parse.
 */
export type SlugNamespace = 'task' | 'spec' | 'prd' | 'observation';

/**
 * The PRODUCER axis (ORTHOGONAL to {@link SlugNamespace}): WHICH lifecycle
 * created the branch, when that matters for collision isolation. `'intake'` is
 * the only producer today — an `intake N` run that CREATES a brand-new backlog
 * item (`work/backlog/<slug>.md`) or prd (`work/prds/<slug>.md`). Its branch is a
 * short-lived "create the item" branch, a SEPARATE lifecycle from the later
 * claim→build→complete of `do task:<slug>` — so it gets its own branch ref and
 * never reuses (or is reused by) the build branch for the same slug. Absent for
 * the build/tasking paths (the common case), which carry no producer prefix.
 */
export type BranchProducer = 'intake';

/**
 * The **ONE** construction of the work-BRANCH ref from the namespaced identity.
 * The branch ref is the last identity to join the `<type>-<slug>` scheme the
 * advance sidecar filename (`work/questions/<type>-<slug>.md`) and the
 * lock entry already use — so a prd `<slug>` and a task `<slug>`
 * sharing a slug NEVER collide on the arbiter branch (the structural bug this
 * fixes: `intake`, `do task:<slug>`, and `do prd:<slug>` all built on the SAME
 * un-namespaced `work/<slug>` branch).
 *
 * Spelling: `work/<type>-<slug>` (i.e. `work/task-<slug>`, `work/prd-<slug>`),
 * matching the lock-entry + sidecar-filename `<type>-<slug>` form EXACTLY. The
 * optional {@link BranchProducer} prefixes it (`work/<producer>-<type>-<slug>`,
 * e.g. `work/intake-task-<slug>`, `work/intake-prd-<slug>`) so a branch that
 * CREATES an item (intake) never collides with the branch that later BUILDS the
 * same-slug task. One consistent rule, not a second derivation. EVERY site
 * that builds or reads a work-branch ref MUST call this (or
 * {@link parseWorkBranchRef}); none may hand-build `work/${slug}`.
 */
export function workBranchRef(
	namespace: SlugNamespace,
	slug: string,
	opts?: {producer?: BranchProducer},
): string {
	const producer = opts?.producer;
	return producer === undefined
		? `work/${namespace}-${slug}`
		: `work/${producer}-${namespace}-${slug}`;
}

/**
 * The inverse of {@link workBranchRef}: parse a namespaced work-branch ref back
 * into its `{producer?, namespace, slug}`. Returns `undefined` for any ref that
 * is NOT a `work/[<producer>-]<type>-<slug>` branch (e.g. `main`, a detached
 * HEAD, or — after the clean breaking cutover — a pre-rename `work/task-<slug>`
 * / `work/prd-<slug>` ref or an un-namespaced `work/<slug>`). This is how
 * `complete`/`integration` recover the type carried IN the branch name they are
 * already standing on, rather than re-deriving it inconsistently. The regex
 * anchors the optional producer prefix BEFORE the type alternation, so
 * `work/intake-task-foo` resolves to
 * `{producer:'intake', namespace:'task', slug:'foo'}` (the `slug` never
 * swallows the `intake-`/`task-` prefixes). The old `task`/`prd` types are NOT
 * in the alternation, so a pre-rename `work/slice-foo` ref returns `undefined`
 * (the clean-break stance: no migration-window alias).
 */
export function parseWorkBranchRef(
	branch: string,
):
	| {producer?: BranchProducer; namespace: SlugNamespace; slug: string}
	| undefined {
	// EXPAND step (prd `prd-to-spec-vocabulary-cutover-and-migration-command`):
	// accept BOTH the new `spec` type token and the legacy `prd` token in the
	// alternation so `work/spec-<slug>` and `work/prd-<slug>` both parse. A
	// `work/prd-<slug>` ref still resolves to `{namespace: 'prd'}` (unchanged); a
	// `work/spec-<slug>` ref resolves to `{namespace: 'spec'}`. The contract task
	// drops the `prd` alternative.
	const match = /^work\/(?:(intake)-)?(task|spec|prd)-(.+)$/.exec(branch);
	if (!match) {
		return undefined;
	}
	const producer = match[1] as BranchProducer | undefined;
	const result: {
		producer?: BranchProducer;
		namespace: SlugNamespace;
		slug: string;
	} = {namespace: match[2] as SlugNamespace, slug: match[3]};
	if (producer !== undefined) {
		result.producer = producer;
	}
	return result;
}

/** A slug argument's parsed namespace + bare slug (before any existence check). */
export interface ParsedSlugArg {
	/**
	 * `'task'` / `'prd'` when an explicit prefix was given; `undefined` for a
	 * bare slug (the namespace is then resolved by the cross-namespace check).
	 */
	explicit: SlugNamespace | undefined;
	/** The bare slug with any `task:`/`prd:` prefix stripped. */
	slug: string;
}

/** A fully-resolved slug target: which namespace it names + the bare slug. */
export interface ResolvedSlug {
	namespace: SlugNamespace;
	slug: string;
	/** Whether the caller wrote an explicit `task:`/`prd:` prefix. */
	explicit: boolean;
}

/** The explicit-prefix forms the resolver understands. */
const TASK_PREFIX = 'task:';
/**
 * EXPAND step (prd `prd-to-spec-vocabulary-cutover-and-migration-command`): the
 * new canonical `spec:` prefix beside the legacy `prd:` prefix. Both parse to the
 * parent-spec namespace — `spec:<slug>` → `{explicit: 'spec'}`, `prd:<slug>` →
 * `{explicit: 'prd'}` — so a caller may write either through the cutover. The
 * contract task removes `PRD_PREFIX`.
 */
const SPEC_PREFIX = 'spec:';
const PRD_PREFIX = 'prd:';
/**
 * The observation namespace's prefixes: the short `obs:` CLI alias and the
 * canonical `observation:` long form both parse to the `observation` namespace.
 * Only the `advance` resolver acts on this namespace; `do` rejects it.
 */
const OBS_PREFIX = 'obs:';
const OBSERVATION_PREFIX = 'observation:';

/**
 * Raised when a slug argument cannot be resolved: an ambiguous bare slug
 * (collision across namespaces), or a `prd:` argument handed to a task-only
 * command. Carries a clear, human-resolvable message.
 */
export class SlugResolutionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SlugResolutionError';
	}
}

/**
 * Split a raw CLI slug argument into its explicit namespace (if any) + the bare
 * slug. PURE string work, no existence check: `task:foo` → explicit task,
 * `prd:foo` → explicit prd, `foo` → bare (`explicit: undefined`). The prefix
 * match is case-sensitive and exact (`task:`/`prd:`); a slug like `tasked` is
 * NOT a prefix and stays bare.
 */
export function parseSlugArg(arg: string): ParsedSlugArg {
	if (arg.startsWith(TASK_PREFIX)) {
		return {explicit: 'task', slug: arg.slice(TASK_PREFIX.length)};
	}
	if (arg.startsWith(SPEC_PREFIX)) {
		return {explicit: 'spec', slug: arg.slice(SPEC_PREFIX.length)};
	}
	if (arg.startsWith(PRD_PREFIX)) {
		return {explicit: 'prd', slug: arg.slice(PRD_PREFIX.length)};
	}
	if (arg.startsWith(OBSERVATION_PREFIX)) {
		return {
			explicit: 'observation',
			slug: arg.slice(OBSERVATION_PREFIX.length),
		};
	}
	if (arg.startsWith(OBS_PREFIX)) {
		return {explicit: 'observation', slug: arg.slice(OBS_PREFIX.length)};
	}
	return {explicit: undefined, slug: arg};
}

/** What the resolver needs to perform the existence checks. */
export interface ResolveSlugInput {
	/** The raw CLI slug argument (bare, `task:<slug>`, or `prd:<slug>`). */
	arg: string;
	/** The repo working-tree root whose `work/` namespaces to read. */
	repoPath: string;
	/**
	 * The read seam to resolve existence through (task via `resolveLocalState`,
	 * prd via `resolvePrdExistence`). Defaults to the active {@link ledgerRead};
	 * injectable for tests.
	 */
	read?: LedgerReadStrategy;
}

/** Does a TASK named `slug` exist (backlog or in-progress) in this repo? */
function taskExists(
	read: LedgerReadStrategy,
	repoPath: string,
	slug: string,
): boolean {
	// The task side resolves THROUGH the existing read seam — its local-tree
	// method already parses the task-pool slugs (frontmatter, falling back
	// to filename). An in-progress task is ALSO a task (a claimed one); the
	// local state's backlog covers the up-for-grabs case, which is what a bare
	// `<slug>` collision check needs.
	const state = read.resolveLocalState({repoPath});
	return state.ready.some((item) => item.slug === slug);
}

/** Does a PRD named `slug` exist (ready or being tasked) in this repo? */
function prdExists(
	read: LedgerReadStrategy,
	repoPath: string,
	slug: string,
): boolean {
	return read.resolvePrdExistence({repoPath, slug}).exists;
}

/**
 * Resolve a raw slug argument (`do`'s cross-namespace path) into its namespace +
 * bare slug, per ADR §3a:
 *
 *   - `task:<slug>`  → `{namespace: 'task'}`  — always unambiguous (no check).
 *   - `prd:<slug>` → `{namespace: 'prd'}` — always unambiguous (no check).
 *   - `<slug>` (bare) → the **task**, but ONLY after confirming no prd shares the
 *     slug. On a collision (both a task AND a prd named `<slug>` exist) it throws
 *     {@link SlugResolutionError} — loud, immediate, human-resolvable. It NEVER
 *     silently guesses.
 *
 * Explicit prefixes skip the existence check entirely (they are collision-proof
 * by construction); only the bare path pays the cheap cross-namespace read.
 */
export function resolveSlug(input: ResolveSlugInput): ResolvedSlug {
	const read = input.read ?? ledgerRead;
	const parsed = parseSlugArg(input.arg);

	if (parsed.explicit === 'observation') {
		// `do` spans the task/prd namespaces ONLY (build a task OR task a prd).
		// The `observation` namespace is `advance`'s alone (triage). Reject it here
		// rather than let a `do obs:<slug>` resolve into a namespace `do` cannot act
		// on — point the human at the verb that owns it.
		throw new SlugResolutionError(
			`'${input.arg}' names an observation, which \`do\` does not act on. ` +
				`Use \`advance obs:${parsed.slug}\` to triage it.`,
		);
	}
	if (parsed.explicit !== undefined) {
		// Explicit prefix: unambiguous by construction. No existence check.
		return {namespace: parsed.explicit, slug: parsed.slug, explicit: true};
	}

	// Bare slug: resolve to the task, but ONLY after the cross-namespace check.
	// A task/prd collision is a loud ERROR — never a silent guess.
	if (prdExists(read, input.repoPath, parsed.slug)) {
		throw new SlugResolutionError(
			`'${parsed.slug}' is ambiguous: both a task and a prd share that slug. ` +
				`Use \`task:${parsed.slug}\` or \`prd:${parsed.slug}\` to disambiguate.`,
		);
	}
	return {namespace: 'task', slug: parsed.slug, explicit: false};
}

/**
 * Resolve a slug argument for the `advance` verb (prd `advance-loop`, task
 * `advance-verb-resolver`). `advance` is the SIBLING top-level verb (NOT a `do`
 * subcommand) that reuses this SAME shared `prefix:arg` resolver, EXTENDED with
 * the `observation` namespace `do` does not span:
 *
 *   - `task:<slug>`        → `{namespace: 'task'}`        — unambiguous (no check).
 *   - `prd:<slug>`       → `{namespace: 'prd'}`       — unambiguous (no check).
 *   - `obs:<slug>` /
 *     `observation:<slug>`  → `{namespace: 'observation'}` — unambiguous (no check).
 *   - `<slug>` (bare)      → the **task**, but ONLY after the SAME cheap
 *     cross-namespace check `do` makes (no prd shares the slug); on a task/prd
 *     collision it throws {@link SlugResolutionError}, never silently guessing.
 *
 * The bare-slug cross-check is intentionally IDENTICAL to {@link resolveSlug}'s
 * (bare = task, error on a task/prd collision) — the "bare slug = task"
 * ergonomic is preserved exactly as `do` has it. An observation is NEVER reached
 * by a bare slug; it must be named explicitly (`obs:<slug>`), because the bare
 * path stays the task/prd two-namespace check (an observation sharing a slug
 * does not make a bare slug ambiguous — a human typing a bare slug means the
 * task, as everywhere else).
 */
export function resolveAdvanceArg(input: ResolveSlugInput): ResolvedSlug {
	const read = input.read ?? ledgerRead;
	const parsed = parseSlugArg(input.arg);

	if (parsed.explicit !== undefined) {
		// Explicit prefix (task / prd / observation): unambiguous by construction.
		return {namespace: parsed.explicit, slug: parsed.slug, explicit: true};
	}

	// Bare slug: the SAME task/prd cross-namespace check `do` makes — bare = task,
	// a task/prd collision is a loud ERROR, never a silent guess.
	if (prdExists(read, input.repoPath, parsed.slug)) {
		throw new SlugResolutionError(
			`'${parsed.slug}' is ambiguous: both a task and a prd share that slug. ` +
				`Use \`task:${parsed.slug}\` or \`prd:${parsed.slug}\` to disambiguate.`,
		);
	}
	return {namespace: 'task', slug: parsed.slug, explicit: false};
}

/**
 * Resolve a slug argument for a TASK-ONLY command (`claim`, `start`, `resume`,
 * `complete`, `prompt`, `requeue`, `work-on`). These operate on tasks, not prds,
 * so:
 *
 *   - `prd:<slug>` is REJECTED with a clear "operates on tasks, not prds" error.
 *   - `task:<slug>` is accepted (the explicit alias) → the bare slug.
 *   - `<slug>` (bare) is accepted (= the task). A task-only command does NOT
 *     need the cross-namespace collision check: a bare slug here ALWAYS means the
 *     task (there is no prd ambiguity, because the prd namespace is rejected
 *     outright), so it resolves straight to the task slug.
 *
 * Returns the bare task slug to feed the existing task machinery (claim CAS,
 * start, …). PURE: it touches no files (no existence read needed — `prd:` is
 * rejected on the prefix alone, bare/`task:` resolve to the task slug).
 */
export function resolveTaskOnlyArg(arg: string): string {
	const parsed = parseSlugArg(arg);
	if (parsed.explicit === 'prd') {
		throw new SlugResolutionError(
			`this command operates on tasks, not prds — '${arg}' names a prd. ` +
				`Drop the \`prd:\` prefix to act on the task, or use \`do ${arg}\` ` +
				`to task the prd.`,
		);
	}
	if (parsed.explicit === 'spec') {
		// EXPAND step (prd `prd-to-spec-vocabulary-cutover-and-migration-command`): a
		// `spec:` argument is rejected BESIDE the legacy `prd:` argument (both name
		// the parent-spec namespace, which task-only commands do not act on). Kept a
		// SEPARATE branch so the legacy `prd:` message stays byte-identical; the
		// contract task collapses the two.
		throw new SlugResolutionError(
			`this command operates on tasks, not specs — '${arg}' names a spec. ` +
				`Drop the \`spec:\` prefix to act on the task, or use \`do ${arg}\` ` +
				`to task the spec.`,
		);
	}
	if (parsed.explicit === 'observation') {
		throw new SlugResolutionError(
			`this command operates on tasks, not observations — '${arg}' names an ` +
				`observation. Use \`advance obs:${parsed.slug}\` to triage it.`,
		);
	}
	// Bare or `task:` → the task slug. (A bare slug on a task-only command is
	// unambiguously the task; the prd namespace is unreachable here.)
	return parsed.slug;
}
