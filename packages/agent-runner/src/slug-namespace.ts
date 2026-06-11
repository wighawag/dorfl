import {ledgerRead, type LedgerReadStrategy} from './ledger-read.js';

/**
 * The **§3a slug-namespace resolver** (`docs/adr/command-surface-and-
 * journeys.md` §3a). A PRD and a slice can share a slug (e.g. PRD `auto-slice`),
 * and `do` spans BOTH namespaces (build a slice OR slice a PRD), so a bare slug
 * is ambiguous. This module is the pure resolver that turns a CLI slug argument
 * into a resolved target, plus the guard the SLICE-ONLY commands use to reject a
 * `prd:` argument.
 *
 * | input            | resolves to     | on collision (a slice AND a PRD share `<slug>`) |
 * | ---------------- | --------------- | ----------------------------------------------- |
 * | `<slug>` (bare)  | the **slice**   | **ERROR** — "use slice:<slug> or prd:<slug>"    |
 * | `slice:<slug>`   | the slice       | always unambiguous                              |
 * | `prd:<slug>`     | the PRD         | always unambiguous                              |
 *
 * The two load-bearing rules:
 *
 *   - **Bare `<slug>` is human convenience ONLY.** It resolves to the slice, but
 *     ONLY after a cheap cross-namespace existence check confirms NO PRD shares
 *     the slug; on a collision it ERRORS loudly (it never silently guesses). CI /
 *     automation MUST use explicit prefixes (collision-proof across time).
 *   - **Slice-only commands** (`claim`, `start`, `resume`, `complete`, `prompt`,
 *     `requeue`, `work-on`) accept bare (= slice) + `slice:` and **reject `prd:`**
 *     with a clear "operates on slices, not PRDs" error.
 *
 * It is PURE: no git, no mutation, no side effects beyond the two cheap EXISTENCE
 * reads (slice through the existing read seam; PRD through the seam's new
 * `resolvePrdExistence` PRD reader — the single shared PRD read path the later
 * autoslice / `do prd:` work reuses).
 *
 * This mirrors the field-level namespace split the contract already makes (slice
 * `blockedBy` resolves against slices; PRD `sliceAfter` against PRDs); the
 * `slice:`/`prd:` prefixes are the command-line form of that one rule.
 */

/** The two namespaces a slug can name. */
export type SlugNamespace = 'slice' | 'prd';

/**
 * The PRODUCER axis (ORTHOGONAL to {@link SlugNamespace}): WHICH lifecycle
 * created the branch, when that matters for collision isolation. `'intake'` is
 * the only producer today — an `intake N` run that CREATES a brand-new backlog
 * item (`work/backlog/<slug>.md`) or PRD (`work/prd/<slug>.md`). Its branch is a
 * short-lived "create the item" branch, a SEPARATE lifecycle from the later
 * claim→build→complete of `do slice:<slug>` — so it gets its own branch ref and
 * never reuses (or is reused by) the build branch for the same slug. Absent for
 * the build/slicing paths (the common case), which carry no producer prefix.
 */
export type BranchProducer = 'intake';

/**
 * The **ONE** construction of the work-BRANCH ref from the namespaced identity.
 * The branch ref is the last identity to join the `<type>-<slug>` scheme the
 * advance sidecar filename (`work/questions/<type>-<slug>.md`) and the
 * `advancing/` lock entry already use — so a PRD `<slug>` and a slice `<slug>`
 * sharing a slug NEVER collide on the arbiter branch (the structural bug this
 * fixes: `intake`, `do slice:<slug>`, and `do prd:<slug>` all built on the SAME
 * un-namespaced `work/<slug>` branch).
 *
 * Spelling: `work/<type>-<slug>` (i.e. `work/slice-<slug>`, `work/prd-<slug>`),
 * matching the lock-entry + sidecar-filename `<type>-<slug>` form EXACTLY. The
 * optional {@link BranchProducer} prefixes it (`work/<producer>-<type>-<slug>`,
 * e.g. `work/intake-slice-<slug>`, `work/intake-prd-<slug>`) so a branch that
 * CREATES an item (intake) never collides with the branch that later BUILDS the
 * same-slug slice. One consistent rule, not a second derivation. EVERY site
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
 * HEAD, or — after the clean breaking cutover — a pre-rename un-namespaced
 * `work/<slug>`). This is how `complete`/`integration` recover the type carried
 * IN the branch name they are already standing on, rather than re-deriving it
 * inconsistently. The regex anchors the optional producer prefix BEFORE the
 * type alternation, so `work/intake-slice-foo` resolves to
 * `{producer:'intake', namespace:'slice', slug:'foo'}` (the `slug` never
 * swallows the `intake-`/`slice-` prefixes).
 */
export function parseWorkBranchRef(
	branch: string,
):
	| {producer?: BranchProducer; namespace: SlugNamespace; slug: string}
	| undefined {
	const match = /^work\/(?:(intake)-)?(slice|prd)-(.+)$/.exec(branch);
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
	 * `'slice'` / `'prd'` when an explicit prefix was given; `undefined` for a
	 * bare slug (the namespace is then resolved by the cross-namespace check).
	 */
	explicit: SlugNamespace | undefined;
	/** The bare slug with any `slice:`/`prd:` prefix stripped. */
	slug: string;
}

/** A fully-resolved slug target: which namespace it names + the bare slug. */
export interface ResolvedSlug {
	namespace: SlugNamespace;
	slug: string;
	/** Whether the caller wrote an explicit `slice:`/`prd:` prefix. */
	explicit: boolean;
}

/** The explicit-prefix forms the resolver understands. */
const SLICE_PREFIX = 'slice:';
const PRD_PREFIX = 'prd:';

/**
 * Raised when a slug argument cannot be resolved: an ambiguous bare slug
 * (collision across namespaces), or a `prd:` argument handed to a slice-only
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
 * slug. PURE string work, no existence check: `slice:foo` → explicit slice,
 * `prd:foo` → explicit prd, `foo` → bare (`explicit: undefined`). The prefix
 * match is case-sensitive and exact (`slice:`/`prd:`); a slug like `slicer` is
 * NOT a prefix and stays bare.
 */
export function parseSlugArg(arg: string): ParsedSlugArg {
	if (arg.startsWith(SLICE_PREFIX)) {
		return {explicit: 'slice', slug: arg.slice(SLICE_PREFIX.length)};
	}
	if (arg.startsWith(PRD_PREFIX)) {
		return {explicit: 'prd', slug: arg.slice(PRD_PREFIX.length)};
	}
	return {explicit: undefined, slug: arg};
}

/** What the resolver needs to perform the existence checks. */
export interface ResolveSlugInput {
	/** The raw CLI slug argument (bare, `slice:<slug>`, or `prd:<slug>`). */
	arg: string;
	/** The repo working-tree root whose `work/` namespaces to read. */
	repoPath: string;
	/**
	 * The read seam to resolve existence through (slice via `resolveLocalState`,
	 * PRD via `resolvePrdExistence`). Defaults to the active {@link ledgerRead};
	 * injectable for tests.
	 */
	read?: LedgerReadStrategy;
}

/** Does a SLICE named `slug` exist (backlog or in-progress) in this repo? */
function sliceExists(
	read: LedgerReadStrategy,
	repoPath: string,
	slug: string,
): boolean {
	// The slice side resolves THROUGH the existing read seam — its local-tree
	// method already parses `work/backlog/*.md` slugs (frontmatter, falling back
	// to filename). An in-progress slice is ALSO a slice (a claimed one); the
	// local state's backlog covers the up-for-grabs case, which is what a bare
	// `<slug>` collision check needs.
	const state = read.resolveLocalState({repoPath});
	return state.backlog.some((item) => item.slug === slug);
}

/** Does a PRD named `slug` exist (prd or slicing) in this repo? */
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
 *   - `slice:<slug>` → `{namespace: 'slice'}` — always unambiguous (no check).
 *   - `prd:<slug>`   → `{namespace: 'prd'}`   — always unambiguous (no check).
 *   - `<slug>` (bare) → the **slice**, but ONLY after confirming no PRD shares the
 *     slug. On a collision (both a slice AND a PRD named `<slug>` exist) it throws
 *     {@link SlugResolutionError} — loud, immediate, human-resolvable. It NEVER
 *     silently guesses.
 *
 * Explicit prefixes skip the existence check entirely (they are collision-proof
 * by construction); only the bare path pays the cheap cross-namespace read.
 */
export function resolveSlug(input: ResolveSlugInput): ResolvedSlug {
	const read = input.read ?? ledgerRead;
	const parsed = parseSlugArg(input.arg);

	if (parsed.explicit !== undefined) {
		// Explicit prefix: unambiguous by construction. No existence check.
		return {namespace: parsed.explicit, slug: parsed.slug, explicit: true};
	}

	// Bare slug: resolve to the slice, but ONLY after the cross-namespace check.
	// A slice/PRD collision is a loud ERROR — never a silent guess.
	if (prdExists(read, input.repoPath, parsed.slug)) {
		throw new SlugResolutionError(
			`'${parsed.slug}' is ambiguous: both a slice and a PRD share that slug. ` +
				`Use \`slice:${parsed.slug}\` or \`prd:${parsed.slug}\` to disambiguate.`,
		);
	}
	return {namespace: 'slice', slug: parsed.slug, explicit: false};
}

/**
 * Resolve a slug argument for a SLICE-ONLY command (`claim`, `start`, `resume`,
 * `complete`, `prompt`, `requeue`, `work-on`). These operate on slices, not PRDs,
 * so:
 *
 *   - `prd:<slug>` is REJECTED with a clear "operates on slices, not PRDs" error.
 *   - `slice:<slug>` is accepted (the explicit alias) → the bare slug.
 *   - `<slug>` (bare) is accepted (= the slice). A slice-only command does NOT
 *     need the cross-namespace collision check: a bare slug here ALWAYS means the
 *     slice (there is no PRD ambiguity, because the PRD namespace is rejected
 *     outright), so it resolves straight to the slice slug.
 *
 * Returns the bare slice slug to feed the existing slice machinery (claim CAS,
 * start, …). PURE: it touches no files (no existence read needed — `prd:` is
 * rejected on the prefix alone, bare/`slice:` resolve to the slice slug).
 */
export function resolveSliceOnlyArg(arg: string): string {
	const parsed = parseSlugArg(arg);
	if (parsed.explicit === 'prd') {
		throw new SlugResolutionError(
			`this command operates on slices, not PRDs — '${arg}' names a PRD. ` +
				`Drop the \`prd:\` prefix to act on the slice, or use \`do ${arg}\` ` +
				`to slice the PRD.`,
		);
	}
	// Bare or `slice:` → the slice slug. (A bare slug on a slice-only command is
	// unambiguously the slice; the PRD namespace is unreachable here.)
	return parsed.slug;
}
