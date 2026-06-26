/**
 * The VERIFY capability emitter (prd
 * `land-time-reverify-and-parallel-merge-ceiling`, task
 * `install-ci-tier1-branch-protection`; Story 11 — Tier-1 GitHub ceiling).
 * A SELF-REGISTERING module: it calls {@link registerCapability} at import
 * time, so {@link loadCapabilityRegistry} picks it up WITHOUT any edit to a
 * shared central list/switch (the file-orthogonality contract).
 *
 * The workflow shape + the shared {@link VERIFY_CHECK_CONTEXT} constant the
 * branch-protection step also reads live in `verify-workflow-template.ts`; this
 * file is the thin registry-wiring shim.
 */

import {registerCapability} from '../install-ci-core.js';
import {
	VERIFY_CAPABILITY_ID,
	VERIFY_CAPABILITY_LABEL,
	VERIFY_WORKFLOW_PATH,
	generateVerifyWorkflow,
} from '../verify-workflow-template.js';

registerCapability({
	id: VERIFY_CAPABILITY_ID,
	label: VERIFY_CAPABILITY_LABEL,
	emit(config) {
		return [
			{
				path: VERIFY_WORKFLOW_PATH,
				content: generateVerifyWorkflow(config),
			},
		];
	},
});
