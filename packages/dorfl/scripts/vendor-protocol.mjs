/**
 * Vendor the SET of runtime-read protocol docs INTO the published package.
 *
 * `resolveProtocolDoc` reads these docs at runtime to assemble spawned-agent
 * prompts (the work-agent prompt + the runner-invoked discipline prompts), AND
 * `dorfl prd-to-spec` re-syncs them into a target repo's `work/protocol/` (the
 * deterministic slice of `setup`). The docs are OWNED by the `setup` skill at
 * the monorepo root (`skills/setup/protocol/`) and `setup` copies them into
 * every target repo's `work/protocol/`. But an installed npm CLI has NO sibling
 * `skills/` tree and may run against a not-yet-set-up repo (no `work/protocol/`),
 * so the package must ship its OWN fallback copies — a published package cannot
 * reference files outside itself.
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
 * The SET of protocol docs the package vendors. This is the FULL `setup`
 * contract set (kept in lockstep with `PROTOCOL_DOCS` in `src/prd-to-spec.ts`),
 * NOT just the runtime-read subset: `dorfl prd-to-spec` re-syncs ALL of them
 * into a target repo, and the published CLI has no sibling `skills/` tree to
 * read the non-runtime docs (`WORK-CONTRACT.md`, `ADR-FORMAT.md`, the
 * templates) from — so it must ship its own copies of each. The runtime
 * resolver (`resolveProtocolDoc`) reads whichever subset it needs from the same
 * `dist/protocol/` dir. Adding a new protocol doc appends its BASENAME here.
 */
const DOCS = [
	'WORK-CONTRACT.md',
	'CLAIM-PROTOCOL.md',
	'REVIEW-PROTOCOL.md',
	'SURFACE-PROTOCOL.md',
	'TASKING-PROTOCOL.md',
	'ADR-FORMAT.md',
	'task-template.md',
	'spec-template.md',
];

const here = dirname(fileURLToPath(import.meta.url));
// here = .../packages/dorfl/scripts; the source lives at the monorepo root.
const srcDir = resolve(here, '..', '..', '..', 'skills', 'setup', 'protocol');
const destDir = resolve(here, '..', 'dist', 'protocol');

mkdirSync(destDir, {recursive: true});
for (const name of DOCS) {
	copyFileSync(resolve(srcDir, name), resolve(destDir, name));
}
