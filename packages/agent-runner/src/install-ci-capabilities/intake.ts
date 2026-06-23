/**
 * The ISSUE-INTAKE capability emitter (PRD `runner-in-ci`, task
 * `install-ci-intake-trigger-and-review-surface`; capability D: consider incoming
 * issues → task/PRD, PLUS insertion point E: surface the review verdict into the
 * issue thread). A SELF-REGISTERING module: it calls {@link registerCapability} at
 * import time, so {@link loadCapabilityRegistry} picks it up WITHOUT any edit to a
 * shared central list/switch (the file-orthogonality contract — this task and the
 * sibling capability tasks stay mergeable in parallel).
 *
 * The workflow shape + its structural validator + the author-trust → per-outcome
 * flags derivation live in `intake-trigger-template.ts`; this file is the thin
 * registry-wiring shim.
 */

import {registerCapability} from '../install-ci-core.js';
import {
	INTAKE_TRIGGER_CAPABILITY_ID,
	INTAKE_TRIGGER_CAPABILITY_LABEL,
	INTAKE_TRIGGER_WORKFLOW_PATH,
	generateIntakeWorkflow,
} from '../intake-trigger-template.js';

registerCapability({
	id: INTAKE_TRIGGER_CAPABILITY_ID,
	label: INTAKE_TRIGGER_CAPABILITY_LABEL,
	emit(config) {
		return [
			{
				path: INTAKE_TRIGGER_WORKFLOW_PATH,
				content: generateIntakeWorkflow(config),
			},
		];
	},
});
