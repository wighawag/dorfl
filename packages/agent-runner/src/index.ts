export type {Brand} from './brand.js';
export {BASE, brand, deriveBrand, paramCase, constantCase} from './brand.js';

export type {
	Config,
	PartialConfig,
	IntegrationMode,
	HarnessAdapter,
	ReviewProviderName,
	VerifyConfig,
} from './config.js';
export {
	DEFAULT_CONFIG,
	mergeConfig,
	loadConfig,
	saveConfig,
	defaultConfigPath,
} from './config.js';

export type {
	RepoAllowedKey,
	RepoRejectedKey,
	LoadedRepoConfig,
	ResolveRepoConfigOptions,
	ResolvedRepoConfig,
} from './repo-config.js';
export {
	REPO_CONFIG_FILENAME,
	REPO_ALLOWED_KEYS,
	REPO_REJECTED_KEYS,
	repoConfigPath,
	loadRepoConfig,
	resolveRepoConfig,
} from './repo-config.js';

export type {EnvMap} from './env-config.js';
export {ENV_PREFIX, envVarName, envOverrides} from './env-config.js';

export type {Frontmatter} from './frontmatter.js';
export {parseFrontmatter, setSlicedMarker} from './frontmatter.js';

export {isParticipatingRepo, findParticipatingRepos} from './detect.js';

export type {
	HumanOnlyGate,
	BlockedByResult,
	EligibilityInput,
	EligibilityResult,
} from './eligibility.js';
export {
	resolveGate,
	resolveBlockedBy,
	resolveEligibility,
} from './eligibility.js';

export type {
	SliceAfterResult,
	SlicingEligibilityInput,
	SlicingEligibilityResult,
} from './slicing-eligibility.js';
export {
	resolveSliceGate,
	resolveSliceAfter,
	resolveSlicingEligibility,
} from './slicing-eligibility.js';

export type {
	LedgerBacklogItem,
	LedgerNeedsAttentionItem,
	LedgerPrdItem,
	LedgerPrdPool,
	PrdExistence,
	LocalLedgerState,
	ArbiterLedgerState,
	ResolveLocalStateInput,
	ResolvePrdExistenceInput,
	ResolvePrdPoolInput,
	ResolveArbiterStateInput,
	ResolveMirrorStateInput,
	LedgerReadStrategy,
} from './ledger-read.js';
export {currentLedgerRead, ledgerRead} from './ledger-read.js';

export type {
	LedgerTransitionKind,
	ApplyTransitionInput,
	ApplyTransitionResult,
	ApplyCompleteTransitionInput,
	ApplyCompleteTransitionResult,
	ApplyNeedsAttentionTransitionInput,
	ApplyNeedsAttentionTransitionResult,
	ApplyReturnToBacklogTransitionInput,
	ApplyReturnToBacklogTransitionResult,
	LedgerWriteStrategy,
} from './ledger-write.js';
export {currentLedgerWrite, ledgerWrite} from './ledger-write.js';

export type {BacklogItem, ScannedItem, RepoReport, ScanReport} from './scan.js';
export {scan, scanRepoPaths, readBacklogItems, readDoneSlugs} from './scan.js';

export type {
	SlugNamespace,
	ParsedSlugArg,
	ResolvedSlug,
	ResolveSlugInput,
} from './slug-namespace.js';
export {
	SlugResolutionError,
	parseSlugArg,
	resolveSlug,
	resolveSliceOnlyArg,
} from './slug-namespace.js';

export type {
	RegisteredMirror,
	Transport,
	RegistryOptions,
	RemoteAddResult,
	RemoteAddOptions,
	RemoteRmResult,
	RemoteRmOptions,
} from './registry.js';
export {
	RegistryError,
	listMirrors,
	remoteAdd,
	remoteRm,
	transportForUrl,
	projectIdFromKey,
} from './registry.js';

export {formatReport, formatCwdSection, gateLabel} from './format.js';
export type {
	CwdSection,
	CwdArbiter,
	ResolveCwdSectionOptions,
} from './cwd-section.js';
export {resolveCwdSection} from './cwd-section.js';

export type {
	SliceFolder,
	ResolvedSlice,
	PromptOptions,
	ContinueContext,
} from './prompt.js';
export {
	extractPromptSection,
	extractCanonicalWrapperTemplate,
	resolveClaimProtocolPath,
	wrapper,
	buildAgentPrompt,
	buildContinueBlock,
	extractRequeueNotes,
	resolveContinueContext,
	resolveSlice,
	inferSlugFromBranch,
	renderPrompt,
	PromptError,
} from './prompt.js';

export type {Candidate, SelectCaps} from './select.js';
export {selectCandidates} from './select.js';

export type {
	SelectedNamespace,
	SelectedItem,
	PrdCandidate,
	SliceablePrdsInput,
	SelectPrioritisedInput,
} from './select-priority.js';
export {sliceablePrds, selectPrioritised} from './select-priority.js';

export type {
	ClaimExitCode,
	ClaimCasOutcome,
	ClaimCasOptions,
	ClaimCasResult,
} from './claim-cas.js';
export {performClaim} from './claim-cas.js';

export type {StartOutcome, StartOptions, StartResult} from './start.js';
export {performStart} from './start.js';

export type {WorkOnOutcome, WorkOnOptions, WorkOnResult} from './work-on.js';
export {
	performWorkOn,
	suggestHumanWorktreesDir,
	loadHumanWorktreesDir,
	persistHumanWorktreesDir,
} from './work-on.js';

export type {ReadinessVerdict, ResolveReadinessOptions} from './readiness.js';
export {resolveReadiness} from './readiness.js';

export type {
	CompleteOutcome,
	CompleteOptions,
	CompleteResult,
} from './complete.js';
export {performComplete} from './complete.js';

export type {
	DoOutcome,
	DoResult,
	DoAgentRunner,
	DoOptions,
	DoRemoteOptions,
} from './do.js';
export {performDo, performDoRemote} from './do.js';

export type {
	DoRunner,
	PerformDoMultiOptions,
	DoMultiResult,
} from './do-autopick.js';
export {performDoAuto, performDoArgs} from './do-autopick.js';

export type {
	SliceOutcome,
	SliceResult,
	SliceAgentRunner,
	SlicingLockSeam,
	PerformSliceOptions,
} from './slicing.js';
export {performSlice} from './slicing.js';

export type {EnsureMirrorOptions, EnsureMirrorResult} from './repo-mirror.js';
export {
	encodeRepoKey,
	mirrorPath,
	ensureMirror,
	fetchMirrorMain,
	mirrorMainSha,
} from './repo-mirror.js';

export type {JobRecord, JobState, CreateJobOptions, Job} from './workspace.js';
export {
	JOB_RECORD_FILENAME,
	encodeWorkId,
	jobWorktreePath,
	createJob,
	writeJobRecord,
	readJobRecord,
	updateJobRecord,
} from './workspace.js';

export type {
	HarnessRecord,
	LaunchInput,
	LaunchResult,
	Harness,
} from './harness.js';
export {
	NullHarness,
	pidAlive,
	resolveHarness,
	registerHarness,
} from './harness.js';

export type {PiHarnessOptions, PiHarnessRecord} from './pi-harness.js';
export {
	PiHarness,
	createHarness,
	piSessionExists,
	DEFAULT_PI_BIN,
} from './pi-harness.js';

export type {GenerateSessionPathInput} from './session-path.js';
export {generateSessionPath, piDefaultSessionDir} from './session-path.js';

export type {SessionTailerOptions} from './watch-session.js';
export {
	formatWatchEvent,
	finishedLine,
	boundaryLine,
	SessionTailer,
} from './watch-session.js';

export type {LaunchWithOptionalWatchInput} from './agent-launch.js';
export {launchWithOptionalWatch} from './agent-launch.js';

export type {
	ReviewProvider,
	OpenRequestInput,
	OpenRequestResult,
	IntegrateInput,
	IntegrateResult,
	IntegrateWithRebaseResult,
	IntegratorOptions,
	RebaseInput,
	RebaseResult,
} from './integrator.js';
export {
	Integrator,
	NoneProvider,
	rebaseOntoArbiterMain,
	arbiterMainContains,
} from './integrator.js';

export type {
	ProviderName,
	SelectProviderOptions,
	GitHubProviderOptions,
} from './github.js';
export {
	GitHubProvider,
	isGitHubArbiterUrl,
	selectProvider,
	DEFAULT_GH_BIN,
} from './github.js';

export type {
	IsolatedTree,
	PrepareInput,
	IsolationStrategy,
	SelectIsolationInput,
} from './isolation.js';
export {
	jobWorktreeStrategy,
	jobWorktreeHandle,
	inPlaceStrategy,
	selectIsolationStrategy,
} from './isolation.js';

export type {
	ItemStatus,
	ItemResult,
	RunOnceResult,
	RunOnceOptions,
	AgentRunner,
} from './run.js';
export {runOnce, defaultRunWorkspace} from './run.js';

export type {RunVerifyOptions, RunVerifyResult} from './verify.js';
export {
	runVerify,
	resolveVerifyCommands,
	DEFAULT_VERIFY_COMMAND,
} from './verify.js';

export type {
	ReviewFinding,
	ReviewVerdict,
	ReviewGateInput,
	ReviewGate,
	HarnessReviewGateOptions,
} from './review-gate.js';
export {
	ReviewParseError,
	parseReviewVerdict,
	buildReviewPrompt,
	buildSliceAcceptancePrompt,
	harnessReviewGate,
	harnessSliceAcceptanceGate,
	formatBlockReason,
	reviewRoundsExhaustedReason,
} from './review-gate.js';

export type {
	RetainReason,
	ReachableVia,
	SafetyVerdict,
	EvaluateSafetyInput,
	ReapInput,
	ReapResult,
	GcJob,
	ReapedJob,
	RetainedJob,
	GcOptions,
	GcResult,
} from './gc.js';
export {
	RETAIN_REASON_TEXT,
	evaluateDeletionSafety,
	reapJob,
	gc,
	discoverJobs,
} from './gc.js';

export type {
	JobStatus,
	RepoNeedsAttention,
	StatusReport,
	StatusOptions,
} from './status.js';
export {status, formatStatus} from './status.js';

export type {
	ArbiterInitOptions,
	ArbiterInitResult,
	ArbiterStatusOptions,
	ArbiterStatusReport,
} from './arbiter.js';
export {
	DEFAULT_ARBITER_REMOTE,
	ArbiterError,
	arbiterPath,
	arbiterInit,
	arbiterStatus,
	formatArbiterStatus,
} from './arbiter.js';

export type {
	RouteToNeedsAttentionOptions,
	RouteToNeedsAttentionResult,
	ReturnToBacklogOptions,
	ReturnToBacklogResult,
	NeedsAttentionItem,
} from './needs-attention.js';
export {
	routeToNeedsAttention,
	returnToBacklog,
	readNeedsAttentionItems,
	extractReason,
} from './needs-attention.js';

export type {
	Category,
	CategorisedItem,
	CategorisedGroups,
	CategorySummary,
} from './categorise.js';
export {
	categoriseItem,
	categoriseItems,
	sortReadyFirst,
	summariseGroups,
	CATEGORY_ORDER,
	CATEGORY_LABELS,
} from './categorise.js';
