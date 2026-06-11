/**
 * Vendor the runtime-read work-contract doc INTO the published package.
 *
 * `resolveClaimProtocolPath` reads `CLAIM-PROTOCOL.md` at runtime to assemble the
 * work-agent prompt. The doc is OWNED by the `setup` skill at the monorepo root
 * (`skills/setup/protocol/CLAIM-PROTOCOL.md`) and `setup` copies it into every
 * target repo's `work/protocol/`. But an installed npm CLI has NO sibling
 * `skills/` tree and may run against a not-yet-set-up repo (no `work/protocol/`),
 * so the package must ship its OWN fallback copy — a published package cannot
 * reference files outside itself.
 *
 * This step (part of `pnpm build`) copies the monorepo-root source into
 * `dist/protocol/CLAIM-PROTOCOL.md`, the published-CLI fallback the resolver
 * checks after the target-repo copy and before the dev-only `skills/` walk.
 */
import {copyFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// here = .../packages/agent-runner/scripts; the source lives at the monorepo root.
const src = resolve(
	here,
	'..',
	'..',
	'..',
	'skills',
	'setup',
	'protocol',
	'CLAIM-PROTOCOL.md',
);
const destDir = resolve(here, '..', 'dist', 'protocol');
const dest = resolve(destDir, 'CLAIM-PROTOCOL.md');

mkdirSync(destDir, {recursive: true});
copyFileSync(src, dest);
