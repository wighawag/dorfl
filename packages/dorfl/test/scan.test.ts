import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
	scan,
	scanRepoPaths,
	readDoneSlugs,
	readReadyItems,
	toScannedLifecycle,
} from '../src/scan.js';
import {formatReport} from '../src/format.js';
import {mergeConfig} from '../src/config.js';
import type {ConfigOverrideMap} from '../src/config-override.js';
import {newSidecar, serialiseSidecar, sidecarPathFor} from '../src/sidecar.js';
import {
	registerMirrorWithWork,
	pushWorkToMirrorOrigin,
	breakMirrorOrigin,
	fixtureFolderRel,
} from './helpers/gitRepo.js';

/** Write an observation under a repo's `work/notes/observations/` (untriaged unless `triaged`). */
function writeObservation(repo: string, slug: string, triaged?: string): void {
	const dir = join(root, repo, 'work', 'notes', 'observations');
	mkdirSync(dir, {recursive: true});
	const lines = ['---', `slug: ${slug}`];
	if (triaged !== undefined) lines.push(`triaged: ${triaged}`);
	lines.push('---', '', 'a captured signal');
	writeFileSync(join(dir, `${slug}.md`), lines.join('\n'));
}

/** Write the identity-keyed sidecar `work/questions/<type>-<slug>.md`, answered or pending. */
function writeSidecar(
	repo: string,
	namespace: 'task' | 'prd',
	slug: string,
	answered: boolean,
): void {
	const item = `${namespace}:${slug}`;
	const model = newSidecar(item, [{question: 'pick one?'}]);
	if (answered) {
		model.entries[0].answer = 'yes';
	}
	const abs = join(root, repo, sidecarPathFor(item));
	mkdirSync(join(abs, '..'), {recursive: true});
	writeFileSync(abs, serialiseSidecar(model));
}

let root: string;

/** A minimal task markdown body with the given frontmatter fields. */
function task(frontmatter: Record<string, string>): string {
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', 'body');
	return lines.join('\n');
}

/** The workspacesDir whose `repos/` we seed with bare mirror fixtures. */
function workspacesDir(): string {
	return join(root, '.dorfl');
}

function writeItem(
	repo: string,
	status: 'backlog' | 'done' | 'cancelled',
	file: string,
	frontmatter: Record<string, string>,
): void {
	const dir = join(root, repo, 'work', fixtureFolderRel(status));
	mkdirSync(dir, {recursive: true});
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', 'body');
	writeFileSync(join(dir, file), lines.join('\n'));
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'dorfl-scan-'));
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

describe('toScannedLifecycle (pool → scan-shape projection)', () => {
	// Regression: `route-answered-observation-sidecar-to-apply-pool` made
	// `buildLifecyclePools` route an ANSWERED observation to `apply` (namespace
	// 'observation'). The scan projection MUST keep it, or every answered
	// observation is stranded — gone from `triage` AND dropped from `apply` — so
	// the CI enumerate schedules none of them. This asserts the projection keeps
	// an answered observation in apply while surface stays task/spec-only.
	it('keeps an answered observation in apply (namespace observation)', () => {
		const out = toScannedLifecycle({
			triage: [{slug: 'untriaged-obs'}],
			surface: [{namespace: 'task', slug: 'blocked-task'}],
			apply: [
				{namespace: 'task', slug: 'answered-task'},
				{namespace: 'spec', slug: 'answered-prd'},
				{namespace: 'observation', slug: 'answered-obs'},
			],
		});
		expect(out.triage).toEqual([{slug: 'untriaged-obs'}]);
		expect(out.surface).toEqual([{namespace: 'task', slug: 'blocked-task'}]);
		expect(out.apply).toEqual([
			{namespace: 'task', slug: 'answered-task'},
			{namespace: 'spec', slug: 'answered-prd'},
			{namespace: 'observation', slug: 'answered-obs'},
		]);
	});

	it('does NOT admit an observation into surface (an unsidecarred obs is triage, not surface)', () => {
		const out = toScannedLifecycle({
			triage: [],
			surface: [{namespace: 'observation', slug: 'should-not-appear'}],
			apply: [],
		});
		expect(out.surface).toEqual([]);
	});

	it('drops any other/unknown namespace defensively from apply', () => {
		const out = toScannedLifecycle({
			triage: [],
			surface: [],
			apply: [
				{namespace: 'observation', slug: 'keep'},
				{namespace: 'mystery', slug: 'drop'},
			],
		});
		expect(out.apply).toEqual([{namespace: 'observation', slug: 'keep'}]);
	});
});

describe('readDoneSlugs', () => {
	it('returns the set of slugs present in work/tasks/done/', () => {
		writeItem('repo', 'done', 'one.md', {slug: 'one'});
		writeItem('repo', 'done', 'two.md', {slug: 'two'});
		const slugs = readDoneSlugs(join(root, 'repo'));
		expect(slugs).toEqual(new Set(['one', 'two']));
	});

	it('falls back to the filename (sans .md) when slug frontmatter is absent', () => {
		const dir = join(root, 'repo', 'work', 'tasks', 'done');
		mkdirSync(dir, {recursive: true});
		writeFileSync(join(dir, 'no-slug.md'), 'no frontmatter');
		const slugs = readDoneSlugs(join(root, 'repo'));
		expect(slugs).toEqual(new Set(['no-slug']));
	});

	it('returns an empty set when there is no work/tasks/done/', () => {
		mkdirSync(join(root, 'repo'), {recursive: true});
		expect(readDoneSlugs(join(root, 'repo'))).toEqual(new Set());
	});
});

describe('readReadyItems', () => {
	it('reads slug/humanOnly/needsAnswers/blockedBy for each backlog markdown', () => {
		writeItem('repo', 'backlog', 'a.md', {
			slug: 'a',
			humanOnly: 'true',
			needsAnswers: 'true',
			blockedBy: '[]',
		});
		const items = readReadyItems(join(root, 'repo'));
		expect(items).toHaveLength(1);
		expect(items[0].slug).toBe('a');
		expect(items[0].humanOnly).toBe(true);
		expect(items[0].needsAnswers).toBe(true);
		expect(items[0].blockedBy).toEqual([]);
		expect(items[0].file).toBe('a.md');
	});

	it('reads undeclared items (no humanOnly/needsAnswers) as undefined', () => {
		writeItem('repo', 'backlog', 'u.md', {slug: 'u', blockedBy: '[]'});
		const items = readReadyItems(join(root, 'repo'));
		expect(items[0].humanOnly).toBeUndefined();
		expect(items[0].needsAnswers).toBeUndefined();
	});

	it('falls back to filename when slug frontmatter is absent', () => {
		const dir = join(root, 'repo', 'work', 'tasks', 'ready');
		mkdirSync(dir, {recursive: true});
		writeFileSync(join(dir, 'fallback.md'), '---\nhumanOnly: true\n---');
		const items = readReadyItems(join(root, 'repo'));
		expect(items[0].slug).toBe('fallback');
	});

	it('returns items sorted by slug', () => {
		writeItem('repo', 'backlog', 'z.md', {slug: 'zebra'});
		writeItem('repo', 'backlog', 'a.md', {slug: 'apple'});
		const items = readReadyItems(join(root, 'repo'));
		expect(items.map((i) => i.slug)).toEqual(['apple', 'zebra']);
	});
});

describe("scan (registry: reads each hub mirror's bare main ref)", () => {
	it('produces a per-repo queue with resolved eligibility', async () => {
		const m = registerMirrorWithWork(workspacesDir(), 'repo-a', {
			backlog: {
				'ready.md': task({slug: 'ready'}),
				'human.md': task({slug: 'human', humanOnly: 'true'}),
			},
		});
		const config = mergeConfig({
			workspacesDir: workspacesDir(),
			autoBuild: true,
		});

		const report = await scan(config);
		expect(report.repos).toHaveLength(1);
		const repo = report.repos[0];
		// The repo identity is the hub-mirror PATH (registry model).
		expect(repo.path).toBe(m.mirrorPath);

		const ready = repo.items.find((i) => i.slug === 'ready')!;
		expect(ready.eligibility.eligible).toBe(true);

		const human = repo.items.find((i) => i.slug === 'human')!;
		expect(human.eligibility.eligible).toBe(false);
		expect(human.eligibility.gatePass).toBe(false);
	});

	it('gates needsAnswers: true items independently of humanOnly', async () => {
		registerMirrorWithWork(workspacesDir(), 'repo-na', {
			backlog: {
				'ready.md': task({slug: 'ready'}),
				'answers.md': task({slug: 'answers', needsAnswers: 'true'}),
			},
		});
		const report = await scan(
			mergeConfig({workspacesDir: workspacesDir(), autoBuild: true}),
		);
		const repo = report.repos[0];

		const ready = repo.items.find((i) => i.slug === 'ready')!;
		expect(ready.eligibility.eligible).toBe(true);

		const answers = repo.items.find((i) => i.slug === 'answers')!;
		expect(answers.eligibility.eligible).toBe(false);
		expect(answers.eligibility.gatePass).toBe(false);
	});

	it('resolves blockedBy against the same mirror work/tasks/done/', async () => {
		// dependency not yet done
		registerMirrorWithWork(workspacesDir(), 'repo', {
			backlog: {'b.md': task({slug: 'b', blockedBy: '[a]'})},
		});
		const config = mergeConfig({
			workspacesDir: workspacesDir(),
			autoBuild: true,
		});
		let report = await scan(config);
		let b = report.repos[0].items[0];
		expect(b.eligibility.blockedBy.satisfied).toBe(false);
		expect(b.eligibility.eligible).toBe(false);

		// now satisfy the dependency: a fresh fixture with a done/ alongside backlog/.
		rmSync(workspacesDir(), {recursive: true, force: true});
		registerMirrorWithWork(workspacesDir(), 'repo', {
			backlog: {'b.md': task({slug: 'b', blockedBy: '[a]'})},
			done: {'a.md': task({slug: 'a'})},
		});
		report = await scan(config);
		b = report.repos[0].items[0];
		expect(b.eligibility.blockedBy.satisfied).toBe(true);
		expect(b.eligibility.eligible).toBe(true);
	});

	it('does NOT resolve blockedBy across mirrors', async () => {
		registerMirrorWithWork(workspacesDir(), 'repo-a', {
			done: {'dep.md': task({slug: 'dep'})},
		});
		registerMirrorWithWork(workspacesDir(), 'repo-b', {
			backlog: {'needs.md': task({slug: 'needs', blockedBy: '[dep]'})},
		});
		const report = await scan(
			mergeConfig({workspacesDir: workspacesDir(), autoBuild: true}),
		);
		const needs = report.repos
			.flatMap((r) => r.items)
			.find((i) => i.slug === 'needs')!;
		// dep is done in repo-a but NOT in repo-b → still blocked
		expect(needs.eligibility.blockedBy.satisfied).toBe(false);
		expect(needs.eligibility.eligible).toBe(false);
	});

	it('honours autoBuild for undeclared (no humanOnly) items', async () => {
		registerMirrorWithWork(workspacesDir(), 'repo', {
			backlog: {'u.md': task({slug: 'u', blockedBy: '[]'})},
		});

		const strict = await scan(
			mergeConfig({workspacesDir: workspacesDir(), autoBuild: false}),
		);
		expect(strict.repos[0].items[0].eligibility.eligible).toBe(false);

		const permissive = await scan(
			mergeConfig({workspacesDir: workspacesDir(), autoBuild: true}),
		);
		expect(permissive.repos[0].items[0].eligibility.eligible).toBe(true);
	});

	it('returns an empty list when no mirrors are registered', async () => {
		mkdirSync(workspacesDir(), {recursive: true});
		const report = await scan(mergeConfig({workspacesDir: workspacesDir()}));
		expect(report.repos).toEqual([]);
	});

	it('counts eligible items in the report summary', async () => {
		registerMirrorWithWork(workspacesDir(), 'repo', {
			backlog: {
				'a.md': task({slug: 'a'}),
				'b.md': task({slug: 'b', humanOnly: 'true'}),
				'c.md': task({slug: 'c'}),
			},
		});
		const report = await scan(
			mergeConfig({workspacesDir: workspacesDir(), autoBuild: true}),
		);
		expect(report.totalItems).toBe(3);
		expect(report.totalEligible).toBe(2);
	});
});

describe('scan — fetch-first (ADR §5/§6; offline-scan invariant retired)', () => {
	it('sees a change pushed to the arbiter AFTER fetching (not just last-known)', async () => {
		// Register a mirror with one backlog item, then push a SECOND item onto the
		// mirror's origin (source repo) only — the bare mirror's `main` is now stale.
		registerMirrorWithWork(workspacesDir(), 'repo', {
			backlog: {'first.md': task({slug: 'first'})},
		});
		pushWorkToMirrorOrigin(
			workspacesDir(),
			'repo',
			'backlog',
			'second.md',
			task({slug: 'second'}),
		);

		const report = await scan(
			mergeConfig({workspacesDir: workspacesDir(), autoBuild: true}),
		);
		// Fetch-first ⇒ the second item (pushed after mirror creation) is visible.
		const slugs = report.repos[0].items.map((i) => i.slug).sort();
		expect(slugs).toEqual(['first', 'second']);
	});

	it('WARNS and falls back to last-known when the fetch FAILS (never errors)', async () => {
		const {mirrorPath} = registerMirrorWithWork(workspacesDir(), 'repo', {
			backlog: {'known.md': task({slug: 'known'})},
		});
		// A later push the broken fetch can never see.
		pushWorkToMirrorOrigin(
			workspacesDir(),
			'repo',
			'backlog',
			'unseen.md',
			task({slug: 'unseen'}),
		);
		breakMirrorOrigin(mirrorPath);

		const warnings: string[] = [];
		const report = await scan(
			mergeConfig({workspacesDir: workspacesDir(), autoBuild: true}),
			{warn: (m) => warnings.push(m)},
		);

		// Did NOT throw; still reports the last-known backlog (offline fall-back).
		expect(report.repos[0].items.map((i) => i.slug)).toEqual(['known']);
		// And it warned about the failed fetch / offline fall-back.
		expect(warnings).toHaveLength(1);
		expect(warnings[0].toLowerCase()).toMatch(/fetch|offline|last-known/);
	});
});

describe('scanRepoPaths (working-tree scan for in-place/run)', () => {
	it('reads eligibility from a working checkout and honours per-repo autoBuild', () => {
		writeItem('repo', 'backlog', 'u.md', {slug: 'u', blockedBy: '[]'});
		writeFileSync(
			join(root, 'repo', '.dorfl.json'),
			JSON.stringify({autoBuild: true}),
		);
		// Global is strict, but the per-repo file opts in ⇒ eligible (the working-tree
		// scan CAN read a checked-out .dorfl.json; the mirror scan cannot).
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({autoBuild: false}),
		);
		expect(report.repos[0].items[0].eligibility.eligible).toBe(true);
	});

	// REGRESSION (per-machine-config-override-layer Gate-2 block): the in-place
	// scan MUST apply the per-machine override on top of the committed
	// `.dorfl.json`. Both files set the SAME key, in OPPOSITE directions:
	// committed `autoBuild: true`, override `"*": {autoBuild: false}`. The override
	// is per-machine and beats the committed file, so the item must be INELIGIBLE.
	// Using the `"*"` bucket means no git remote / hub-key resolution is needed,
	// so this isolates the threading defect (override dropped at the call site)
	// from URL resolution.
	it('applies the per-machine override ("*" bucket) OVER the committed .dorfl.json', () => {
		writeItem('repo', 'backlog', 'u.md', {slug: 'u', blockedBy: '[]'});
		writeFileSync(
			join(root, 'repo', '.dorfl.json'),
			JSON.stringify({autoBuild: true}),
		);
		const override: ConfigOverrideMap = {'*': {autoBuild: false}};
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({autoBuild: true}),
			new Set(),
			override,
		);
		// Override `autoBuild:false` wins over committed `autoBuild:true` ⇒ ineligible.
		expect(report.repos[0].items[0].eligibility.eligible).toBe(false);
	});

	// CONTROL: WITHOUT the override the committed `autoBuild: true` stands, so the
	// same item IS eligible — proving the assertion above is the override at work,
	// not a fixture quirk.
	it('control: WITHOUT the override the committed autoBuild:true stands (eligible)', () => {
		writeItem('repo', 'backlog', 'u.md', {slug: 'u', blockedBy: '[]'});
		writeFileSync(
			join(root, 'repo', '.dorfl.json'),
			JSON.stringify({autoBuild: true}),
		);
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({autoBuild: true}),
		);
		expect(report.repos[0].items[0].eligibility.eligible).toBe(true);
	});
});

/**
 * The taskable-prd pool (`prds[]`) surface on `scan`/`scanRepoPaths` (task
 * `ci-propose-matrix-must-enumerate-sliceable-prds-not-only-slices`). The CI
 * propose-matrix `jq` reads `repos[].specs[]` + `cwd.repo.specs[]` and unions them
 * with the task legs; before this task landed, the pool was invisible there
 * and `DORFL_AUTO_TASK` was dead on the hourly cron. The eligibility
 * predicate REUSES `taskableSpecs` (the SAME `autoslice-gate` predicate the
 * autopick paths run) — a config-less repo with `autoTask` off yields an
 * all-`eligible:false` pool (no `prd:` legs).
 */
function writePrd(
	repo: string,
	status: 'prd' | 'prd-tasked',
	file: string,
	frontmatter: Record<string, string>,
): void {
	const dir = join(root, repo, 'work', fixtureFolderRel(status));
	mkdirSync(dir, {recursive: true});
	const lines = ['---'];
	for (const [k, v] of Object.entries(frontmatter)) {
		lines.push(`${k}: ${v}`);
	}
	lines.push('---', '', '# PRD');
	writeFileSync(join(dir, file), lines.join('\n'));
}

describe('scanRepoPaths — taskable-prd pool (`prds[]`)', () => {
	it('a ready ungated PRD appears as taskable when autoTask is on (no per-repo config)', () => {
		writePrd('repo', 'prd', 'ready.md', {slug: 'ready'});
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({autoTask: true}),
		);
		const prd = report.repos[0].specs.find((p) => p.slug === 'ready');
		expect(prd).toBeDefined();
		expect(prd!.eligibility.eligible).toBe(true);
	});

	it('gates humanOnly / needsAnswers / unsatisfied taskedAfter PRDs out of the taskable pool', () => {
		writePrd('repo', 'prd', 'ready.md', {slug: 'ready'});
		writePrd('repo', 'prd', 'human.md', {slug: 'human', humanOnly: 'true'});
		writePrd('repo', 'prd', 'asks.md', {
			slug: 'asks',
			needsAnswers: 'true',
		});
		writePrd('repo', 'prd', 'after.md', {
			slug: 'after',
			taskedAfter: '[dep]',
		});
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({autoTask: true}),
		);
		const byslug = new Map(report.repos[0].specs.map((p) => [p.slug, p]));
		expect(byslug.get('ready')!.eligibility.eligible).toBe(true);
		expect(byslug.get('human')!.eligibility.eligible).toBe(false);
		expect(byslug.get('asks')!.eligibility.eligible).toBe(false);
		expect(byslug.get('after')!.eligibility.eligible).toBe(false);
	});

	it('an autoTask:false repo yields no TASKABLE PRD legs (the gate still binds)', () => {
		writePrd('repo', 'prd', 'ready.md', {slug: 'ready'});
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({autoTask: false}),
		);
		const ready = report.repos[0].specs.find((p) => p.slug === 'ready')!;
		expect(ready.eligibility.eligible).toBe(false);
	});

	it('honours the per-repo `.dorfl.json` autoTask override (off globally, on per-repo)', () => {
		writePrd('repo', 'prd', 'ready.md', {slug: 'ready'});
		writeFileSync(
			join(root, 'repo', '.dorfl.json'),
			JSON.stringify({autoTask: true}),
		);
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({autoTask: false}),
		);
		expect(
			report.repos[0].specs.find((p) => p.slug === 'ready')!.eligibility
				.eligible,
		).toBe(true);
	});

	it('a taskedAfter dep already in work/prds/tasked/ unblocks the PRD (folder-residence is the truth)', () => {
		writePrd('repo', 'prd', 'after.md', {
			slug: 'after',
			taskedAfter: '[dep]',
		});
		writePrd('repo', 'prd-tasked', 'dep.md', {slug: 'dep'});
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({autoTask: true}),
		);
		expect(
			report.repos[0].specs.find((p) => p.slug === 'after')!.eligibility
				.eligible,
		).toBe(true);
	});

	it(
		'end-to-end at the enumeration seam: ONE eligible task + ONE taskable prd ' +
			'⇒ both surface (the propose-matrix `jq` reads BOTH `items[]` AND `prds[]`)',
		() => {
			writeItem('repo', 'backlog', 'go.md', {slug: 'go', blockedBy: '[]'});
			writePrd('repo', 'prd', 'cut.md', {slug: 'cut'});
			const report = scanRepoPaths(
				[join(root, 'repo')],
				mergeConfig({autoBuild: true, autoTask: true}),
			);
			const task = report.repos[0].items.find((i) => i.slug === 'go')!;
			const prd = report.repos[0].specs.find((p) => p.slug === 'cut')!;
			expect(task.eligibility.eligible).toBe(true);
			expect(prd.eligibility.eligible).toBe(true);
		},
	);
});

describe('scan (registry) — taskable-prd pool (`prds[]`)', () => {
	it('reports a ready ungated PRD as taskable from the bare mirror main (autoTask on)', async () => {
		registerMirrorWithWork(workspacesDir(), 'repo', {
			prd: {'ready.md': `---\nslug: ready\n---\n# PRD`},
		});
		const report = await scan(
			mergeConfig({workspacesDir: workspacesDir(), autoTask: true}),
		);
		const prd = report.repos[0].specs.find((p) => p.slug === 'ready');
		expect(prd).toBeDefined();
		expect(prd!.eligibility.eligible).toBe(true);
	});

	it('a humanOnly / needsAnswers / autoTask:false PRD is NOT taskable (gate still binds)', async () => {
		registerMirrorWithWork(workspacesDir(), 'repo', {
			prd: {
				'ready.md': `---\nslug: ready\n---\n# PRD`,
				'human.md': `---\nslug: human\nhumanOnly: true\n---\n# PRD`,
				'asks.md': `---\nslug: asks\nneedsAnswers: true\n---\n# PRD`,
			},
		});
		// autoTask OFF globally + no committed per-repo override ⇒ NO taskable PRDs.
		const offReport = await scan(
			mergeConfig({workspacesDir: workspacesDir(), autoTask: false}),
		);
		expect(
			offReport.repos[0].specs.every((p) => p.eligibility.eligible === false),
		).toBe(true);
		// autoTask ON ⇒ only `ready` is taskable; the gated PRDs are NOT.
		const onReport = await scan(
			mergeConfig({workspacesDir: workspacesDir(), autoTask: true}),
		);
		const by = new Map(onReport.repos[0].specs.map((p) => [p.slug, p]));
		expect(by.get('ready')!.eligibility.eligible).toBe(true);
		expect(by.get('human')!.eligibility.eligible).toBe(false);
		expect(by.get('asks')!.eligibility.eligible).toBe(false);
	});

	it('honours the COMMITTED per-repo `.dorfl.json` autoTask override on the mirror', async () => {
		registerMirrorWithWork(workspacesDir(), 'repo', {
			prd: {'ready.md': `---\nslug: ready\n---\n# PRD`},
			repoConfig: {autoTask: true},
		});
		// Global is OFF, but the mirror's committed file opts in ⇒ taskable.
		const report = await scan(
			mergeConfig({workspacesDir: workspacesDir(), autoTask: false}),
		);
		expect(
			report.repos[0].specs.find((p) => p.slug === 'ready')!.eligibility
				.eligible,
		).toBe(true);
	});

	it('end-to-end: ONE eligible task + ONE taskable PRD on the SAME mirror ⇒ both surface', async () => {
		registerMirrorWithWork(workspacesDir(), 'repo', {
			backlog: {'go.md': task({slug: 'go'})},
			prd: {'cut.md': `---\nslug: cut\n---\n# PRD`},
		});
		const report = await scan(
			mergeConfig({
				workspacesDir: workspacesDir(),
				autoBuild: true,
				autoTask: true,
			}),
		);
		expect(
			report.repos[0].items.find((i) => i.slug === 'go')!.eligibility.eligible,
		).toBe(true);
		expect(
			report.repos[0].specs.find((p) => p.slug === 'cut')!.eligibility.eligible,
		).toBe(true);
	});
});

describe('scan — one-slug-one-folder LINT (PRD ledger-integrity story 3)', () => {
	it('surfaces a slug present in two status folders on the mirror, naming both', async () => {
		// A corrupt ledger: the SAME slug in BOTH tasks/cancelled/ and done/ (the
		// read-side belt-and-suspenders for the orphan class). The lint set is the
		// DURABLE folders now (`backlog`/`done`/`cancelled`) — the transient ones are
		// retired from `main`.
		const m = registerMirrorWithWork(workspacesDir(), 'repo', {
			backlog: {'live.md': task({slug: 'live'})},
			cancelled: {'ghost.md': task({slug: 'ghost'})},
			done: {'ghost.md': task({slug: 'ghost'})},
		});
		const report = await scan(
			mergeConfig({workspacesDir: workspacesDir(), autoBuild: true}),
		);
		const repo = report.repos.find((r) => r.path === m.mirrorPath)!;
		expect(repo.ledgerDuplicates).toHaveLength(1);
		expect(repo.ledgerDuplicates[0].slug).toBe('ghost');
		expect(repo.ledgerDuplicates[0].folders).toContain('cancelled');
		expect(repo.ledgerDuplicates[0].folders).toContain('done');

		const out = formatReport(report);
		expect(out).toMatch(/one-slug-one-folder VIOLATED/);
		expect(out).toMatch(/ghost/);
		expect(out).toContain('work/tasks/cancelled/');
		expect(out).toContain('work/tasks/done/');
	});

	it('a CLEAN mirror ledger reports no duplicates (no false positives; buckets excluded)', async () => {
		const m = registerMirrorWithWork(workspacesDir(), 'repo', {
			backlog: {'a.md': task({slug: 'a'})},
			inProgress: {'b.md': task({slug: 'b'})},
			done: {'c.md': task({slug: 'c'})},
			cancelled: {'d.md': task({slug: 'd'})},
		});
		const report = await scan(
			mergeConfig({workspacesDir: workspacesDir(), autoBuild: true}),
		);
		const repo = report.repos.find((r) => r.path === m.mirrorPath)!;
		expect(repo.ledgerDuplicates).toEqual([]);
		expect(formatReport(report)).not.toMatch(/one-slug-one-folder VIOLATED/);
	});
});

describe('scanRepoPaths — one-slug-one-folder LINT (working tree)', () => {
	it('surfaces a slug in two status folders of a working checkout', () => {
		writeItem('repo', 'cancelled', 'dup.md', {slug: 'dup'});
		writeItem('repo', 'done', 'dup.md', {slug: 'dup'});
		const report = scanRepoPaths([join(root, 'repo')], mergeConfig({}));
		expect(report.repos[0].ledgerDuplicates).toHaveLength(1);
		expect(report.repos[0].ledgerDuplicates[0].slug).toBe('dup');
	});

	it('reports clean for a checkout with no duplicate', () => {
		writeItem('repo', 'backlog', 'a.md', {slug: 'a'});
		const report = scanRepoPaths([join(root, 'repo')], mergeConfig({}));
		expect(report.repos[0].ledgerDuplicates).toEqual([]);
	});
});

/**
 * The per-repo LIFECYCLE pool (`scan --json`'s `repos[].lifecycle` +
 * `cwd.repo.lifecycle`) — task `ci-propose-matrix-enumerates-lifecycle-items`.
 * The CI propose-matrix `jq` reads `triage[]` ⇒ `obs:<slug>`, `surface[]`/`apply[]`
 * ⇒ `.namespace + ":" + .slug`, so the WHOLE answer-loop runs in propose mode, not
 * only in merge mode. The pool REUSES `lifecycle-gather.ts` → `buildLifecyclePools`
 * (no forked predicate), gated by the per-repo `observationTriage` /
 * `surfaceBlockers` config. INERT with the calm defaults.
 */
describe('scanRepoPaths — lifecycle pool (in-place working tree)', () => {
	it('INERT with calm defaults: triage + surface are empty, apply absent (no answered sidecar)', () => {
		writeObservation('repo', 'obs-a'); // untriaged — but triage gate is OFF
		writeItem('repo', 'backlog', 'blocked.md', {
			slug: 'blocked',
			needsAnswers: 'true',
			blockedBy: '[]',
		}); // needsAnswers, no sidecar — but surface gate is OFF
		// Calm defaults (observationTriage:off, surfaceBlockers:false).
		const report = scanRepoPaths([join(root, 'repo')], mergeConfig({}));
		const lc = report.repos[0].lifecycle;
		expect(lc.triage).toEqual([]);
		expect(lc.surface).toEqual([]);
		expect(lc.apply).toEqual([]);
	});

	it('observationTriage ON (ask) ⇒ an untriaged observation enters triage as {slug}', () => {
		writeObservation('repo', 'obs-a');
		writeObservation('repo', 'obs-settled', 'keep'); // triaged ⇒ excluded
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({observationTriage: 'ask'}),
		);
		const lc = report.repos[0].lifecycle;
		expect(lc.triage.map((t) => t.slug)).toEqual(['obs-a']);
	});

	it('observationTriage AUTO also enumerates triage (ask/auto collapse to a leg-or-not boolean)', () => {
		writeObservation('repo', 'obs-a');
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({observationTriage: 'auto'}),
		);
		expect(report.repos[0].lifecycle.triage.map((t) => t.slug)).toEqual([
			'obs-a',
		]);
	});

	it('surfaceBlockers ON ⇒ a needsAnswers task/PRD with NO sidecar enters surface with its namespace', () => {
		writeItem('repo', 'backlog', 'blocked.md', {
			slug: 'blocked',
			needsAnswers: 'true',
			blockedBy: '[]',
		});
		writePrd('repo', 'prd', 'blocked-prd.md', {
			slug: 'blocked-prd',
			needsAnswers: 'true',
		});
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({surfaceBlockers: true}),
		);
		const surface = report.repos[0].lifecycle.surface;
		expect(surface).toContainEqual({namespace: 'task', slug: 'blocked'});
		expect(surface).toContainEqual({namespace: 'spec', slug: 'blocked-prd'});
	});

	it('APPLY is ALWAYS-ON: an answered sidecar applies even with BOTH create-gates calm', () => {
		writeItem('repo', 'backlog', 'answered.md', {
			slug: 'answered',
			needsAnswers: 'true',
			blockedBy: '[]',
		});
		writeSidecar('repo', 'task', 'answered', true);
		// Calm defaults — apply must still surface (consume is never gated).
		const report = scanRepoPaths([join(root, 'repo')], mergeConfig({}));
		const lc = report.repos[0].lifecycle;
		expect(lc.apply).toContainEqual({namespace: 'task', slug: 'answered'});
		expect(lc.surface).toEqual([]); // an answered item is apply, never surface
	});

	it('a PENDING sidecar is NOT enumerated into surface OR apply (kept calm)', () => {
		writeItem('repo', 'backlog', 'pending.md', {
			slug: 'pending',
			needsAnswers: 'true',
			blockedBy: '[]',
		});
		writeSidecar('repo', 'task', 'pending', false); // exists, not all-answered
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({surfaceBlockers: true}),
		);
		const lc = report.repos[0].lifecycle;
		expect(lc.surface).toEqual([]);
		expect(lc.apply).toEqual([]);
	});

	it('DISJOINT: a needsAnswers item is never ALSO a build leg; an observation is its own namespace', () => {
		// A mixed fixture: an observation, a surface item, an apply item, all with
		// autoBuild on — none of the needsAnswers items may appear as an eligible
		// BUILD leg (`items[]`), and the observation lives only in triage.
		writeObservation('repo', 'obs-x');
		writeItem('repo', 'backlog', 'surface-it.md', {
			slug: 'surface-it',
			needsAnswers: 'true',
			blockedBy: '[]',
		});
		writeItem('repo', 'backlog', 'apply-it.md', {
			slug: 'apply-it',
			needsAnswers: 'true',
			blockedBy: '[]',
		});
		writeSidecar('repo', 'task', 'apply-it', true);
		const report = scanRepoPaths(
			[join(root, 'repo')],
			mergeConfig({
				autoBuild: true,
				observationTriage: 'ask',
				surfaceBlockers: true,
			}),
		);
		const repo = report.repos[0];
		// Neither needsAnswers item is an ELIGIBLE build leg.
		const eligibleSlugs = repo.items
			.filter((i) => i.eligibility.eligible)
			.map((i) => i.slug);
		expect(eligibleSlugs).not.toContain('surface-it');
		expect(eligibleSlugs).not.toContain('apply-it');
		// They live ONLY in their lifecycle pools.
		expect(repo.lifecycle.surface).toContainEqual({
			namespace: 'task',
			slug: 'surface-it',
		});
		expect(repo.lifecycle.apply).toContainEqual({
			namespace: 'task',
			slug: 'apply-it',
		});
		// The observation lives ONLY in triage (its own obs: namespace).
		expect(repo.lifecycle.triage.map((t) => t.slug)).toEqual(['obs-x']);
	});

	it('honours the per-repo `.dorfl.json` gate overrides (off globally, on per-repo)', () => {
		writeObservation('repo', 'obs-a');
		writeFileSync(
			join(root, 'repo', '.dorfl.json'),
			JSON.stringify({observationTriage: 'ask'}),
		);
		// Global is calm; the per-repo file opts triage in.
		const report = scanRepoPaths([join(root, 'repo')], mergeConfig({}));
		expect(report.repos[0].lifecycle.triage.map((t) => t.slug)).toEqual([
			'obs-a',
		]);
	});
});

describe('scan (registry) — lifecycle pool (bare mirror main)', () => {
	it('INERT with calm defaults on the mirror (empty triage/surface; no answered sidecar ⇒ empty apply)', async () => {
		registerMirrorWithWork(workspacesDir(), 'repo', {
			observations: {'obs-a.md': `---\nslug: obs-a\n---\nsignal`},
			backlog: {
				'blocked.md': task({slug: 'blocked', needsAnswers: 'true'}),
			},
		});
		const report = await scan(mergeConfig({workspacesDir: workspacesDir()}));
		const lc = report.repos[0].lifecycle;
		expect(lc.triage).toEqual([]);
		expect(lc.surface).toEqual([]);
		expect(lc.apply).toEqual([]);
	});

	it('honours the COMMITTED per-repo gates on the mirror (triage + surface ON ⇒ legs)', async () => {
		registerMirrorWithWork(workspacesDir(), 'repo', {
			observations: {'obs-a.md': `---\nslug: obs-a\n---\nsignal`},
			backlog: {
				'blocked.md': task({slug: 'blocked', needsAnswers: 'true'}),
			},
			repoConfig: {observationTriage: 'ask', surfaceBlockers: true},
		});
		// Global is calm; the mirror's committed file opts both gates in.
		const report = await scan(mergeConfig({workspacesDir: workspacesDir()}));
		const lc = report.repos[0].lifecycle;
		expect(lc.triage.map((t) => t.slug)).toEqual(['obs-a']);
		expect(lc.surface).toContainEqual({namespace: 'task', slug: 'blocked'});
	});

	it('APPLY is ALWAYS-ON on the mirror: an answered sidecar applies with calm gates', async () => {
		registerMirrorWithWork(workspacesDir(), 'repo', {
			backlog: {
				'answered.md': task({slug: 'answered', needsAnswers: 'true'}),
			},
			questions: {
				'task-answered.md': serialiseSidecar(
					(() => {
						const m = newSidecar('task:answered', [{question: 'pick?'}]);
						m.entries[0].answer = 'yes';
						return m;
					})(),
				),
			},
		});
		const report = await scan(mergeConfig({workspacesDir: workspacesDir()}));
		expect(report.repos[0].lifecycle.apply).toContainEqual({
			namespace: 'task',
			slug: 'answered',
		});
	});
});
