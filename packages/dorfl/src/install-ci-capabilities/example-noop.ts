/**
 * REFERENCE capability registration (SPEC `runner-in-ci`, task
 * `install-ci-core-and-github-adapter`). This file proves the capability-emitter
 * REGISTRY seam works as a DIRECTORY of self-registering modules: a new capability
 * is a NEW file in `install-ci-capabilities/` that calls {@link registerCapability}
 * at import time — NOT an edit to a shared central list/switch. The sibling
 * capability tasks (advance-lifecycle, intake, close-job) each ADD
 * their own file here exactly like this one, so they stay file-orthogonal and
 * mergeable in parallel (WORK-CONTRACT task-quality / `to-tasks` §3).
 *
 * It is a no-op example: it emits NO files (this core task ships no capability
 * workflow). Its presence + pickup by {@link loadCapabilityRegistry} is the proof
 * that registration needs no shared-file edit.
 */

import {registerCapability} from '../install-ci-core.js';

registerCapability({
	id: 'example-noop',
	label: 'Example (no-op reference capability)',
	emit() {
		return [];
	},
});
