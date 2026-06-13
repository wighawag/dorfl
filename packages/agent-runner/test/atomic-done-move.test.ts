import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {performIntegration} from '../src/integration-core.js';
import {performClaim} from '../src/claim-cas.js';
import {
	makeScratch,
	seedRepoWithArbiter,
	existsOnArbiterMain,
	gitEnv,
	gitIn,
	type Scratch,
} from './helpers/gitRepo.js';

/**
 * The ledger-integrity hardening (PRD `work/prd-sliced/ledger-integrity.md`,
 * defect 1 + its root defect 2): the integration done-move must be ATOMIC against
 * the ARBITER's current status folder, and the one-slug-one-folder invariant must
 * hold on the transition — a merge can NEVER land `done/` while leaving an
 * `in-progress/` (or `needs-attention/`) GHOST behind.
 *
 * House style (mirrors `integration-core.test.ts`): a throwaway checkout + a local
 * `--bare` arbiter, `gitEnv()` isolation (`GIT_CONFIG_GLOBAL=/dev/null` …), temp
 * workspace dirs. `merge` mode is used so the done-move's effect actually LANDS on
 * `<arbiter>/main` and we can assert the merged ledger directly.
 */

let scratch: Scratch;
beforeEach(() => {
	scratch = makeScratch('agent-runner-atomic-done-move-');
});
afterEach(() => {
	scratch.cleanup();
});

const ARBITER = 'arbiter';
const PASS = 'exit 0';

/**
 * Claim a slug (publishes `in-progress/<slug>` to the arbiter) and branch off the
 * freshly-pushed main with UNCOMMITTED agent work — exactly as the caller's HEAD
 * leaves it just before the core.
 */
async function claimAndBranch(slug: string) {
	const seeded = seedRepoWithArbiter(scratch.root, [slug]);
	const repo = seeded.repo;
	const claim = await performClaim({
		slug,
		cwd: repo,
		arbiter: ARBITER,
		env: gitEnv(),
	});
	expect(claim.exitCode).toBe(0);
	gitIn(['fetch', '-q', ARBITER], repo);
	gitIn(['switch', '-q', '-c', `work/slice-${slug}`, `${ARBITER}/main`], repo);
	writeFileSync(join(repo, 'feature.txt'), 'the work\n');
	return {seeded, repo};
}

/**
 * On a SEPARATE clone, surface the slug `in-progress/ → needs-attention/` on the
 * arbiter's `main` (a tree-less ledger move pushed independently of any PR) — so
 * the arbiter now holds the slug in `needs-attention/`, while the integrating
 * branch's base still has it in `in-progress/`. This is the DIVERGENT-base
 * condition that turned the done-"move" into a "copy" (PR #86).
 */
function surfaceToNeedsAttentionOnArbiter(
	seeded: ReturnType<typeof seedRepoWithArbiter>,
	slug: string,
) {
	const other = seeded.clone('surface');
	gitIn(['switch', '-q', '-c', `surface/${slug}`, `${ARBITER}/main`], other);
	mkdirSync(join(other, 'work', 'needs-attention'), {recursive: true});
	gitIn(
		['mv', `work/in-progress/${slug}.md`, `work/needs-attention/${slug}.md`],
		other,
	);
	gitIn(
		['commit', '-q', '-m', `chore(${slug}): surface needs-attention`],
		other,
	);
	gitIn(['push', '-q', ARBITER, `surface/${slug}:main`], other);
	rmSync(other, {recursive: true, force: true});
}

describe('atomic done-move — the move is a MOVE, not a COPY (defect 1)', () => {
	it('arbiter holds the slug in needs-attention/ while the branch base has in-progress/: the merge lands done/ ONLY (no in-progress/ ghost)', async () => {
		const {seeded, repo} = await claimAndBranch('alpha');
		// The arbiter diverges: the slug is surfaced in-progress → needs-attention
		// on main, independently of this branch. The branch base still has
		// in-progress/alpha.md (the divergent base that caused the ghost).
		surfaceToNeedsAttentionOnArbiter(seeded, 'alpha');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'alpha',
			// The caller's local-tree resolution says `in-progress` (its base has it
			// there) — but the arbiter actually holds it in needs-attention/. The
			// arbiter-resolved source must win.
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(core.integration?.mergedToMain).toBe(true);
		// The merged ledger has the slug in done/ ONLY — no ghost in EITHER source
		// folder.
		expect(existsOnArbiterMain(repo, 'done', 'alpha')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'alpha')).toBe(false);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'alpha')).toBe(false);
	});

	it('the normal in-progress/ path still lands done/ ONLY (no regression)', async () => {
		const {repo} = await claimAndBranch('beta');

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'beta',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
		});

		expect(core.outcome).toBe('completed');
		expect(existsOnArbiterMain(repo, 'done', 'beta')).toBe(true);
		expect(existsOnArbiterMain(repo, 'in-progress', 'beta')).toBe(false);
		expect(existsOnArbiterMain(repo, 'needs-attention', 'beta')).toBe(false);
	});
});

describe('one-slug-one-folder invariant — FAIL LOUD on a two-folder slug (defect 2)', () => {
	it('the arbiter already holds the slug in TWO status folders pre-transition: the done-move FAILS LOUD rather than publishing a corrupt ledger', async () => {
		const {seeded, repo} = await claimAndBranch('gamma');
		// Corrupt the arbiter: ADD a stale done/gamma.md alongside the live
		// in-progress/gamma.md (the exact PR #86 corruption — a slug in two folders).
		const other = seeded.clone('corrupt');
		gitIn(['switch', '-q', '-c', `corrupt/gamma`, `${ARBITER}/main`], other);
		mkdirSync(join(other, 'work', 'done'), {recursive: true});
		// DISTINCT content from the in-progress copy, so the auto-clean
		// "provably-safe (identical content)" escape hatch does NOT apply — it must
		// fail loud, never silently pick one.
		writeFileSync(
			join(other, 'work', 'done', 'gamma.md'),
			'---\ntitle: gamma\nslug: gamma\n---\n\nA DIFFERENT, stale copy.\n',
		);
		gitIn(['add', '-A'], other);
		gitIn(['commit', '-q', '-m', 'corrupt: gamma in two folders'], other);
		gitIn(['push', '-q', ARBITER, 'corrupt/gamma:main'], other);
		rmSync(other, {recursive: true, force: true});

		const core = await performIntegration({
			cwd: repo,
			arbiter: ARBITER,
			slug: 'gamma',
			source: 'in-progress',
			recovering: false,
			verify: PASS,
			mode: 'merge',
			env: gitEnv(),
		});

		// FAIL LOUD: the transition refuses rather than publish a corrupt ledger.
		expect(core.outcome).not.toBe('completed');
		expect(core.reason).toMatch(
			/one-slug-one-folder|two .*folders|more than one/i,
		);
		// Nothing corrupt landed: the stale done/ copy is untouched, in-progress/
		// still present (we did NOT silently delete either side).
		expect(existsOnArbiterMain(repo, 'in-progress', 'gamma')).toBe(true);
	});
});
