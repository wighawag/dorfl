/**
 * The ADVANCE-LIFECYCLE capability emitter (SPEC `runner-in-ci`, task
 * `install-ci-advance-lifecycle-workflow`; capability C: auto-triage observations
 * + surface declared blockers + apply committed answers). A SELF-REGISTERING
 * module: it calls {@link registerCapability} at import time, so
 * {@link loadCapabilityRegistry} picks it up WITHOUT any edit to a shared central
 * list/switch (the file-orthogonality contract — this task and the sibling
 * capability tasks stay mergeable in parallel).
 *
 * The workflow shape (the parameterised seed `advance-loop.yml.template`) + its
 * structural validator live in `advance-lifecycle-template.ts`; this file is the
 * thin registry-wiring shim.
 */

import {registerCapability} from '../install-ci-core.js';
import {
	ADVANCE_LIFECYCLE_CAPABILITY_ID,
	ADVANCE_LIFECYCLE_CAPABILITY_LABEL,
	ADVANCE_LIFECYCLE_WORKFLOW_PATH,
	generateAdvanceLifecycleWorkflow,
} from '../advance-lifecycle-template.js';

registerCapability({
	id: ADVANCE_LIFECYCLE_CAPABILITY_ID,
	label: ADVANCE_LIFECYCLE_CAPABILITY_LABEL,
	emit(config) {
		return [
			{
				path: ADVANCE_LIFECYCLE_WORKFLOW_PATH,
				content: generateAdvanceLifecycleWorkflow(config),
			},
		];
	},
});
