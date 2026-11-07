export * from "./types.ts";
export { createCore } from "./compress.ts";
export type {
  Ports,
  CompressionCore,
  ProcessTurnInput,
  ApplyCompressionInput,
} from "./compress.ts";
export {
  createInitialState,
  allocateBlockId,
  allocateRunId,
  blockById,
  activeBlocks,
  coveredMessageIds,
  highestActiveTier,
  advanceSurvival,
} from "./state.ts";
export { defaultConfig, validateConfig } from "./config.ts";
export * from "./compress-tools.ts";
export {
  assignRefs,
  highestUsedIndex,
  emptyRefMap,
  indexToRef,
  refToIndex,
  orderedRefPair,
  refForRaw,
  rawForRef,
  BLOCKED_REF,
  restampRefsToLedger,
  type RefRestampOutcome,
} from "./refs.ts";
export {
  prune,
  baseIdOf,
  isCovered,
  SUMMARY_HEADER,
  summaryMessageId,
  isSummaryMessageId,
  isRenderedSummaryMessage,
} from "./prune.ts";
export { syncBlocks } from "./sync.ts";
export {
  resolveBoundaries,
  parseBoundary,
  BoundaryNotFoundError,
  visibleBlockAnchor,
  blockVisibleInRange,
} from "./boundaries.ts";
export {
  defaultCountTokens,
  estimateTokensFast,
  createBpeTokenizer,
  countMessageTokens,
} from "./tokenize.ts";
export type { TokenCountFn } from "./tokenize.ts";
export { renderNudgeText, formatRanges, ONE_CALL_HINT } from "./nudge-text.ts";
export type {
  NudgeVoice,
  RenderedNudge,
  NudgePromptSections,
} from "./nudge-text.ts";
export {
  resolveBlockSpan,
  activeBlockSpans,
  formatCreatedBlocks,
} from "./block-map.ts";
export {
  COMPRESS_PHILOSOPHY,
  HOW_TO_COMPRESS_RULES,
  LANGUAGE_PRESERVATION_RULE,
  TIER2_DISTILL_RULES,
  TIER3_CONDENSE_RULES,
} from "./compression-rules.ts";
export { defaultPrompts, resolvePrompts } from "./prompts.ts";
export type { Prompts, ResolvePromptsOptions } from "./prompts.ts";
export {
  applySectionOverrides,
  cloneWithDescriptions,
  applyAcpToolOverrides,
} from "./surface-config.ts";
export type {
  SectionOverride,
  CompressPromptSections,
  ToolPromptOverrides,
  ToolPrompts,
  AcpToolLike,
} from "./surface-config.ts";
export {
  isValidPackName,
  sanitizePackSurface,
  defaultPack,
  leanPack,
  LEAN_HOW_TO_COMPRESS,
  leanHowToCompress,
  LEAN_HOW_TO_COMPRESS_TIMESTAMPED,
  TIMELINE_RULE_LINE,
  builtinSource,
  createDirPackSource,
  createPackResolver,
  defaultPackSources,
} from "./packs.ts";
export type {
  PromptPackFile,
  PackSurface,
  Pack,
  PackSource,
  PackResolver,
} from "./packs.ts";
export { truncateLargeToolOutputs } from "./truncate-tools.ts";
export type { TruncateOptions, TruncateResult } from "./truncate-tools.ts";
export {
  parseBlockIdArg,
  findBlocksOverlappingMessages,
  findActiveAncestor,
  activeAncestorIds,
  deactivateBlock,
  buildRestoredContentPreview,
  collectBlockContent,
  markBlockRestoredInline,
} from "./decompress.ts";
export type {
  DeactivateOptions,
  CollectedContentResult,
  CollectContentOptions,
  InlineRestoreResult,
} from "./decompress.ts";
export { buildStatusReport, buildRecap } from "./report.ts";
export type { StatusReportOptions, StatusReportMeta } from "./report.ts";
export { segmentGroups } from "./segment.ts";
export type { SegmentItem } from "./segment.ts";
export {
  buildCacheReport,
  computeFoldEconomics,
  decomposeSample,
  FOLD_CLAIM_COLD_ROUNDS,
  FOLD_CLAIM_WARM_HIT_PCT,
  formatCacheReport,
  summarizeFoldEconomics,
} from "./cache-report.ts";
export type {
  CacheSample,
  FoldEvent,
  FoldEconomicsInput,
  PriceProfile,
  SampleDecomposition,
  CacheTotals,
  FoldEconomics,
  EconomicsSummary,
  CacheReportLine,
  CacheReportOptions,
  CacheReport,
  FormatCacheReportOptions,
} from "./cache-report.ts";
export { renderHandoff, renderMessage, matchSession } from "./handoff.ts";
export type { HandoffInput, HandoffMeta, HandoffBlockFull } from "./handoff.ts";
export { isToolMessage } from "./message-kind.ts";
export { hideConsumedCompressCalls } from "./hide-consumed.ts";
export type { HideConsumedResult } from "./hide-consumed.ts";
// Experimental fold-point carrier relocation (default off) — host-side mirror
// sites (round-2 re-render, S4 plugin render) call the same pure function.
export { relocateCompressCarriers, planRelocateCompressCarriers } from "./relocate-compress.ts";
export type { RelocateOptions, RelocatePlan, RelocateMove } from "./relocate-compress.ts";
export {
  ABSORB_TOOL_NAME,
  ABSORB_TOOL,
  ABSORB_TOOL_OPENAI,
} from "./compress-tools.ts";
export {
  RETRIEVE_TOOL_NAME,
  RETRIEVE_TOOL,
  RETRIEVE_TOOL_OPENAI,
  RETRIEVE_TOOL_RESPONSES,
  RETRIEVE_TOOL_DESCRIPTION,
} from "./compress-tools.ts";
export {
  createContentStore,
  hashContent,
  storeOriginal,
  restampContentStore,
  retrieveByRef,
  hasStoredRef,
  contentStoreStats,
} from "./content-store.ts";
export type {
  MessageContentStore,
  StoredEntry,
  StoreSpec,
  RetrieveResult,
  ContentStoreStats,
} from "./content-store.ts";
export {
  DEFAULT_CCR_CONFIG,
  resolveCcrConfig,
  STORED_PLACEHOLDER_MARKER,
  RETRIEVED_ID_PREFIX,
  classifyKind,
  normalizeHead,
  extractCommand,
  buildStoredPlaceholder,
  parseStoredPlaceholder,
  isStoredPlaceholderText,
  restoreStoredPlaceholderText,
  retrievedMessageId,
  isRetrievedMessage,
  frameRetrievedOriginal,
  buildRetrievalPointer,
  RETRIEVE_INLINE_TOKENS_DEFAULT,
  applyRetrieve,
  storeLargeResults,
  storeCoveredOriginals,
  noteRetrieval,
  ccrStoreNode,
} from "./ccr.ts";
export type {
  StoredPlaceholderInput,
  ParsedStoredPlaceholder,
  RetrievalExport,
  ApplyRetrieveInput,
  ApplyRetrieveResult,
  StoreLargeResultsInput,
  StoreLargeResultsResult,
  CcrEffect,
} from "./ccr.ts";
export {
  ABSORB_PROMPT_MARKER,
  DEFAULT_ABSORB_CONFIG,
  resolveAbsorbConfig,
  buildAbsorbPrompt,
  buildAbsorbSystemPrompt,
  isAbsorbCandidate,
  hideAbsorbedMessages,
  appendAbsorbPrompts,
  parseAbsorbInput,
  applyAbsorb,
} from "./absorb.ts";
export type {
  AbsorbInput,
  AbsorbOutcome,
  ParsedAbsorb,
  AppendAbsorbPromptsResult,
} from "./absorb.ts";
export {
  RULE_TOOL_NAME,
  DEFAULT_RULE_LIMITS,
  RULES_USAGE_PROMPT,
  listRules,
  allocateRuleId,
  resolveRuleLimits,
  addRule,
  removeRule,
  clearRules,
  formatRulesForPrompt,
  formatRulesList,
} from "./rules.ts";
export type {
  RuleLimits,
  AddRuleResult,
  RemoveRuleResult,
  ClearRulesResult,
} from "./rules.ts";
export {
  DEFAULT_CRUSH_CONFIG,
  classifyCrushText,
  crushText,
  evaluateToolResult,
  applyCrushToMessages,
  resolveCrushConfig,
  registerCrushPlugin,
  unregisterCrushPlugin,
  listCrushPlugins,
  resetCrushPlugins,
  jsonFoldPlugin,
  codeTrimPlugin,
  logSelectPlugin,
} from "./crush.ts";
export type {
  CrushKind,
  CrushMeta,
  CrushOutput,
  CrushOptions,
  CrushPluginDef,
  CrushDecisionKind,
  CrushEvaluation,
  EvaluateCrushInput,
  ApplyCrushResult,
} from "./crush.ts";
export { rebuildCompressionState } from "./rebuild.ts";
export type { RebuildResult, RebuildPorts } from "./rebuild.ts";
export { parseCompressArgs } from "./parse-compress-input.ts";
export type {
  CompressParseDiagnostics,
  CompressParseKind,
  ParsedCompressInput,
} from "./parse-compress-input.ts";
export {
  renderVisibleRefs,
  renderRefsNode,
  createRenderRefsNode,
  formatTagTime,
} from "./render-refs.ts";
export type { RenderStrategy } from "./render-refs.ts";
export { resolveTransformChannel } from "./transform-channel.ts";
export type { TransformChannel } from "./transform-channel.ts";
export {
  searchBlocks,
  searchBlocksAsync,
  blockDocs,
  messageDocs,
} from "./search.ts";
export {
  clearDocFeatures,
  docCacheInfo,
  docFeatures,
  setDocCacheCap,
} from "./search.ts";
export type {
  SearchResult,
  SearchOptions,
  SearchAlgorithm,
  AsyncSearchAlgorithm,
  AnySearchAlgorithm,
  SearchDoc,
  SearchDocKind,
  ScoredBlock,
  MessageRole,
  RoleWeights,
  MessageInput,
} from "./search.ts";
export {
  DEFAULT_ALGORITHM,
  DEFAULT_ROLE_WEIGHTS,
  registerSearchAlgorithm,
  getSearchAlgorithm,
  listSearchAlgorithms,
} from "./search.ts";
export {
  collectLatestProtected,
  collectProtectedToolCallIds,
  hasMediaPayload,
  hasUnrecoverableMediaPayload,
  isMessageLatestProtected,
  isMessageProtected,
  isMessageProtectedWithPairing,
  matchToolMessagePattern,
  matchToolPath,
  matchToolPattern,
  toolPathOf,
  type LatestProtected,
} from "./protected.ts";
export {
  runPipeline,
  makeIO,
  type PipelineNode,
  type PipelineContext,
  type NodeIO,
  type NodeEffects,
} from "./pipeline.ts";
export * from "./filter/index.ts";

export { VIABLE_RANGE_MIN_TOKENS, viableRanges } from "./viable.ts";
export {
  classifyTurn,
  verbosityDirective,
  renderSteeringBlock,
  applySteeringToPrompt,
  clampEffortToFloor,
  resolveVerbosityLevel,
  resolveOutputSteeringConfig,
  decideOutputSteering,
  VERBOSITY_LEVELS,
  EFFORT_LADDER,
  DEFAULT_OUTPUT_STEERING_CONFIG,
  DEFAULT_STEERING_SENTINEL,
  DEFAULT_VERBOSITY_LEVEL,
  MIN_VERBOSITY_LEVEL,
  MAX_VERBOSITY_LEVEL,
} from "./output-steering.ts";
export type {
  TurnKind,
  StructuralMessage,
  StructuralBlock,
  OutputSteeringConfig,
  OutputSteeringDecision,
  SteeringPlacement,
  EffortValue,
} from "./output-steering.ts";
