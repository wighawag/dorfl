/**
 * Vendor the SET of runtime-read protocol docs INTO the published package.
 *
 * `resolveProtocolDoc` reads these docs at runtime to assemble spawned-agent
 * prompts (the work-agent prompt + the runner-invoked discipline prompts). The
 * docs are OWNED by the `setup` skill at the monorepo root
 * (`skills/setup/protocol/`) and `setup` copies them into every target repo's
 * `work/protocol/`. But an installed npm CLI has NO sibling `skills/` tree and
 * may run against a not-yet-set-up repo (no `work/protocol/`), so the package
 * must ship its OWN fallback copies — a published package cannot reference
 * files outside itself.
 *
 * This step (part of `pnpm build`) copies each doc in {@link DOCS} from the
 * monorepo-root source into `dist/protocol/<name>`, the published-CLI fallback
 * the resolver checks after the target-repo copy and before the dev-only
 * `skills/` walk.
 *
 * To add a new runtime-read protocol doc: drop the source under
 * `skills/setup/protocol/`, append its BASENAME to {@link DOCS}, and have the
 * runner read it via `resolveProtocolDoc('<NAME>.md', cwd)`. `setup` already
 * copies the whole `skills/setup/protocol/` directory into every target repo,
 * so target-repo propagation falls out for free.
 */
import {copyFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/**
 * The SET of runtime-read protocol docs the runner resolves via
 * `resolveProtocolDoc`. Data-driven on purpose — adding a new runner-invoked
 * discipline appends its doc here (no per-doc copy step).
 */
const DOCS = [
	'CLAIM-PROTOCOL.md',
	'REVIEW-PROTOCOL.md',
	'SURFACE-PROTOCOL.md',
	'TASKING-PROTOCOL.md',
];

const here = dirname(fileURLToPath(import.meta.url));
// here = .../packages/agent-runner/scripts; the source lives at the monorepo root.
const srcDir = resolve(here, '..', '..', '..', 'skills', 'setup', 'protocol');
const destDir = resolve(here, '..', 'dist', 'protocol');

mkdirSync(destDir, {recursive: true});
for (const name of DOCS) {
	copyFileSync(resolve(srcDir, name), resolve(destDir, name));
}
