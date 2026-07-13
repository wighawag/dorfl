/**
 * Vendor the SET of hand-authored skill directories INTO the published package.
 *
 * The dorfl SKILLS (`from-idea`, `setup`, and the rest) live at the MONOREPO
 * ROOT (`skills/<name>/SKILL.md` + optional assets) — they are the operator's
 * toolbox, owned outside `packages/dorfl/`. But an installed npm package cannot
 * reference files outside itself, and `dorfl skills add` needs a bundled copy
 * to install into the operator's agent-harness directories on a machine that
 * has NO dorfl checkout. So the package must ship its OWN copy.
 *
 * This step (part of `pnpm build`, sibling of `vendor-protocol.mjs`) walks
 * every top-level directory under the monorepo-root `skills/` that contains a
 * `SKILL.md` and mirrors it into `dist/skills/<name>/` (SKILL.md plus any
 * sibling assets, recursively). The runtime resolver
 * (`resolveSkillsSourceDir` in `install-skills.ts`) reads from `dist/skills/`
 * FIRST, then falls back to the dev-only monorepo-root `skills/` walk — the
 * same prefer-`dist/`-then-dev-walk shape `vendor-protocol.mjs` +
 * `resolveProtocolDoc` use for the runtime-read protocol docs.
 *
 * Kept as a sibling (not appended to `vendor-protocol.mjs`) because the two
 * copy DIFFERENT concept sets — the CONTRACT DOCS versus the SKILLS — into
 * DIFFERENT dest subtrees, and each has its own DOC set / SKILL set that
 * evolves independently. One skill added upstream should not require touching
 * a script whose top-of-file comment is about protocol docs.
 */
import {cpSync, existsSync, mkdirSync, readdirSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// here = .../packages/dorfl/scripts; the skills live at the monorepo root.
const srcDir = resolve(here, '..', '..', '..', 'skills');
const destDir = resolve(here, '..', 'dist', 'skills');

// Clean-slate the dest so a skill removed upstream is removed here too.
rmSync(destDir, {recursive: true, force: true});
mkdirSync(destDir, {recursive: true});

for (const entry of readdirSync(srcDir, {withFileTypes: true})) {
	if (!entry.isDirectory()) continue;
	const from = join(srcDir, entry.name);
	// Only vendor directories that carry a `SKILL.md` (the shape the vendored
	// harness map's `discoverSkills` expects). Silently skip anything else so a
	// stray dir under `skills/` never surfaces as a broken install target.
	if (!existsSync(join(from, 'SKILL.md'))) continue;
	cpSync(from, join(destDir, entry.name), {recursive: true});
}
