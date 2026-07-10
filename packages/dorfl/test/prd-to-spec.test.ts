import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	existsSync,
	rmSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {run, git} from '../src/git.js';
import {
	runPrdToSpec,
	checkQuiescence,
	migrateItemContent,
	migrateConfig,
	keepCaseReplace,
	scanForLeaks,
} from '../src/prd-to-spec.js';

/**
 * The `dorfl prd-to-spec` migration ENGINE, exercised end-to-end on an ISOLATED
 * fixture repo in a temp dir (spec
 * `prd-to-spec-vocabulary-cutover-and-migration-command`, ADR §7e, user stories
 * 4-9). Every write lands in a throwaway temp repo with git isolated from the
 * real home (`GIT_CONFIG_GLOBAL=/dev/null`, …) so the real repo / home dir are
 * NEVER touched.
 *
 * Coverage (the task's acceptance criteria):
 *   - deterministic four-layer conversion (folders + frontmatter incl. `done/` +
 *     config + inert refs),
 *   - accurate `--dry-run` that writes NOTHING,
 *   - idempotency (a second run is a no-op leaving a clean tree),
 *   - each REFUSAL path (dirty tree / held lock / in-progress branch), offender
 *     named,
 *   - a GREEN leak scan on the converted fixture.
 */

// ───────────────────────────────────────────────────────────────────────────
// Isolated fixture helpers.
// ───────────────────────────────────────────────────────────────────────────

/** Git env fully isolated from the real global/system config + a fixed identity. */
function gitEnv(): NodeJS.ProcessEnv {
	return {
		...process.env,
		GIT_AUTHOR_NAME: 'Test Runner',
		GIT_AUTHOR_EMAIL: 'test@example.com',
		GIT_COMMITTER_NAME: 'Test Runner',
		GIT_COMMITTER_EMAIL: 'test@example.com',
		GIT_TERMINAL_PROMPT: '0',
		GIT_CONFIG_GLOBAL: '/dev/null',
		GIT_CONFIG_SYSTEM: '/dev/null',
		GIT_CONFIG_NOSYSTEM: '1',
	};
}

const ENV = gitEnv();

function writeFile(repo: string, rel: string, content: string): void {
	const abs = join(repo, rel);
	mkdirSync(dirname(abs), {recursive: true});
	writeFileSync(abs, content);
}

function read(repo: string, rel: string): string {
	return readFileSync(join(repo, rel), 'utf8');
}

function porcelain(repo: string): string {
	return run('git', ['status', '--porcelain'], repo, {env: ENV}).stdout.trim();
}

/**
 * Build a fixture repo carrying ALL FOUR data layers under the LEGACY `prd`
 * vocabulary: a `prds/*` item in every lifecycle folder (proposed/ready/tasked),
 * a task with `prd:` frontmatter INCLUDING a `done/` item, a `.dorfl.json` with
 * `prdsLandIn`, and an inert (merged) `work/prd-<slug>` branch. Committed clean.
 */
function buildFixture(root: string): string {
	const repo = mkdtempSync(join(root, 'fixture-'));
	git(['init', '-q', '-b', 'main'], repo, {env: ENV});

	// (a) FOLDERS — a `prds/*` item in each lifecycle folder.
	writeFile(
		repo,
		'work/prds/ready/my-feature.md',
		'---\nslug: my-feature\nissue: 7\n---\n\nA feature. See work/prds/ready/my-feature.md.\n',
	);
	writeFile(
		repo,
		'work/prds/proposed/staged.md',
		'---\nslug: staged\n---\n\nA staged prd.\n',
	);
	writeFile(
		repo,
		'work/prds/tasked/old.md',
		'---\nslug: old\n---\n\nA tasked spec, see work/prds/tasked/old.md.\n',
	);

	// (b) FRONTMATTER incl. a done/ item + a tasked-spec item (done-items ARE
	//     converted — determinism).
	writeFile(
		repo,
		'work/tasks/done/t1.md',
		'---\nslug: t1\nprd: my-feature\n---\n\nDone task. See work/prds/ready/my-feature.md and prd:my-feature.\n',
	);
	writeFile(
		repo,
		'work/tasks/ready/t2.md',
		'---\nslug: t2\nprd: my-feature\n---\n\nReady task pointing at prd:my-feature.\n',
	);

	// (c) CONFIG — `prdsLandIn`.
	writeFile(
		repo,
		'.dorfl.json',
		'{\n  "verify": "x",\n  "prdsLandIn": "ready"\n}\n',
	);

	// The protocol dir (re-sync target).
	writeFile(repo, 'work/protocol/WORK-CONTRACT.md', 'old contract\n');

	git(['add', '-A'], repo, {env: ENV});
	git(['commit', '-q', '-m', 'init'], repo, {env: ENV});

	// (d) an INERT (merged into HEAD) `work/prd-<slug>` branch.
	git(['branch', 'work/prd-my-feature'], repo, {env: ENV});

	return repo;
}

let scratch: string;

beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), 'prd-to-spec-test-'));
});

afterEach(() => {
	rmSync(scratch, {recursive: true, force: true});
});

// ───────────────────────────────────────────────────────────────────────────
// Pure-unit slices (the reusable engine pieces).
// ───────────────────────────────────────────────────────────────────────────

describe('keepCaseReplace — the bespoke keep-case sweep', () => {
	it('rewrites all three case variants preserving shape', () => {
		expect(keepCaseReplace('prd Prd PRD', 'prd', 'spec')).toBe(
			'spec Spec SPEC',
		);
		expect(keepCaseReplace('prdsLandIn', 'prd', 'spec')).toBe('specsLandIn');
		expect(keepCaseReplace('work/prds/ready', 'prds', 'specs')).toBe(
			'work/specs/ready',
		);
	});

	it('is a plain substring replace (no word boundary)', () => {
		expect(keepCaseReplace('prd-foo prd:bar', 'prd', 'spec')).toBe(
			'spec-foo spec:bar',
		);
	});
});

describe('migrateItemContent — frontmatter + inert refs (pure)', () => {
	it('rewrites the prd: frontmatter KEY but not a prd inside a value/slug', () => {
		const before =
			'---\nslug: prd-to-spec-cutover\nprd: my-parent\n---\n\nbody\n';
		const after = migrateItemContent(before);
		// The KEY flipped; the slug value carrying the retired word is UNTOUCHED
		// (a slug is immutable provenance, not a structural ref).
		expect(after).toContain('spec: my-parent');
		expect(after).toContain('slug: prd-to-spec-cutover');
		expect(after).not.toMatch(/^prd:/m);
	});

	it('rewrites structural path/branch/arg refs in the body', () => {
		const before = 'see work/prds/ready/x.md, branch work/prd-x, arg prd:x\n';
		expect(migrateItemContent(before)).toBe(
			'see work/specs/ready/x.md, branch work/spec-x, arg spec:x\n',
		);
	});

	it('does NOT rewrite a bare prd-<slug> (protects immutable provenance slugs)', () => {
		// A landed item's slug like `prd-to-spec-cutover` must survive verbatim; a
		// genuine bare lock entry lives on a git ref (migrateRefs), not an item body.
		expect(migrateItemContent('slug: prd-to-spec-cutover\n')).toBe(
			'slug: prd-to-spec-cutover\n',
		);
	});

	it('is idempotent (already-spec text is unchanged)', () => {
		const spec = '---\nslug: t\nspec: p\n---\n\nwork/specs/ready/p.md\n';
		expect(migrateItemContent(spec)).toBe(spec);
	});
});

describe('migrateConfig — the config key rename (textual, value-preserving)', () => {
	it('renames prdsLandIn -> specsLandIn preserving the value + formatting', () => {
		const repo = mkdtempSync(join(scratch, 'cfg-'));
		writeFile(repo, '.dorfl.json', '{\n  "prdsLandIn": "ready"\n}\n');
		const renamed = migrateConfig(repo);
		expect(renamed).toEqual([{from: 'prdsLandIn', to: 'specsLandIn'}]);
		expect(read(repo, '.dorfl.json')).toBe('{\n  "specsLandIn": "ready"\n}\n');
	});

	it('is a no-op on an already-migrated config', () => {
		const repo = mkdtempSync(join(scratch, 'cfg2-'));
		writeFile(repo, '.dorfl.json', '{\n  "specsLandIn": "ready"\n}\n');
		expect(migrateConfig(repo)).toEqual([]);
	});

	it('is safe on a repo with no .dorfl.json', () => {
		const repo = mkdtempSync(join(scratch, 'cfg3-'));
		expect(migrateConfig(repo)).toEqual([]);
	});
});

// ───────────────────────────────────────────────────────────────────────────
// End-to-end on the fixture repo.
// ───────────────────────────────────────────────────────────────────────────

describe('runPrdToSpec — deterministic four-layer conversion', () => {
	it('converts folders + frontmatter (incl. done/ + tasked/) + config + inert refs', () => {
		const repo = buildFixture(scratch);
		const result = runPrdToSpec({repoPath: repo, env: ENV});

		expect(result.refused).toBeUndefined();
		expect(result.leaks).toEqual([]); // GREEN leak scan on the converted tree.

		// (a) FOLDERS moved.
		expect(existsSync(join(repo, 'work/prds'))).toBe(false);
		expect(existsSync(join(repo, 'work/specs/ready/my-feature.md'))).toBe(true);
		expect(existsSync(join(repo, 'work/specs/proposed/staged.md'))).toBe(true);
		expect(existsSync(join(repo, 'work/specs/tasked/old.md'))).toBe(true);

		// (b) FRONTMATTER + body — the done/ item IS converted (determinism).
		const done = read(repo, 'work/tasks/done/t1.md');
		expect(done).toContain('spec: my-feature');
		expect(done).not.toMatch(/^prd:/m);
		expect(done).toContain('work/specs/ready/my-feature.md');
		expect(done).toContain('spec:my-feature');
		// The tasked-spec + moved items' own body refs are swept too.
		expect(read(repo, 'work/specs/tasked/old.md')).toContain(
			'work/specs/tasked/old.md',
		);
		expect(read(repo, 'work/tasks/ready/t2.md')).toContain('spec: my-feature');

		// (c) CONFIG key renamed (value preserved).
		expect(read(repo, '.dorfl.json')).toContain('"specsLandIn": "ready"');
		expect(read(repo, '.dorfl.json')).not.toContain('prdsLandIn');

		// (d) inert REFS renamed.
		const branches = run(
			'git',
			['for-each-ref', '--format=%(refname:short)', 'refs/heads/work/'],
			repo,
			{env: ENV},
		).stdout;
		expect(branches).toContain('work/spec-my-feature');
		expect(branches).not.toContain('work/prd-my-feature');

		// Contract re-sync ran: work/protocol/ got the new docs + a VERSION.
		expect(result.resync?.docs.length).toBeGreaterThan(0);
		expect(existsSync(join(repo, 'work/protocol/VERSION'))).toBe(true);
		expect(existsSync(join(repo, 'work/protocol/WORK-CONTRACT.md'))).toBe(true);
	});

	it('is DETERMINISTIC: two independent conversions of the same fixture agree', () => {
		const a = buildFixture(scratch);
		const b = buildFixture(scratch);
		runPrdToSpec({repoPath: a, env: ENV});
		runPrdToSpec({repoPath: b, env: ENV});
		// The converted item content is byte-identical across the two runs (the
		// re-sync VERSION timestamp is the only non-deterministic artifact, and it
		// is NOT a data item).
		for (const rel of [
			'work/specs/ready/my-feature.md',
			'work/tasks/done/t1.md',
			'.dorfl.json',
		]) {
			expect(read(a, rel)).toBe(read(b, rel));
		}
	});
});

describe('runPrdToSpec — --dry-run writes nothing', () => {
	it('reports every layer accurately and leaves the tree untouched', () => {
		const repo = buildFixture(scratch);
		const before = porcelain(repo);
		const result = runPrdToSpec({repoPath: repo, dryRun: true, env: ENV});

		expect(result.dryRun).toBe(true);
		// The report enumerates what WOULD change.
		expect(result.folderMoves.length).toBe(3);
		// Four items carry a structural prd ref: t1 (fm+body), t2 (fm), the ready
		// item (body path), and the tasked item (body path).
		expect(result.contentRewrites.length).toBe(4);
		expect(result.configRewrites).toEqual([
			{from: 'prdsLandIn', to: 'specsLandIn'},
		]);
		expect(result.refRenames.length).toBe(1);

		// NOTHING was written: the tree is byte-for-byte as before + still on prds.
		expect(porcelain(repo)).toBe(before);
		expect(existsSync(join(repo, 'work/prds/ready/my-feature.md'))).toBe(true);
		expect(existsSync(join(repo, 'work/specs'))).toBe(false);
		expect(read(repo, '.dorfl.json')).toContain('prdsLandIn');
		expect(
			run(
				'git',
				['for-each-ref', '--format=%(refname:short)', 'refs/heads/work/'],
				repo,
				{env: ENV},
			).stdout,
		).toContain('work/prd-my-feature');
	});
});

describe('runPrdToSpec — idempotency', () => {
	it('a second run on an already-migrated repo is a no-op leaving a clean tree', () => {
		const repo = buildFixture(scratch);
		runPrdToSpec({repoPath: repo, env: ENV});
		git(['add', '-A'], repo, {env: ENV});
		git(['commit', '-q', '-m', 'migrated'], repo, {env: ENV});

		const second = runPrdToSpec({repoPath: repo, env: ENV});
		expect(second.refused).toBeUndefined();
		expect(second.folderMoves).toEqual([]);
		expect(second.contentRewrites).toEqual([]);
		expect(second.configRewrites).toEqual([]);
		expect(second.refRenames).toEqual([]);
		expect(second.leaks).toEqual([]);
		// A true no-op: the working tree stays clean (VERSION was not re-bumped).
		expect(porcelain(repo)).toBe('');
	});
});

describe('checkQuiescence — refuses (naming the offender)', () => {
	it('refuses on a DIRTY working tree, naming the dirty path', () => {
		const repo = buildFixture(scratch);
		writeFile(repo, 'scratch.txt', 'dirty');
		const v = checkQuiescence(repo, undefined, ENV);
		expect(v?.kind).toBe('dirty-tree');
		expect(v?.offender).toContain('scratch.txt');
		// And the orchestrator REFUSES (runs no layer).
		const result = runPrdToSpec({repoPath: repo, env: ENV});
		expect(result.refused?.kind).toBe('dirty-tree');
		expect(result.folderMoves).toEqual([]);
		expect(existsSync(join(repo, 'work/prds'))).toBe(true); // untouched
	});

	it('refuses on a HELD per-item lock, naming the lock ref', () => {
		const repo = buildFixture(scratch);
		const head = git(['rev-parse', 'HEAD'], repo, {env: ENV}).trim();
		git(['update-ref', 'refs/dorfl/lock/spec-my-feature', head], repo, {
			env: ENV,
		});
		const v = checkQuiescence(repo, undefined, ENV);
		expect(v?.kind).toBe('held-lock');
		expect(v?.offender).toBe('refs/dorfl/lock/spec-my-feature');
		expect(runPrdToSpec({repoPath: repo, env: ENV}).refused?.kind).toBe(
			'held-lock',
		);
	});

	it('refuses on an IN-PROGRESS work-branch carrying unlanded work, naming it', () => {
		const repo = buildFixture(scratch);
		// A branch with a commit NOT merged into HEAD = unlanded work in flight.
		git(['checkout', '-q', '-b', 'work/prd-inflight'], repo, {env: ENV});
		writeFile(repo, 'f.txt', 'wip');
		git(['add', '-A'], repo, {env: ENV});
		git(['commit', '-q', '-m', 'wip'], repo, {env: ENV});
		git(['checkout', '-q', 'main'], repo, {env: ENV});

		const v = checkQuiescence(repo, undefined, ENV);
		expect(v?.kind).toBe('in-progress-branch');
		expect(v?.offender).toBe('work/prd-inflight');
	});

	it('a MERGED (inert) work/prd-* branch does NOT block (it is renamed, not refused)', () => {
		const repo = buildFixture(scratch); // its work/prd-my-feature IS merged.
		expect(checkQuiescence(repo, undefined, ENV)).toBeUndefined();
	});
});

describe('scanForLeaks — the acceptance GATE over the converted tree', () => {
	it('is GREEN on the converted fixture', () => {
		const repo = buildFixture(scratch);
		runPrdToSpec({repoPath: repo, env: ENV});
		expect(scanForLeaks(repo, undefined, ENV)).toEqual([]);
	});

	it('is NON-VACUOUS: it FLAGS an un-migrated tree (forward lens)', () => {
		const repo = buildFixture(scratch);
		// Scan BEFORE migrating: the `prds/` folder + `prd:` fields + config key
		// + inert ref are all still present, so the scan MUST flag them.
		const leaks = scanForLeaks(repo, undefined, ENV);
		expect(leaks.length).toBeGreaterThan(0);
		expect(leaks.every((l) => l.lens === 'forward')).toBe(true);
		expect(leaks.some((l) => l.why.includes('folder'))).toBe(true);
		expect(leaks.some((l) => l.why.includes('config key'))).toBe(true);
		expect(leaks.some((l) => l.why.includes('git ref'))).toBe(true);
	});

	it('REVERSE lens flags English corrupted by a blind sweep', () => {
		const repo = buildFixture(scratch);
		runPrdToSpec({repoPath: repo, env: ENV});
		// Inject a mangled English word into a converted item.
		writeFile(repo, 'work/notes/findings/n.md', 'this is esspecially wrong\n');
		const leaks = scanForLeaks(repo, undefined, ENV);
		expect(leaks.some((l) => l.lens === 'reverse')).toBe(true);
	});

	it('does NOT flag a prose acronym-plural `PRDs/ADRs` as a folder ref (option-A prose exemption)', () => {
		// REGRESSION (run-on-dorfl acceptance): the bare `prds/` folder-ref pattern
		// must not fire on the artifact word `PRDs` followed by `/` + another word
		// in running prose (e.g. `review of slices/PRDs/code`, `PRDs/ADRs point`).
		// Those are the retired word in NARRATIVE, not a dangling `work/prds/` path.
		const repo = buildFixture(scratch);
		runPrdToSpec({repoPath: repo, env: ENV});
		writeFile(
			repo,
			'work/specs/tasked/prose.md',
			'---\nslug: prose\n---\n\nReview of slices/PRDs/code; the PRDs/ADRs point here.\n',
		);
		expect(scanForLeaks(repo, undefined, ENV)).toEqual([]);
	});

	it('STILL flags a genuine surviving `prds/<lifecycle>` folder ref (guard is not over-loosened)', () => {
		const repo = buildFixture(scratch);
		runPrdToSpec({repoPath: repo, env: ENV});
		// A real dangling folder ref (lowercase path shape) MUST still fail the gate.
		writeFile(
			repo,
			'work/specs/tasked/ref.md',
			'---\nslug: ref\n---\n\nSee prds/ready/foo.md for the source.\n',
		);
		const leaks = scanForLeaks(repo, undefined, ENV);
		expect(leaks.some((l) => l.why.includes('folder ref'))).toBe(true);
	});
});
