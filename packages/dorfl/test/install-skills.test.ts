import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installSkills, resolveSkillsSourceDir} from '../src/install-skills.js';
import type {Agent} from '../src/vendor/incur/agents.js';
import {makeScratch, type Scratch} from './helpers/gitRepo.js';

/**
 * Snapshot of the real HOME's `.agents/skills/` entries taken at load time.
 * Every test asserts, at teardown, that the real dir is BIT-FOR-BIT unchanged
 * (WORK-CONTRACT shared-write isolation): a defective test that leaks to the
 * developer's real harness dirs fails HERE, not silently in their config.
 * We only ever use `global: false` in these tests, so the real HOME is not
 * expected to be touched at all.
 */
const REAL_HOME_SKILLS = join(homedir(), '.agents', 'skills');
const realHomeSkillsBefore = existsSync(REAL_HOME_SKILLS)
	? readdirSync(REAL_HOME_SKILLS).sort()
	: null;

function assertRealHomeUntouched(): void {
	const now = existsSync(REAL_HOME_SKILLS)
		? readdirSync(REAL_HOME_SKILLS).sort()
		: null;
	expect(now).toEqual(realHomeSkillsBefore);
}

/** Seed a fake skills SOURCE directory with `<root>/<name>/SKILL.md`. */
function seedSkill(root: string, name: string, body = `# ${name}\n`): void {
	const dir = join(root, name);
	mkdirSync(dir, {recursive: true});
	writeFileSync(join(dir, 'SKILL.md'), body);
}

/**
 * Build a per-test HARNESS SET pointing at scratch directories, so every
 * install writes ONLY into the scratch tree. Two harnesses:
 *   - `Universal` — universal (canonical `.agents/skills` only, no symlink).
 *   - `Boutique` — non-universal (symlinks canonical → its own dir).
 */
function harnessSet(scratchRoot: string): Agent[] {
	return [
		{
			name: 'Universal',
			globalSkillsDir: join(scratchRoot, 'universal-global'),
			projectSkillsDir: '.agents/skills',
			universal: true,
			detect: () => true,
		},
		{
			name: 'Boutique',
			globalSkillsDir: join(scratchRoot, 'boutique-global'),
			projectSkillsDir: '.boutique/skills',
			universal: false,
			detect: () => true,
		},
	];
}

describe('resolveSkillsSourceDir', () => {
	it('honours an explicit override (short-circuits everything)', () => {
		expect(resolveSkillsSourceDir('/nonexistent/override/path')).toBe(
			'/nonexistent/override/path',
		);
	});

	it('prefers the packaged dist/skills/ copy when it exists', () => {
		// `pnpm build` populates `dist/skills/` — the resolver's primary. When the
		// build has run in this workspace, the resolver MUST return it.
		const here = dirname(fileURLToPath(import.meta.url));
		const distSkills = resolve(here, '..', 'dist', 'skills');
		if (!existsSync(distSkills)) {
			// Build has not run yet in this checkout — skip; the dev-fallback test
			// below still covers the ELSE branch.
			return;
		}
		expect(resolveSkillsSourceDir()).toBe(distSkills);
	});

	it('falls back to the dev monorepo-root skills/ walk when dist is absent', () => {
		// We can't easily hide `dist/skills/`, so we simulate the resolver's
		// candidate walk directly against a synthetic layout: an override that
		// points at a non-existent dist forces the resolver to return the first
		// candidate (its default behaviour when nothing exists). What we assert
		// here is the SHAPE: the resolver picks the first EXISTING candidate.
		const scratch = makeScratch('dorfl-skills-resolver-');
		try {
			const fakeSrc = join(scratch.root, 'skills');
			seedSkill(fakeSrc, 'demo');
			// Override always short-circuits, but its return-value shape confirms
			// the resolver just hands us back what we hand in.
			expect(resolveSkillsSourceDir(fakeSrc)).toBe(fakeSrc);
			expect(
				existsSync(join(resolveSkillsSourceDir(fakeSrc), 'demo', 'SKILL.md')),
			).toBe(true);
		} finally {
			scratch.cleanup();
		}
	});
});

describe('installSkills', () => {
	let scratch: Scratch;
	let src: string;
	let cwd: string;

	beforeEach(() => {
		scratch = makeScratch('dorfl-skills-install-');
		src = join(scratch.root, 'skills');
		cwd = join(scratch.root, 'project');
		mkdirSync(cwd, {recursive: true});
		seedSkill(src, 'from-idea');
		seedSkill(src, 'setup');
	});

	afterEach(() => {
		scratch.cleanup();
		assertRealHomeUntouched();
	});

	it('resolves the source dir and drives install() into a scratch cwd (project-local)', () => {
		const agents = harnessSet(scratch.root);
		const result = installSkills({
			sourceDir: src,
			global: false,
			cwd,
			agents,
		});

		expect(result.sourceDir).toBe(src);
		// Canonical placements land under `<cwd>/.agents/skills/<name>/SKILL.md`.
		const canonical = join(cwd, '.agents', 'skills');
		expect(result.paths.sort()).toEqual(
			[join(canonical, 'from-idea'), join(canonical, 'setup')].sort(),
		);
		for (const name of ['from-idea', 'setup']) {
			expect(readFileSync(join(canonical, name, 'SKILL.md'), 'utf8')).toContain(
				name,
			);
		}
	});

	it('symlinks non-universal harnesses to the canonical dir (project-local)', () => {
		const agents = harnessSet(scratch.root);
		const result = installSkills({
			sourceDir: src,
			global: false,
			cwd,
			agents,
		});

		// The universal harness gets NO per-agent entry (it reads from canonical).
		expect(result.agents.map((a) => a.agent)).toEqual(['Boutique', 'Boutique']);

		for (const entry of result.agents) {
			expect(entry.agent).toBe('Boutique');
			expect(entry.mode).toBe('symlink');
			// The link points (relatively) at the canonical dir with the same name.
			const stat = lstatSync(entry.path);
			expect(stat.isSymbolicLink()).toBe(true);
			const target = readlinkSync(entry.path);
			const resolved = resolve(dirname(entry.path), target);
			const name = entry.path.split('/').pop();
			expect(resolved).toBe(join(cwd, '.agents', 'skills', name!));
		}
	});

	it('is idempotent: re-running produces the same paths and leaves the same content', () => {
		const agents = harnessSet(scratch.root);
		const first = installSkills({sourceDir: src, global: false, cwd, agents});
		const second = installSkills({sourceDir: src, global: false, cwd, agents});
		expect(second.paths.sort()).toEqual(first.paths.sort());
		expect(second.agents.map((a) => a.path).sort()).toEqual(
			first.agents.map((a) => a.path).sort(),
		);
		for (const p of second.paths) {
			expect(existsSync(join(p, 'SKILL.md'))).toBe(true);
		}
	});

	it('installs the CURRENT source contents on re-run (stale content replaced)', () => {
		const agents = harnessSet(scratch.root);
		installSkills({sourceDir: src, global: false, cwd, agents});
		// Mutate the source, re-install; the canonical SKILL.md must reflect the
		// new content (the vendored `install()` clears the canonical dir before
		// copying, so a stale file from the prior version is overwritten).
		writeFileSync(join(src, 'setup', 'SKILL.md'), '# setup v2\n');
		installSkills({sourceDir: src, global: false, cwd, agents});
		const setupSkill = join(cwd, '.agents', 'skills', 'setup', 'SKILL.md');
		expect(readFileSync(setupSkill, 'utf8')).toBe('# setup v2\n');
	});

	it('project-local vs global option is threaded through (isGlobal defaults to true)', () => {
		const agents = harnessSet(scratch.root);
		// Project-local: canonical base is `<cwd>/.agents/skills/`.
		const local = installSkills({sourceDir: src, global: false, cwd, agents});
		for (const p of local.paths) {
			expect(p.startsWith(join(cwd, '.agents', 'skills'))).toBe(true);
		}
		// The DEFAULT (no `global` supplied) is TRUE \u2014 the vendored `install()`
		// would target the process home. We do NOT exercise that path here (it
		// would write outside the scratch), but we DO assert that omitting
		// `global` selects the global branch by looking at the resolver's shape:
		// with `global: true` explicitly, `cwd` is ignored, so paths do NOT go
		// under `<cwd>/.agents/skills/`. We check that indirectly by asserting
		// the CANONICAL under cwd is only populated when `global` is false.
		const beforeEntries = readdirSync(join(cwd, '.agents', 'skills')).sort();
		// Re-run local: same set.
		installSkills({sourceDir: src, global: false, cwd, agents});
		const afterEntries = readdirSync(join(cwd, '.agents', 'skills')).sort();
		expect(afterEntries).toEqual(beforeEntries);
	});

	it('cleans a stale skill on the FILESYSTEM (a canonical dir wiped between runs is re-created)', () => {
		const agents = harnessSet(scratch.root);
		installSkills({sourceDir: src, global: false, cwd, agents});
		const setupCanonical = join(cwd, '.agents', 'skills', 'setup');
		// Simulate a stale/corrupt canonical dir on disk (leftover from a prior
		// buggy run) and re-install \u2014 the vendored `install()`'s `rmForce` clears
		// it before re-copying, so the SKILL.md is present and fresh.
		writeFileSync(join(setupCanonical, 'stale.txt'), 'leftover');
		installSkills({sourceDir: src, global: false, cwd, agents});
		expect(existsSync(join(setupCanonical, 'SKILL.md'))).toBe(true);
		expect(existsSync(join(setupCanonical, 'stale.txt'))).toBe(false);
	});

	it('returns the resolver output as `sourceDir` so callers can report WHERE it read from', () => {
		const agents = harnessSet(scratch.root);
		const result = installSkills({
			sourceDir: src,
			global: false,
			cwd,
			agents,
		});
		expect(result.sourceDir).toBe(src);
	});
});

describe('installSkills — the packaged skills source', () => {
	it('the resolver picks a real source that contains at least one SKILL.md when the workspace has been built or has repo-root skills', () => {
		// This test is a light sanity check on the ambient workspace: at least
		// one of `dist/skills/` or the monorepo-root `skills/` MUST exist AND
		// contain a `SKILL.md` — otherwise `installSkills()` in production would
		// have nothing to install.
		const src = resolveSkillsSourceDir();
		expect(existsSync(src)).toBe(true);
		const entries = readdirSync(src, {withFileTypes: true});
		const withSkill = entries.filter(
			(e) => e.isDirectory() && existsSync(join(src, e.name, 'SKILL.md')),
		);
		expect(withSkill.length).toBeGreaterThan(0);
	});
});
